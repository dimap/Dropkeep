import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeFetchUrl } from './security.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const COVERS_DIR = path.resolve(DATA_DIR, 'covers');

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

const MAX_SCREENSHOT_BYTES = 1_200_000; // 1.2 MB hard cap for lightweight cover thumbnails
const UUID_COVER_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/i;

export function isBrowserConfigured(): boolean {
  return Boolean(process.env.GOTENBERG_URL && process.env.GOTENBERG_URL.trim().length > 0);
}

function detectImageExtension(buf: Buffer): 'webp' | 'jpg' | 'png' | null {
  if (buf.byteLength < 12) return null;
  // WebP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'png';
  }
  return null;
}

/**
 * Captures a compact, lightweight 800x500 WebP viewport screenshot via Gotenberg Chromium
 * when a webpage has no og:image cover. Strictly enforces SSRF validation first.
 */
export async function captureCoverScreenshot(rawUrl: string): Promise<string> {
  const gotenbergBase = process.env.GOTENBERG_URL?.trim();
  if (!gotenbergBase) return '';

  try {
    const safeTarget = await assertSafeFetchUrl(rawUrl);
    const endpoint = new URL('/forms/chromium/screenshot/url', gotenbergBase);
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
      return '';
    }

    const form = new FormData();
    form.append('url', safeTarget.toString());
    form.append('width', '800');
    form.append('height', '500');
    form.append('clip', 'true');
    form.append('format', 'webp');
    form.append('quality', '72');
    form.append('optimizeForSpeed', 'true');
    form.append('waitDelay', '1s');

    const response = await fetch(endpoint.toString(), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(18_000),
    });

    if (!response.ok) return '';

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_SCREENSHOT_BYTES) {
      return '';
    }

    const ext = detectImageExtension(buffer);
    if (!ext) return '';

    const filename = `${crypto.randomUUID()}.${ext}`;
    const targetPath = path.resolve(COVERS_DIR, filename);
    if (!targetPath.startsWith(COVERS_DIR + path.sep)) {
      return '';
    }

    const tempPath = `${targetPath}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, targetPath);

    return `/api/covers/${filename}`;
  } catch {
    return '';
  }
}

export function getCoverScreenshotPath(
  filename: string
): { filePath: string; contentType: string } | null {
  if (!UUID_COVER_RE.test(filename)) return null;
  const candidate = path.resolve(COVERS_DIR, filename);
  if (!candidate.startsWith(COVERS_DIR + path.sep)) return null;
  if (!fs.existsSync(candidate)) return null;

  const lower = filename.toLowerCase();
  const contentType = lower.endsWith('.webp')
    ? 'image/webp'
    : lower.endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';

  return { filePath: candidate, contentType };
}

export function removeCoverScreenshotByUrl(coverUrl: string | null | undefined): void {
  if (!coverUrl || !coverUrl.startsWith('/api/covers/')) return;
  const filename = coverUrl.slice('/api/covers/'.length);
  const resolved = getCoverScreenshotPath(filename);
  if (!resolved) return;
  try {
    fs.unlinkSync(resolved.filePath);
  } catch {
    // ignore cleanup error
  }
}
