import dns from 'node:dns/promises';
import net from 'node:net';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Validates that a bookmark or external URL uses strictly http/https.
 * Rejects javascript:, data:, vbscript:, file:, etc.
 */
export function sanitizeBookmarkUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    if (!parsed.hostname || parsed.hostname.length > 253) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates cover or favicon image URLs: allows http/https or safe local /covers/ paths.
 */
export function sanitizeMediaUrl(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return '';

  // Allow relative local cover assets under /covers/
  if (trimmed.startsWith('/covers/') && !trimmed.includes('..')) {
    return trimmed;
  }

  // Allow generated lightweight cover screenshots under /api/covers/<uuid>.<ext>
  if (
    /^\/api\/covers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/i.test(
      trimmed
    )
  ) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export function extractDomain(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // Loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // Link-local & cloud metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (net.isIPv4(normalized)) {
    return isPrivateIpv4(normalized);
  }
  if (net.isIPv6(normalized)) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local fc00::/7
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true; // Link-local fe80::/10
    }
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice(7);
      if (net.isIPv4(mapped)) return isPrivateIpv4(mapped);
    }
    return false;
  }
  return true;
}

/**
 * Verifies a URL is safe to fetch from the server (blocks private, loopback,
 * link-local, metadata endpoints, and internal hostnames).
 */
export async function assertSafeFetchUrl(rawUrl: string): Promise<URL> {
  const sanitized = sanitizeBookmarkUrl(rawUrl);
  if (!sanitized) {
    throw new Error('Некорректный URL. Поддерживаются только адреса http:// и https://');
  }

  const parsed = new URL(sanitized);
  const host = parsed.hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Запрос к локальным и внутренним адресам запрещён');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      throw new Error('Запрос к приватным IP-адресам запрещён');
    }
    return parsed;
  }

  const records = await dns.lookup(host, { all: true });
  if (!records.length) {
    throw new Error('Не удалось разрешить доменное имя');
  }

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error('Домен указывает на приватный или локальный IP-адрес');
    }
  }

  return parsed;
}
