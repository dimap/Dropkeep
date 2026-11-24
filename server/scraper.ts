import * as cheerio from 'cheerio';
import { assertSafeFetchUrl, extractDomain, sanitizeMediaUrl } from './security.ts';
import type { ArticleBlock, BookmarkType, ScrapedArticle, ScrapedMetadata } from './types.ts';

const MAX_BYTES = 1_500_000; // 1.5 MB limit
const MAX_REDIRECTS = 3;

function detectTypeFromUrl(url: URL, contentType: string): BookmarkType {
  const ct = contentType.toLowerCase();
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif)$/.test(path)) {
    return 'image';
  }
  if (ct === 'application/pdf' || /\.(pdf|docx?|pptx?|xlsx?|epub)$/.test(path)) {
    return 'document';
  }
  if (
    ct.startsWith('video/') ||
    host.includes('youtube.com') ||
    host === 'youtu.be' ||
    host.includes('vimeo.com') ||
    host.includes('twitch.tv') ||
    host.includes('rutube.ru') ||
    /\.(mp4|webm|mov)$/.test(path)
  ) {
    return 'video';
  }
  return 'link';
}

function resolveRelativeUrl(candidate: string | undefined, base: URL): string {
  if (!candidate) return '';
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) return '';
  try {
    const resolved = new URL(trimmed, base);
    return sanitizeMediaUrl(resolved.toString());
  } catch {
    return '';
  }
}

async function safeFetchWithRedirects(rawUrl: string): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = await assertSafeFetchUrl(rawUrl);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(7500),
      headers: {
        'User-Agent': 'DropkeepBookmarkBot/1.0 (+self-hosted)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { response, finalUrl: currentUrl };
      }
      const nextUrl = new URL(location, currentUrl);
      currentUrl = await assertSafeFetchUrl(nextUrl.toString());
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error('Превышено максимальное число перенаправлений');
}

async function readTextLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - MAX_BYTES))));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

function extractBlocksFromHtml($: cheerio.CheerioAPI): ArticleBlock[] {
  $('script, style, noscript, iframe, svg, nav, footer, header, aside, form, button, [role="navigation"]').remove();

  const articleRoot = $('article').first().length
    ? $('article').first()
    : $('main').first().length
      ? $('main').first()
      : $('body');

  const blocks: ArticleBlock[] = [];
  const seen = new Set<string>();

  articleRoot.find('h1, h2, h3, p, blockquote, li, pre').each((_, el) => {
    if (blocks.length >= 160) return;
    const tagName = el.type === 'tag' ? el.name.toLowerCase() : '';
    const rawText = tagName === 'pre'
      ? $(el).text().replace(/\r\n/g, '\n').trim()
      : $(el).text().replace(/\s+/g, ' ').trim();

    if (!rawText) return;
    if (tagName === 'p' && rawText.length < 20) return;
    if (tagName === 'li' && rawText.length < 8) return;
    if (seen.has(rawText)) return;
    seen.add(rawText);

    const kind: ArticleBlock['kind'] =
      tagName === 'h1'
        ? 'h1'
        : tagName === 'h2'
          ? 'h2'
          : tagName === 'h3'
            ? 'h3'
            : tagName === 'blockquote'
              ? 'quote'
              : tagName === 'li'
                ? 'li'
                : tagName === 'pre'
                  ? 'code'
                  : 'p';

    blocks.push({ kind, text: rawText.slice(0, 2400) });
  });

  return blocks;
}

export async function scrapeUrlMetadata(rawUrl: string): Promise<ScrapedMetadata> {
  const safeUrl = await assertSafeFetchUrl(rawUrl);
  const domain = extractDomain(safeUrl.toString());

  const fallback: ScrapedMetadata = {
    url: safeUrl.toString(),
    title: domain || safeUrl.toString(),
    excerpt: '',
    cover: '',
    favicon: `${safeUrl.origin}/favicon.ico`,
    domain,
    type: detectTypeFromUrl(safeUrl, ''),
    reader_content: '',
  };

  try {
    const { response, finalUrl } = await safeFetchWithRedirects(safeUrl.toString());
    const contentType = response.headers.get('content-type') || '';
    const finalDomain = extractDomain(finalUrl.toString());
    let detectedType = detectTypeFromUrl(finalUrl, contentType);

    if (detectedType === 'image') {
      return {
        ...fallback,
        url: finalUrl.toString(),
        domain: finalDomain,
        title: decodeURIComponent(finalUrl.pathname.split('/').pop() || finalDomain),
        cover: sanitizeMediaUrl(finalUrl.toString()),
        type: 'image',
      };
    }

    if (detectedType === 'document') {
      return {
        ...fallback,
        url: finalUrl.toString(),
        domain: finalDomain,
        title: decodeURIComponent(finalUrl.pathname.split('/').pop() || finalDomain),
        type: 'document',
      };
    }

    if (!contentType.toLowerCase().includes('text/html') && !contentType.toLowerCase().includes('application/xhtml')) {
      return {
        ...fallback,
        url: finalUrl.toString(),
        domain: finalDomain,
        type: detectedType,
      };
    }

    const html = await readTextLimited(response);
    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content');
    const pageTitle = $('title').first().text();
    const title = (ogTitle || pageTitle || finalDomain).replace(/\s+/g, ' ').trim().slice(0, 240);

    const ogDesc =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      '';
    const excerpt = ogDesc.replace(/\s+/g, ' ').trim().slice(0, 480);

    const ogImage =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[property="og:image:url"]').attr('content');
    const cover = resolveRelativeUrl(ogImage, finalUrl);

    const iconHref =
      $('link[rel="icon"]').attr('href') ||
      $('link[rel="shortcut icon"]').attr('href') ||
      $('link[rel="apple-touch-icon"]').attr('href');
    const favicon = resolveRelativeUrl(iconHref, finalUrl) || `${finalUrl.origin}/favicon.ico`;

    const ogType = ($('meta[property="og:type"]').attr('content') || '').toLowerCase();
    if (detectedType === 'link') {
      if (ogType.includes('article') || $('article').length > 0) {
        detectedType = 'article';
      } else if (ogType.includes('video')) {
        detectedType = 'video';
      }
    }

    const blocks = extractBlocksFromHtml($);
    const reader_content = blocks
      .map((b) => b.text)
      .join('\n\n')
      .slice(0, 15000);

    return {
      url: finalUrl.toString(),
      title: title || finalDomain,
      excerpt,
      cover,
      favicon,
      domain: finalDomain,
      type: detectedType,
      reader_content,
    };
  } catch {
    return fallback;
  }
}

/**
 * Fetches and parses structured article blocks for offline PDF generation.
 * Returns null if the remote site is unreachable or non-HTML, allowing callers
 * to gracefully fall back to stored bookmark reader_content/excerpt/notes.
 */
export async function scrapeArticleForPdf(rawUrl: string): Promise<ScrapedArticle | null> {
  try {
    const { response } = await safeFetchWithRedirects(rawUrl);
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null;
    }

    const html = await readTextLimited(response);
    const $ = cheerio.load(html);

    const title = (
      $('meta[property="og:title"]').attr('content') ||
      $('title').first().text() ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);

    const excerpt = (
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);

    const author = (
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    const blocks = extractBlocksFromHtml($);
    const reader_content = blocks
      .map((b) => b.text)
      .join('\n\n')
      .slice(0, 15000);

    if (!blocks.length && !excerpt) return null;

    return { title, excerpt, author, blocks, reader_content };
  } catch {
    return null;
  }
}
