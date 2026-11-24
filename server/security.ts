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

  // Allow relative local cover assets under /covers/ with strict filename & image extension
  if (/^\/covers\/[a-zA-Z0-9_-]+\.(svg|png|jpe?g|webp)$/i.test(trimmed)) {
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
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // Loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // Link-local & cloud metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24 & TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

/**
 * Expands any valid IPv6 string (including compressed :: and embedded dotted-quad IPv4)
 * into its 8 canonical 16-bit integer groups. Returns null if malformed.
 */
function parseIpv6Groups(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zoneIdx = addr.indexOf('%');
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  // Convert trailing dotted-quad IPv4 (e.g. ::ffff:169.254.169.254) into two hex groups
  const lastColon = addr.lastIndexOf(':');
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes('.')) {
    const ipv4Part = addr.slice(lastColon + 1);
    if (!net.isIPv4(ipv4Part)) return null;
    const octets = ipv4Part.split('.').map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const parsePart = (part: string): number[] | null => {
    if (!part) return [];
    const tokens = part.split(':');
    const nums: number[] = [];
    for (const tok of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
      nums.push(parseInt(tok, 16));
    }
    return nums;
  };

  const left = parsePart(halves[0]);
  const right = halves.length === 2 ? parsePart(halves[1]) : [];
  if (!left || !right) return null;

  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }

  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function groupsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isPrivateIp(ip: string): boolean {
  let normalized = ip.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  const zoneIdx = normalized.indexOf('%');
  const withoutZone = zoneIdx !== -1 ? normalized.slice(0, zoneIdx) : normalized;

  if (net.isIPv4(withoutZone)) {
    return isPrivateIpv4(withoutZone);
  }
  if (net.isIPv6(withoutZone)) {
    const g = parseIpv6Groups(withoutZone);
    if (!g) return true;

    const allFirstSixZero =
      g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    // Unspecified (::), loopback (::1), and deprecated IPv4-compatible (::/96)
    if (allFirstSixZero) return true;

    // IPv4-mapped IPv6 (::ffff:0:0/96) — handles both dotted and hex forms (e.g. ::ffff:a9fe:a9fe)
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return isPrivateIpv4(groupsToIpv4(g[6], g[7]));
    }

    // NAT64 well-known prefix (64:ff9b::/96) — check embedded IPv4
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return isPrivateIpv4(groupsToIpv4(g[6], g[7]));
    }

    // Local-use NAT64 prefix (64:ff9b:1::/48)
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0x0001) return true;

    // Discard-only prefix (100::/64)
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;

    // 6to4 (2002::/16) — check embedded IPv4 in groups 1 & 2
    if (g[0] === 0x2002) {
      return isPrivateIpv4(groupsToIpv4(g[1], g[2]));
    }

    // Documentation prefix (2001:db8::/32)
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;

    // Unique local addresses (fc00::/7)
    if ((g[0] & 0xfe00) === 0xfc00) return true;

    // Link-local (fe80::/10) and deprecated site-local (fec0::/10)
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;

    // Multicast (ff00::/8)
    if ((g[0] & 0xff00) === 0xff00) return true;

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
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  const normalizedHost = host.replace(/\.+$/, '');

  if (
    !normalizedHost ||
    normalizedHost === 'localhost' ||
    normalizedHost.endsWith('.localhost') ||
    normalizedHost.endsWith('.local') ||
    normalizedHost.endsWith('.internal') ||
    normalizedHost === 'metadata.google.internal'
  ) {
    throw new Error('Запрос к локальным и внутренним адресам запрещён');
  }

  const ipCandidate = normalizedHost.split('%')[0];
  if (net.isIP(ipCandidate)) {
    if (isPrivateIp(normalizedHost)) {
      throw new Error('Запрос к приватным IP-адресам запрещён');
    }
    return parsed;
  }

  const records = await dns.lookup(normalizedHost, { all: true });
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
