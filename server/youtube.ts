import * as cheerio from 'cheerio';
import { assertSafeFetchUrl, sanitizeMediaUrl } from './security.ts';
import type { ArticleBlock, ScrapedArticle, ScrapedMetadata } from './types.ts';

const MAX_YT_BYTES = 2_200_000;
const YT_TIMEOUT_MS = 8500;
const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

interface PlayerResponseData {
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    shortDescription?: string;
    author?: string;
    thumbnail?: {
      thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
    };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
}

interface WatchPageExtract {
  player: PlayerResponseData | null;
  title: string;
  author: string;
  description: string;
  chapters: string[];
  apiKey: string;
  clientVersion: string;
  visitorData: string;
  transcriptParams: string;
}

export interface YouTubeVideoDetails {
  videoId: string;
  canonicalUrl: string;
  title: string;
  author: string;
  lengthSeconds: number;
  description: string;
  chapters: string[];
  transcript: string;
  transcriptLang: string;
  cover: string;
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YT_HOSTS.has(host)) {
    return null;
  }

  let candidate = '';
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidate = parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
  } else {
    const vParam = parsed.searchParams.get('v');
    if (vParam) {
      candidate = vParam.trim();
    } else {
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (
        segments.length >= 2 &&
        (segments[0] === 'shorts' ||
          segments[0] === 'live' ||
          segments[0] === 'embed' ||
          segments[0] === 'v')
      ) {
        candidate = segments[1];
      }
    }
  }

  return VIDEO_ID_REGEX.test(candidate) ? candidate : null;
}

export function isYouTubeUrl(rawUrl: string): boolean {
  return extractYouTubeVideoId(rawUrl) !== null;
}

async function readTextLimited(response: Response, limitBytes = MAX_YT_BYTES): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limitBytes) {
        chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - limitBytes))));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function extractBalancedJson(source: string, marker: string): Record<string, unknown> | null {
  const idx = source.indexOf(marker);
  if (idx === -1) return null;

  const start = source.indexOf('{', idx + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = source.slice(start, i + 1);
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
        return null;
      }
    }
  }

  return null;
}

function decodeJsonStringLiteral(rawEscaped: string): string {
  try {
    return JSON.parse(`"${rawEscaped}"`) as string;
  } catch {
    return rawEscaped;
  }
}

