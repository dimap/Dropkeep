import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { scrapeArticleForPdf } from './scraper.ts';
import { assertSafeFetchUrl } from './security.ts';
import type { ArticleBlock, BookmarkRecord } from './types.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const SNAPSHOTS_DIR = path.resolve(DATA_DIR, 'snapshots');

if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB cap
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB cap for embedded cover image

export type PdfEngineStatus = 'chromium' | 'chromium_unreachable' | 'builtin';

let cachedGotenbergCheck: { status: PdfEngineStatus; checkedAt: number } | null = null;
const GOTENBERG_HEALTH_TTL_MS = 15_000;

export function getActivePdfEngine(): 'chromium' | 'builtin' {
  return process.env.GOTENBERG_URL && process.env.GOTENBERG_URL.trim().length > 0
    ? 'chromium'
    : 'builtin';
}

export async function checkGotenbergHealth(): Promise<PdfEngineStatus> {
  const gotenbergBase = process.env.GOTENBERG_URL?.trim();
  if (!gotenbergBase) return 'builtin';

  const now = Date.now();
  if (cachedGotenbergCheck && now - cachedGotenbergCheck.checkedAt < GOTENBERG_HEALTH_TTL_MS) {
    return cachedGotenbergCheck.status;
  }

  try {
    const healthUrl = new URL('/health', gotenbergBase);
    if (healthUrl.protocol !== 'http:' && healthUrl.protocol !== 'https:') {
      cachedGotenbergCheck = { status: 'chromium_unreachable', checkedAt: now };
      return 'chromium_unreachable';
    }
    const res = await fetch(healthUrl.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    const status: PdfEngineStatus = res.ok ? 'chromium' : 'chromium_unreachable';
    cachedGotenbergCheck = { status, checkedAt: now };
    return status;
  } catch {
    cachedGotenbergCheck = { status: 'chromium_unreachable', checkedAt: now };
    return 'chromium_unreachable';
  }
}

function resolveSnapshotPath(bookmarkId: string): string {
  if (!SAFE_ID_RE.test(bookmarkId)) {
    throw new Error('Некорректный идентификатор закладки');
  }
  const candidate = path.resolve(SNAPSHOTS_DIR, `${bookmarkId}.pdf`);
  if (!candidate.startsWith(SNAPSHOTS_DIR + path.sep)) {
    throw new Error('Недопустимый путь к файлу снимка');
  }
  return candidate;
}

function findFont(candidates: string[]): string | null {
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function getFontPaths(): { regular: string | null; bold: string | null; mono: string | null } {
  const regular = findFont([
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ]);
  const bold = findFont([
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  ]);
  const mono = findFont([
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSansMono.ttf',
  ]);
  return { regular, bold, mono };
}

export function getSnapshotFilePath(bookmarkId: string): string | null {
  try {
    const filePath = resolveSnapshotPath(bookmarkId);
    if (fs.existsSync(filePath)) return filePath;
    return null;
  } catch {
    return null;
  }
}

export function removeSnapshotFile(bookmarkId: string): void {
  try {
    const filePath = resolveSnapshotPath(bookmarkId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore missing or invalid id
  }
}

export function getTotalSnapshotsSizeBytes(): number {
  try {
    if (!fs.existsSync(SNAPSHOTS_DIR)) return 0;
    const files = fs.readdirSync(SNAPSHOTS_DIR);
    let total = 0;
    for (const file of files) {
      if (!file.endsWith('.pdf')) continue;
      const full = path.resolve(SNAPSHOTS_DIR, file);
      if (!full.startsWith(SNAPSHOTS_DIR + path.sep)) continue;
      try {
        total += fs.statSync(full).size;
      } catch {
        // skip
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Full-page visual Chromium PDF rendering via Gotenberg sidecar (optional Docker profile).
 * Strictly validates the target bookmark URL against private/internal IPs before delegating.
 */
async function renderFullPageViaGotenberg(
  bookmarkUrl: string,
  tempPath: string
): Promise<boolean> {
  const gotenbergBase = process.env.GOTENBERG_URL?.trim();
  if (!gotenbergBase) return false;

  // Enforce SSRF protection on target URL before asking Chromium sidecar to open it
  const safeTarget = await assertSafeFetchUrl(bookmarkUrl);
  const endpoint = new URL('/forms/chromium/convert/url', gotenbergBase).toString();

  const form = new FormData();
  form.append('url', safeTarget.toString());
  form.append('printBackground', 'true');
  form.append('marginTop', '0.4');
  form.append('marginBottom', '0.4');
  form.append('marginLeft', '0.4');
  form.append('marginRight', '0.4');
  form.append('waitDelay', '1s');
  form.append('emulatedMediaType', 'screen');

  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) return false;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/pdf')) return false;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) return false;
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') return false;

  fs.writeFileSync(tempPath, buffer);
  return true;
}

/**
 * Safely fetches a remote JPEG/PNG cover image for embedding in built-in PDF snapshots.
 */
async function fetchEmbeddableImage(rawUrl: string): Promise<Buffer | null> {
  if (!rawUrl || (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://'))) {
    return null;
  }
  try {
    const safeUrl = await assertSafeFetchUrl(rawUrl);
    const res = await fetch(safeUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'DropkeepBookmarkBot/1.0 (+self-hosted)' },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('image/jpeg') && !ct.includes('image/png')) return null;

    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0 || arr.byteLength > MAX_IMAGE_BYTES) return null;
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

export async function generateBookmarkPdfSnapshot(
  bookmark: BookmarkRecord
): Promise<{ sizeBytes: number; createdAt: string; readerContent: string }> {
  const targetPath = resolveSnapshotPath(bookmark.id);
  const tempPath = `${targetPath}.tmp`;
  const createdAt = new Date().toISOString();

  // Scrape clean article text in parallel (also keeps offline text searchable)
  const scraped = await scrapeArticleForPdf(bookmark.url);
  const readerContent = scraped?.reader_content || bookmark.reader_content || '';

  // 1. Try full visual webpage rendering via Gotenberg/Chromium if configured in Docker
  if (getActivePdfEngine() === 'chromium') {
    try {
      const ok = await renderFullPageViaGotenberg(bookmark.url, tempPath);
      if (ok) {
        fs.renameSync(tempPath, targetPath);
        const sizeBytes = fs.statSync(targetPath).size;
        return { sizeBytes, createdAt, readerContent };
      }
    } catch {
      // Fall through gracefully to built-in pdfkit archiver
    }
  }

  // 2. Built-in lightweight A4 PDF archiver (works everywhere without Chromium)
  let blocks: ArticleBlock[] = scraped?.blocks || [];
  if (blocks.length === 0 && readerContent.trim()) {
    blocks = readerContent
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .map((text) => ({ kind: 'p' as const, text }));
  }

  const coverBuffer = await fetchEmbeddableImage(bookmark.cover);
  const fonts = getFontPaths();
  const fontRegular = fonts.regular ? 'BodyRegular' : 'Helvetica';
  const fontBold = fonts.bold ? 'BodyBold' : fontRegular;
  const fontMono = fonts.mono ? 'BodyMono' : 'Courier';

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 54, bottom: 58, left: 52, right: 52 },
      bufferPages: true,
      info: {
        Title: bookmark.title,
        Author: scraped?.author || bookmark.domain || 'Dropkeep',
        Subject: bookmark.url,
        Creator: 'Dropkeep Offline Archive',
      },
    });

    if (fonts.regular) doc.registerFont('BodyRegular', fonts.regular);
    if (fonts.bold) doc.registerFont('BodyBold', fonts.bold);
    if (fonts.mono) doc.registerFont('BodyMono', fonts.mono);

    const stream = fs.createWriteStream(tempPath);
    doc.pipe(stream);

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const archivedDate = new Date(createdAt).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    // Kicker header
    doc
      .font(fontBold)
      .fontSize(8.5)
      .fillColor('#0B72E7')
      .text(`DROPKEEP  ·  ОФЛАЙН-КОПИЯ  ·  ${archivedDate}`, { width: contentWidth });

    doc.moveDown(0.5);

    // Document Title
    doc
      .font(fontBold)
      .fontSize(19)
      .fillColor('#181A1F')
      .text(bookmark.title || scraped?.title || bookmark.domain, {
        width: contentWidth,
        lineGap: 3,
      });

    doc.moveDown(0.35);

    // Source URL & metadata line
    doc
      .font(fontRegular)
      .fontSize(9.5)
      .fillColor('#5F6672')
      .text(bookmark.url, {
        width: contentWidth,
        link: bookmark.url,
        underline: false,
      });

    const metaParts: string[] = [];
    if (bookmark.domain) metaParts.push(bookmark.domain);
    if (scraped?.author) metaParts.push(`Автор: ${scraped.author}`);
    if (bookmark.tags.length > 0) metaParts.push(bookmark.tags.map((t) => `#${t}`).join('  '));

    if (metaParts.length > 0) {
      doc.moveDown(0.2);
      doc
        .font(fontRegular)
        .fontSize(9)
        .fillColor('#7A828F')
        .text(metaParts.join('   ·   '), { width: contentWidth });
    }

    doc.moveDown(0.7);
    doc
      .strokeColor('#E2E6EC')
      .lineWidth(0.8)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(0.9);

    // Embed cover image if available (JPEG/PNG)
    if (coverBuffer) {
      try {
        doc.image(coverBuffer, doc.page.margins.left, doc.y, {
          fit: [contentWidth, 210],
          align: 'center',
        });
        doc.moveDown(1);
      } catch {
        // Ignore unsupported image sub-formats
      }
    }

    // Excerpt lead
    const leadExcerpt = bookmark.excerpt || scraped?.excerpt || '';
    if (leadExcerpt) {
      doc
        .font(fontRegular)
        .fontSize(11)
        .fillColor('#3B4252')
        .text(leadExcerpt, { width: contentWidth, lineGap: 4 });
      doc.moveDown(0.85);
    }

    // Personal Note
    if (bookmark.note.trim()) {
      const boxY = doc.y;
      const noteText = `Личная заметка: ${bookmark.note.trim()}`;
      const noteHeight = doc.font(fontRegular).fontSize(9.5).heightOfString(noteText, {
        width: contentWidth - 20,
        lineGap: 3,
      });
      doc
        .roundedRect(doc.page.margins.left, boxY, contentWidth, noteHeight + 16, 4)
        .fill('#F3F6FA');
      doc
        .font(fontRegular)
        .fontSize(9.5)
        .fillColor('#1E293B')
        .text(noteText, doc.page.margins.left + 10, boxY + 8, {
          width: contentWidth - 20,
          lineGap: 3,
        });
      doc.x = doc.page.margins.left;
      doc.y = boxY + noteHeight + 26;
    }

    // Saved Highlights
    if (bookmark.highlights.length > 0) {
      doc
        .font(fontBold)
        .fontSize(11.5)
        .fillColor('#181A1F')
        .text('Сохранённые выделения', { width: contentWidth });
      doc.moveDown(0.4);

      for (const hl of bookmark.highlights) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc
          .font(fontRegular)
          .fontSize(10)
          .fillColor('#1F2937')
          .text(`«${hl.text}»`, doc.page.margins.left + 12, doc.y, {
            width: contentWidth - 12,
            lineGap: 3,
          });
        if (hl.note) {
          doc
            .font(fontRegular)
            .fontSize(9)
            .fillColor('#64748B')
            .text(`— ${hl.note}`, doc.page.margins.left + 12, doc.y + 2, {
              width: contentWidth - 12,
            });
        }
        doc.x = doc.page.margins.left;
        doc.moveDown(0.5);
      }
      doc.moveDown(0.5);
    }

    // Structured Article Body
    if (blocks.length > 0) {
      for (const block of blocks) {
        if (doc.y > doc.page.height - 96) doc.addPage();

        if (block.kind === 'h1' || block.kind === 'h2') {
          doc.moveDown(0.5);
          doc
            .font(fontBold)
            .fontSize(block.kind === 'h1' ? 14 : 12.5)
            .fillColor('#181A1F')
            .text(block.text, doc.page.margins.left, doc.y, {
              width: contentWidth,
              lineGap: 3,
            });
          doc.moveDown(0.35);
        } else if (block.kind === 'h3') {
          doc.moveDown(0.35);
          doc
            .font(fontBold)
            .fontSize(11)
            .fillColor('#2C313A')
            .text(block.text, doc.page.margins.left, doc.y, {
              width: contentWidth,
              lineGap: 2.5,
            });
          doc.moveDown(0.25);
        } else if (block.kind === 'quote') {
          doc
            .font(fontRegular)
            .fontSize(10)
            .fillColor('#475569')
            .text(block.text, doc.page.margins.left + 14, doc.y, {
              width: contentWidth - 14,
              lineGap: 3.5,
            });
          doc.x = doc.page.margins.left;
          doc.moveDown(0.5);
        } else if (block.kind === 'li') {
          doc
            .font(fontRegular)
            .fontSize(10)
            .fillColor('#24292F')
            .text(`•  ${block.text}`, doc.page.margins.left + 8, doc.y, {
              width: contentWidth - 8,
              lineGap: 3,
            });
          doc.x = doc.page.margins.left;
          doc.moveDown(0.28);
        } else if (block.kind === 'code') {
          doc
            .font(fontMono)
            .fontSize(8.5)
            .fillColor('#1E293B')
            .text(block.text.slice(0, 1200), doc.page.margins.left + 8, doc.y, {
              width: contentWidth - 16,
              lineGap: 2,
            });
          doc.x = doc.page.margins.left;
          doc.moveDown(0.5);
        } else {
          doc
            .font(fontRegular)
            .fontSize(10.5)
            .fillColor('#24292F')
            .text(block.text, doc.page.margins.left, doc.y, {
              width: contentWidth,
              lineGap: 4,
            });
          doc.moveDown(0.55);
        }
      }
    } else if (!leadExcerpt && !bookmark.note.trim()) {
      doc
        .font(fontRegular)
        .fontSize(10.5)
        .fillColor('#64748B')
        .text(
          'Исходный сайт не отдал текстовую версию HTML (возможна защита от ботов или медиа-страница). Сохранена карточка закладки, URL и метаданные.',
          { width: contentWidth, lineGap: 4 }
        );
    }

    // Add subtle page footers across all buffered pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 36;
      doc
        .font(fontRegular)
        .fontSize(8.5)
        .fillColor('#8B929E')
        .text(`${bookmark.domain || 'Dropkeep'}`, doc.page.margins.left, footerY, {
          width: contentWidth / 2,
          lineBreak: false,
        });
      doc
        .font(fontRegular)
        .fontSize(8.5)
        .fillColor('#8B929E')
        .text(`Стр. ${i + 1} из ${range.count}`, doc.page.margins.left + contentWidth / 2, footerY, {
          width: contentWidth / 2,
          align: 'right',
          lineBreak: false,
        });
    }

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', (err) => reject(err));
  });

  fs.renameSync(tempPath, targetPath);
  const sizeBytes = fs.statSync(targetPath).size;

  return { sizeBytes, createdAt, readerContent };
}
