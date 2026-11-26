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
const MAX_UPLOAD_IMAGE_BYTES = 5_000_000; // 5 MB hard cap for user-uploaded note images
const UUID_COVER_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png|gif)$/i;
const DATA_URL_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

export function isBrowserConfigured(): boolean {
  return Boolean(process.env.GOTENBERG_URL && process.env.GOTENBERG_URL.trim().length > 0);
}

function detectImageExtension(buf: Buffer): 'webp' | 'jpg' | 'png' | 'gif' | null {
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
  // GIF: GIF87a / GIF89a
  const gifSig = buf.subarray(0, 6).toString('ascii');
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return 'gif';
  }
  return null;
}

/**
 * Validates and saves a user-uploaded image (PNG/JPEG/WebP/GIF, up to 5 MB)
 * into the confined COVERS_DIR with a random UUID filename.
 */
export function saveUploadedCoverImage(dataUrl: string): string {
  if (typeof dataUrl !== 'string') {
    throw new Error('Некорректный формат изображения');
  }
  const trimmed = dataUrl.trim();
  const match = DATA_URL_IMAGE_RE.exec(trimmed);
  if (!match) {
    throw new Error('Поддерживаются только изображения PNG, JPEG, WebP или GIF');
  }

  const base64Payload = match[2].replace(/\s+/g, '');
  // Quick pre-decode size guard (~6.8 MB base64 for 5 MB binary)
  if (base64Payload.length === 0 || base64Payload.length > 7_000_000) {
    throw new Error('Размер изображения превышает допустимый лимит (5 МБ)');
  }

  const buffer = Buffer.from(base64Payload, 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error('Размер изображения превышает допустимый лимит (5 МБ)');
  }

  const ext = detectImageExtension(buffer);
  if (!ext) {
    throw new Error('Файл не является корректным изображением PNG, JPEG, WebP или GIF');
  }

  const filename = `${crypto.randomUUID()}.${ext}`;
  const targetPath = path.resolve(COVERS_DIR, filename);
  if (!targetPath.startsWith(COVERS_DIR + path.sep)) {
    throw new Error('Недопустимый путь сохранения файла');
  }

  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, targetPath);

  return `/api/covers/${filename}`;
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
      : lower.endsWith('.gif')
        ? 'image/gif'
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