function extractChaptersFromHtml(html: string): string[] {
  const chapters: string[] = [];
  const seen = new Set<string>();
  const regex =
    /"macroMarkersListItemRenderer":\{"title":\{"simpleText":"((?:\\.|[^"\\])*)"\}[\s\S]{0,400}?"timeDescription":\{"simpleText":"((?:\\.|[^"\\])*)"\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null && chapters.length < 30) {
    const label = decodeJsonStringLiteral(match[1]).replace(/\s+/g, ' ').trim();
    const time = decodeJsonStringLiteral(match[2]).replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const entry = time ? `${time} — ${label}` : label;
    if (seen.has(entry)) continue;
    seen.add(entry);
    chapters.push(entry);
  }
  return chapters;
}

async function fetchInnerTubePlayer(videoId: string): Promise<PlayerResponseData | null> {
  // Hardcoded safe endpoint; videoId is strictly /^[A-Za-z0-9_-]{11}$/
  const endpoint = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
  await assertSafeFetchUrl(endpoint);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 30,
            hl: 'ru',
            gl: 'US',
          },
        },
        videoId,
      }),
    });

    if (!response.ok) return null;
    const text = await readTextLimited(response, MAX_YT_BYTES);
    const parsed = JSON.parse(text) as PlayerResponseData;
    if (parsed && typeof parsed === 'object' && parsed.videoDetails?.title) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWatchPageData(videoId: string): Promise<WatchPageExtract | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=ru`;
  await assertSafeFetchUrl(watchUrl);

  try {
    const response = await fetch(watchUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+678',
      },
    });
    if (!response.ok) return null;
    const html = await readTextLimited(response, MAX_YT_BYTES);

    const playerObj =
      extractBalancedJson(html, 'var ytInitialPlayerResponse =') ||
      extractBalancedJson(html, 'ytInitialPlayerResponse =');
    const player = playerObj ? (playerObj as unknown as PlayerResponseData) : null;

    // Extract full description & metadata from ytInitialData even if player is gated
    const descMatch = html.match(/"attributedDescription":\{"content":"((?:\\.|[^"\\])*)"/);
    const description = descMatch ? decodeJsonStringLiteral(descMatch[1]).trim() : '';

    const titleMatch = html.match(
      /"videoPrimaryInfoRenderer":\{"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/
    );
    const title = titleMatch
      ? decodeJsonStringLiteral(titleMatch[1]).replace(/\s+/g, ' ').trim().slice(0, 240)
      : '';

    const authorMatch = html.match(
      /"videoOwnerRenderer":\{[\s\S]{0,600}?"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/
    );
    const author = authorMatch
      ? decodeJsonStringLiteral(authorMatch[1]).replace(/\s+/g, ' ').trim().slice(0, 140)
      : '';

    const chapters = extractChaptersFromHtml(html);

    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || '';
    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || '';
    const visitorData = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1] || '';
    const transcriptParams = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"\}/)?.[1] || '';

    return {
      player,
      title,
      author,
      description,
      chapters,
      apiKey,
      clientVersion,
      visitorData,
      transcriptParams,
    };
  } catch {
    return null;
  }
}

async function fetchTranscriptViaInnerTubeEndpoint(
  videoId: string,
  extract: WatchPageExtract
): Promise<string> {
  if (!extract.apiKey || !extract.transcriptParams) return '';
  if (!/^[A-Za-z0-9_-]{10,120}$/.test(extract.apiKey)) return '';

  const endpoint = `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(
    extract.apiKey
  )}`;
  await assertSafeFetchUrl(endpoint);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.youtube.com',
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
        'User-Agent': BROWSER_UA,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': extract.clientVersion || '2.20250101.00.00',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: extract.clientVersion || '2.20250101.00.00',
            hl: 'ru',
            ...(extract.visitorData ? { visitorData: extract.visitorData } : {}),
          },
        },
        params: extract.transcriptParams,
      }),
    });

    if (!response.ok) return '';
    const body = await readTextLimited(response, 1_200_000);
    const cues: string[] = [];
    const regex = /"snippet":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      const txt = decodeJsonStringLiteral(match[1]);
      if (txt.trim()) cues.push(txt);
    }
    return cleanTranscriptSegments(cues);
  } catch {
    return '';
  }
}

async function fetchYouTubeOEmbed(
  videoId: string
): Promise<{ title?: string; author_name?: string; thumbnail_url?: string } | null> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;
  await assertSafeFetchUrl(oembedUrl);

  try {
    const response = await fetch(oembedUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const text = await readTextLimited(response, 64_000);
    return JSON.parse(text) as { title?: string; author_name?: string; thumbnail_url?: string };
  } catch {
    return null;
  }
}

function selectBestCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const valid = tracks.filter(
    (t) => typeof t.baseUrl === 'string' && t.baseUrl.startsWith('https://')
  );
  if (valid.length === 0) return null;

  const isLang = (t: CaptionTrack, prefix: string) =>
    (t.languageCode || '').toLowerCase().startsWith(prefix);
  const isManual = (t: CaptionTrack) => t.kind !== 'asr';

  return (
    valid.find((t) => isLang(t, 'ru') && isManual(t)) ||
    valid.find((t) => isLang(t, 'ru')) ||
    valid.find((t) => isLang(t, 'en') && isManual(t)) ||
    valid.find((t) => isLang(t, 'en')) ||
    valid.find((t) => isManual(t)) ||
    valid[0]
  );
}

async function validateCaptionUrl(rawBaseUrl: string): Promise<URL | null> {
  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) {
      return null;
    }
    return await assertSafeFetchUrl(parsed.toString());
  } catch {
    return null;
  }
}

function cleanTranscriptSegments(rawSegments: string[]): string {
  const cleaned: string[] = [];
  let prevLower = '';

  for (const seg of rawSegments) {
    const line = seg
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!line) continue;
    // Skip pure non-speech markers like [Music] or [Музыка]
    if (/^\[[^\]]{1,24}\]$/.test(line)) continue;

    const lower = line.toLowerCase();
    if (lower === prevLower) continue;
    prevLower = lower;
    cleaned.push(line);
  }

  // Group into readable chunks of ~450 chars
  const paragraphs: string[] = [];
  let buffer = '';
  for (const part of cleaned) {
    if (!buffer) {
      buffer = part;
    } else if (buffer.length + part.length + 1 <= 460) {
      buffer = `${buffer} ${part}`;
    } else {
      paragraphs.push(buffer);
      buffer = part;
    }
  }
  if (buffer) paragraphs.push(buffer);

  return paragraphs.join('\n\n').slice(0, 11_500).trim();
}

function parseJson3Transcript(rawText: string): string {
  try {
    const data = JSON.parse(rawText) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };
    if (!Array.isArray(data.events)) return '';
    const segments: string[] = [];
    for (const ev of data.events) {
      if (!Array.isArray(ev.segs)) continue;
      const line = ev.segs.map((s) => s.utf8 || '').join('');
      if (line.trim()) segments.push(line);
    }
    return cleanTranscriptSegments(segments);
  } catch {
    return '';
  }
}

function parseXmlTranscript(rawXml: string): string {
  try {
    const $ = cheerio.load(rawXml, { xmlMode: true });
    const segments: string[] = [];

    const textNodes = $('text');
    if (textNodes.length > 0) {
      textNodes.each((_, el) => {
        const txt = $(el).text();
        if (txt.trim()) segments.push(txt);
      });
    } else {
      $('p').each((_, el) => {
        const txt = $(el).text();
        if (txt.trim()) segments.push(txt);
      });
    }

    return cleanTranscriptSegments(segments);
  } catch {
    return '';
  }
}

async function fetchCaptionTranscript(track: CaptionTrack): Promise<string> {
  if (!track.baseUrl) return '';
  const safeBase = await validateCaptionUrl(track.baseUrl);
  if (!safeBase) return '';

  // Attempt JSON3 first for cleanest segmentation
  try {
    const jsonUrl = new URL(safeBase.toString());
    jsonUrl.searchParams.set('fmt', 'json3');
    const res = await fetch(jsonUrl.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json,text/xml,*/*',
      },
    });
    if (res.ok) {
      const body = await readTextLimited(res, 1_200_000);
      const trimmed = body.trim();
      if (trimmed.startsWith('{')) {
        const parsed = parseJson3Transcript(trimmed);
        if (parsed.length >= 20) return parsed;
      } else if (trimmed.startsWith('<')) {
        const parsed = parseXmlTranscript(trimmed);
        if (parsed.length >= 20) return parsed;
      }
    }
  } catch {
    // Fallback to raw baseUrl XML below
  }

  // Fallback: fetch baseUrl as-is (XML timedtext)
  try {
    const res = await fetch(safeBase.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(YT_TIMEOUT_MS),
      headers: { 'User-Agent': BROWSER_UA },
    });
    if (!res.ok) return '';
    const body = await readTextLimited(res, 1_200_000);
    const trimmed = body.trim();
    if (trimmed.startsWith('<')) {
      return parseXmlTranscript(trimmed);
    }
    if (trimmed.startsWith('{')) {
      return parseJson3Transcript(trimmed);
    }
    return '';
  } catch {
    return '';
  }
}

function pickBestThumbnail(
  videoId: string,
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>
): string {
  if (Array.isArray(thumbnails) && thumbnails.length > 0) {
    const sorted = [...thumbnails]
      .filter((t) => typeof t.url === 'string' && t.url.startsWith('https://'))
      .sort((a, b) => (b.width || 0) - (a.width || 0));
    const best = sorted[0]?.url;
    if (best) {
      const safe = sanitizeMediaUrl(best);
      if (safe) return safe;
    }
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function buildCleanExcerptFromDescription(description: string, author: string, duration: string): string {
  const lines = description
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^https?:\/\/\S+$/i.test(l))
    .filter((l) => !/^(?:\d{1,2}:)?\d{1,2}:\d{2}\b/.test(l))
    .filter((l) => !/^#\S+(\s+#\S+)*$/.test(l));

  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (joined.length >= 16) {
    return joined.slice(0, 420);
  }

  const metaParts: string[] = [];
  if (author) metaParts.push(`Канал: ${author}`);
  if (duration) metaParts.push(`Длительность: ${duration}`);
  return metaParts.join(' · ');
}

function buildYouTubeReaderContent(details: YouTubeVideoDetails): string {
  const sections: string[] = [];
  const headerParts = ['YouTube видео'];
  if (details.author) headerParts.push(`Канал: ${details.author}`);
  const dur = formatDuration(details.lengthSeconds);
  if (dur) headerParts.push(`Длительность: ${dur}`);
  sections.push(headerParts.join(' · '));

  if (details.chapters.length > 0) {
    sections.push(`Главы видео:\n${details.chapters.join('\n')}`);
  }

  const cleanDesc = details.description.trim();
  if (cleanDesc) {
    sections.push(`Описание видео:\n${cleanDesc.slice(0, 2800)}`);
  }

  if (details.transcript) {
    const langTag = details.transcriptLang ? `, ${details.transcriptLang}` : '';
    sections.push(`Расшифровка видео (субтитры${langTag}):\n${details.transcript}`);
  }

  return sections.join('\n\n').slice(0, 15_000);
}

export async function fetchYouTubeVideoDetails(rawUrl: string): Promise<YouTubeVideoDetails | null> {
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) return null;

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  let player = await fetchInnerTubePlayer(videoId);
  let tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  let watchExtract: WatchPageExtract | null = null;

  // Fallback to watch page HTML if InnerTube failed, omitted captions, or omitted description
  if (!player?.videoDetails?.title || tracks.length === 0 || !player?.videoDetails?.shortDescription) {
    watchExtract = await fetchWatchPageData(videoId);
    if (watchExtract?.player) {
      if (!player?.videoDetails?.title && watchExtract.player.videoDetails?.title) {
        player = watchExtract.player;
      }
      const watchTracks =
        watchExtract.player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (tracks.length === 0 && watchTracks.length > 0) {
        tracks = watchTracks;
      }
    }
  }

  let title = (player?.videoDetails?.title || watchExtract?.title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  let author = (player?.videoDetails?.author || watchExtract?.author || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  const description = (
    player?.videoDetails?.shortDescription ||
    watchExtract?.description ||
    ''
  ).trim();
  const chapters = watchExtract?.chapters || [];
  const lengthSeconds = Number.parseInt(player?.videoDetails?.lengthSeconds || '0', 10) || 0;
  let cover = pickBestThumbnail(videoId, player?.videoDetails?.thumbnail?.thumbnails);

  if (!title || !author) {
    const oembed = await fetchYouTubeOEmbed(videoId);
    if (oembed) {
      if (!title && oembed.title) {
        title = oembed.title.replace(/\s+/g, ' ').trim().slice(0, 240);
      }
      if (!author && oembed.author_name) {
        author = oembed.author_name.replace(/\s+/g, ' ').trim().slice(0, 140);
      }
      if (oembed.thumbnail_url && !player?.videoDetails?.thumbnail?.thumbnails?.length) {
        cover = sanitizeMediaUrl(oembed.thumbnail_url) || cover;
      }
    }
  }

  let transcript = '';
  let transcriptLang = '';
  const chosenTrack = selectBestCaptionTrack(tracks);
  if (chosenTrack) {
    transcriptLang = (chosenTrack.languageCode || '').toLowerCase();
    transcript = await fetchCaptionTranscript(chosenTrack);
  }

  // 3rd fallback for transcript: InnerTube get_transcript using params from watch page
  if (!transcript && watchExtract) {
    transcript = await fetchTranscriptViaInnerTubeEndpoint(videoId, watchExtract);
  }

  if (!title && !description && !transcript) {
    return null;
  }

  return {
    videoId,
    canonicalUrl,
    title: title || `YouTube (${videoId})`,
    author,
    lengthSeconds,
    description,
    chapters,
    transcript,
    transcriptLang,
    cover,
  };
}

export async function scrapeYouTubeMetadata(rawUrl: string): Promise<ScrapedMetadata | null> {
  const details = await fetchYouTubeVideoDetails(rawUrl);
  if (!details) return null;

  const duration = formatDuration(details.lengthSeconds);
  const reader_content = buildYouTubeReaderContent(details);
  const excerpt = buildCleanExcerptFromDescription(details.description, details.author, duration);

  return {
    url: rawUrl,
    title: details.title,
    excerpt,
    cover: details.cover,
    favicon: 'https://www.youtube.com/favicon.ico',
    domain: 'youtube.com',
    type: 'video',
    reader_content,
  };
}

export async function scrapeYouTubeArticleForPdf(rawUrl: string): Promise<ScrapedArticle | null> {
  const details = await fetchYouTubeVideoDetails(rawUrl);
  if (!details) return null;

  const duration = formatDuration(details.lengthSeconds);
  const reader_content = buildYouTubeReaderContent(details);
  const excerpt = buildCleanExcerptFromDescription(details.description, details.author, duration);

  const blocks: ArticleBlock[] = [];
  if (details.author || duration) {
    const meta = [
      details.author ? `Канал: ${details.author}` : '',
      duration ? `Длительность: ${duration}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    blocks.push({ kind: 'quote', text: meta });
  }

  if (details.chapters.length > 0) {
    blocks.push({ kind: 'h2', text: 'Главы видео' });
    for (const ch of details.chapters) {
      blocks.push({ kind: 'li', text: ch });
    }
  }

  if (details.description) {
    blocks.push({ kind: 'h2', text: 'Описание видео' });
    for (const para of details.description.split(/\n{2,}/).slice(0, 12)) {
      const clean = para.replace(/\s+/g, ' ').trim();
      if (clean) blocks.push({ kind: 'p', text: clean.slice(0, 2000) });
    }
  }

  if (details.transcript) {
    blocks.push({ kind: 'h2', text: 'Расшифровка видео (субтитры)' });
    for (const para of details.transcript.split(/\n{2,}/).slice(0, 40)) {
      const clean = para.replace(/\s+/g, ' ').trim();
      if (clean) blocks.push({ kind: 'p', text: clean.slice(0, 2000) });
    }
  }

  return {
    title: details.title,
    excerpt,
    author: details.author,
    blocks,
    reader_content,
  };
}
