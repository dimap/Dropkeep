import type { BookmarkRecord } from './types.ts';

export interface AiStatus {
  configured: boolean;
  endpointHost: string;
  model: string;
  hasApiKey: boolean;
}

export interface SmartSearchAiResult {
  matchedIds: string[];
  reasons: Record<string, string>;
  model: string;
  scannedCount: number;
}

export interface BookmarkSummaryAiResult {
  tldr: string;
  bullets: string[];
  model: string;
}

export interface CollectionOption {
  id: string;
  title: string;
  parent_id: string | null;
}

export interface SuggestTagsInput {
  url: string;
  title: string;
  excerpt: string;
  readerContent: string;
  existingTags: string[];
}

export interface SuggestTagsResult {
  tags: string[];
  existingMatches: string[];
  newTags: string[];
  model: string;
}

export interface SuggestEnrichmentInput {
  url: string;
  title: string;
  excerpt: string;
  readerContent: string;
  existingTags: string[];
  collections: CollectionOption[];
  fields: {
    tags?: boolean;
    collection?: boolean;
    excerpt?: boolean;
  };
}

export interface SuggestEnrichmentResult {
  tags: string[];
  existingMatches: string[];
  newTags: string[];
  excerpt: string | null;
  collection_id: string | null;
  collection_title: string | null;
  model: string;
}

function getAiConfig(): { apiUrl: string; apiKey: string; model: string } {
  const apiUrl = (process.env.AI_API_URL || '').trim();
  const apiKey = (process.env.AI_API_KEY || '').trim();
  const model = (process.env.AI_MODEL || '').trim();
  return { apiUrl, apiKey, model };
}

function resolveCompletionsUrl(rawBaseUrl: string): URL {
  const parsed = new URL(rawBaseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI_API_URL должен начинаться с http:// или https://');
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (!cleanPath.endsWith('/chat/completions')) {
    parsed.pathname = `${cleanPath}/chat/completions`;
  }
  return parsed;
}

export function getAiStatus(): AiStatus {
  const { apiUrl, apiKey, model } = getAiConfig();
  let endpointHost = '';
  let validUrl = false;
  if (apiUrl) {
    try {
      const parsed = resolveCompletionsUrl(apiUrl);
      endpointHost = parsed.host;
      validUrl = true;
    } catch {
      validUrl = false;
    }
  }
  return {
    configured: validUrl && Boolean(model),
    endpointHost,
    model,
    hasApiKey: Boolean(apiKey),
  };
}

function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[.,;:!?()[\]{}"'`]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function parseJsonObjectLoose(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = [unfenced];
  const objMatch = unfenced.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function parseTagsFromModelText(rawText: string): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const obj = parseJsonObjectLoose(trimmed);
  if (obj && Array.isArray(obj.tags)) {
    return obj.tags.map((item) => String(item));
  }

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const arrMatch = unfenced.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      // ignore
    }
  }

  return unfenced
    .split(/[,\n;]+/)
    .map((part) => part.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

function buildCollectionPaths(
  collections: CollectionOption[]
): Array<{ id: string; title: string; fullPath: string }> {
  const byId = new Map(collections.map((c) => [c.id, c]));
  return collections.map((col) => {
    const parts: string[] = [col.title];
    let currParent = col.parent_id;
    let depth = 0;
    while (currParent && depth < 12) {
      const p = byId.get(currParent);
      if (!p) break;
      parts.unshift(p.title);
      currParent = p.parent_id;
      depth++;
    }
    return {
      id: col.id,
      title: col.title,
      fullPath: parts.join(' / '),
    };
  });
}

function matchCollectionFromModelValue(
  rawChoice: unknown,
  collectionEntries: Array<{ id: string; title: string; fullPath: string }>
): { id: string; title: string } | null {
  if (typeof rawChoice !== 'string') return null;
  const cleaned = rawChoice
    .trim()
    .replace(/^["'«]+|["'»]+$/g, '')
    .trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  if (
    lower === 'null' ||
    lower === 'none' ||
    lower === 'нет' ||
    lower === 'несортированные' ||
    lower === 'unsorted'
  ) {
    return null;
  }

  // 1. Exact fullPath match
  const exactPath = collectionEntries.find((c) => c.fullPath.toLowerCase() === lower);
  if (exactPath) return { id: exactPath.id, title: exactPath.fullPath };

  // 2. Exact title match
  const exactTitle = collectionEntries.find((c) => c.title.toLowerCase() === lower);
  if (exactTitle) return { id: exactTitle.id, title: exactTitle.fullPath };

  // 3. Leaf segment match if model returned "Parent / Child" with slight spacing diff
  const leaf = lower.split('/').pop()?.trim() || '';
  if (leaf) {
    const byLeaf = collectionEntries.find((c) => c.title.toLowerCase() === leaf);
    if (byLeaf) return { id: byLeaf.id, title: byLeaf.fullPath };
  }

  return null;
}

function sanitizeExcerpt(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'«]+|["'»]+$/g, '')
    .trim()
    .slice(0, 320);
  return cleaned.length >= 8 ? cleaned : null;
}

async function callOpenAiCompatibleChat(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  maxTokens = 260,
  timeoutMs = 25_000
): Promise<{ content: string; model: string }> {
  const { apiUrl, apiKey, model } = getAiConfig();
  if (!apiUrl || !model) {
    throw new Error(
      'ИИ-модель не настроена. Задайте переменные AI_API_URL, AI_API_KEY и AI_MODEL в .env или docker-compose.yml (см. Настройки → ИИ).'
    );
  }

  const endpoint = resolveCompletionsUrl(apiUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = (await response.json()) as { error?: { message?: string } | string };
      if (typeof errJson.error === 'string') {
        detail = errJson.error;
      } else if (errJson.error?.message) {
        detail = errJson.error.message;
      }
    } catch {
      // ignore body parse failure
    }
    const safeDetail = detail ? `: ${detail.slice(0, 180)}` : '';
    throw new Error(`Ошибка ответа ИИ-сервера (HTTP ${response.status})${safeDetail}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('ИИ-модель вернула пустой ответ');
  }

  return { content, model };
}

function finalizeTags(rawList: string[], existingSet: Set<string>): {
  tags: string[];
  existingMatches: string[];
  newTags: string[];
} {
  const uniqueNormalized: string[] = [];
  const seen = new Set<string>();

  for (const item of rawList) {
    const clean = normalizeTag(item);
    if (!clean || clean.length < 2 || seen.has(clean)) continue;
    seen.add(clean);
    uniqueNormalized.push(clean);
  }

  const matchedExisting = uniqueNormalized.filter((t) => existingSet.has(t));
  const newlyCoined = uniqueNormalized.filter((t) => !existingSet.has(t));
  const finalTags = [...matchedExisting, ...newlyCoined].slice(0, 3);

  return {
    tags: finalTags,
    existingMatches: finalTags.filter((t) => existingSet.has(t)),
    newTags: finalTags.filter((t) => !existingSet.has(t)),
  };
}

export async function suggestBookmarkEnrichment(
  input: SuggestEnrichmentInput
): Promise<SuggestEnrichmentResult> {
  const wantTags = Boolean(input.fields.tags);
  const wantCollection = Boolean(input.fields.collection);
  const wantExcerpt = Boolean(input.fields.excerpt);

  const existingClean = Array.from(
    new Set(input.existingTags.map(normalizeTag).filter(Boolean))
  ).slice(0, 150);
  const existingSet = new Set(existingClean);

  const collectionEntries = buildCollectionPaths(input.collections).slice(0, 80);

  const pageSummaryParts: string[] = [];
  if (input.url) pageSummaryParts.push(`URL: ${input.url.slice(0, 400)}`);
  if (input.title) pageSummaryParts.push(`Title: ${input.title.slice(0, 240)}`);
  if (input.excerpt) pageSummaryParts.push(`Current description: ${input.excerpt.slice(0, 600)}`);
  if (input.readerContent) {
    pageSummaryParts.push(`Content excerpt:\n${input.readerContent.slice(0, 3200)}`);
  }

  const jsonShapeParts: string[] = [];
  const rules: string[] = [
    'You are an assistant for a personal bookmark manager.',
    'Analyze the webpage content and respond ONLY with a valid JSON object (no markdown, no extra commentary).',
  ];

  if (wantExcerpt) {
    jsonShapeParts.push('"excerpt": "1-2 concise sentences in Russian"');
    rules.push(
      'For "excerpt": write a clear, factual summary in 1-2 short sentences in Russian (max 240 chars) explaining what this page is about. Avoid marketing fluff.'
    );
  }

  if (wantCollection) {
    jsonShapeParts.push('"collection": "exact existing collection path or null"');
    rules.push(
      'For "collection": choose the single best-fitting collection strictly from the provided Existing collections list (return its exact path string). If none clearly fits, return null. Never invent new collection names.'
    );
  }

  if (wantTags) {
    jsonShapeParts.push('"tags": ["tag1", "tag2"]');
    rules.push(
      'For "tags": return strictly 2 to 3 concise lowercase tags (1-2 short words, hyphen for multi-word, no # symbol). STRICT PRIORITY: reuse matching tags from the Existing user tags list first, and only invent a new tag if no existing tag covers a key topic.'
    );
  }

  rules.push(`Exact JSON response format: {${jsonShapeParts.join(', ')}}`);

  const userLines: string[] = [];
  if (wantCollection) {
    userLines.push(
      collectionEntries.length > 0
        ? `Existing collections:\n${collectionEntries.map((c) => `- ${c.fullPath}`).join('\n')}`
        : 'Existing collections: (none)'
    );
    userLines.push('');
  }
  if (wantTags) {
    userLines.push(
      existingClean.length > 0
        ? `Existing user tags (prefer these first): ${existingClean.join(', ')}`
        : 'Existing user tags: (none yet)'
    );
    userLines.push('');
  }
  userLines.push('Bookmark to analyze:');
  userLines.push(pageSummaryParts.join('\n'));

  const maxTokens = wantExcerpt ? 320 : 140;
  const { content, model } = await callOpenAiCompatibleChat(
    [
      { role: 'system', content: rules.join('\n') },
      { role: 'user', content: userLines.join('\n') },
    ],
    maxTokens
  );

  const parsedObj = parseJsonObjectLoose(content);

  let tagResult = { tags: [] as string[], existingMatches: [] as string[], newTags: [] as string[] };
  if (wantTags) {
    const rawTags = parsedObj && Array.isArray(parsedObj.tags)
      ? parsedObj.tags.map((item) => String(item))
      : !wantExcerpt && !wantCollection
        ? parseTagsFromModelText(content)
        : [];
    tagResult = finalizeTags(rawTags, existingSet);
  }

  const matchedCol =
    wantCollection && parsedObj
      ? matchCollectionFromModelValue(parsedObj.collection, collectionEntries)
      : null;

  const cleanExcerpt =
    wantExcerpt && parsedObj ? sanitizeExcerpt(parsedObj.excerpt) : null;

  return {
    tags: tagResult.tags,
    existingMatches: tagResult.existingMatches,
    newTags: tagResult.newTags,
    excerpt: cleanExcerpt,
    collection_id: matchedCol?.id ?? null,
    collection_title: matchedCol?.title ?? null,
    model,
  };
}

export async function suggestTagsWithAi(input: SuggestTagsInput): Promise<SuggestTagsResult> {
  const res = await suggestBookmarkEnrichment({
    url: input.url,
    title: input.title,
    excerpt: input.excerpt,
    readerContent: input.readerContent,
    existingTags: input.existingTags,
    collections: [],
    fields: { tags: true },
  });
  return {
    tags: res.tags,
    existingMatches: res.existingMatches,
    newTags: res.newTags,
    model: res.model,
  };
}

export async function testAiConnection(): Promise<{ ok: boolean; model: string; latencyMs: number }> {
  const started = Date.now();
  const { model } = await callOpenAiCompatibleChat(
    [{ role: 'user', content: 'Reply with OK' }],
    8
  );
  return {
    ok: true,
    model,
    latencyMs: Date.now() - started,
  };
}

function shortlistBookmarksForSmartSearch(
  bookmarks: BookmarkRecord[],
  query: string,
  limit = 70
): BookmarkRecord[] {
  if (bookmarks.length <= limit) return bookmarks;

  const rawTokens = query
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`/\\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const stems = rawTokens.map((t) => (t.length >= 5 ? t.slice(0, -1) : t));

  const scored = bookmarks.map((bm, idx) => {
    const haystack = [
      bm.title,
      bm.domain,
      bm.excerpt,
      bm.note,
      bm.tags.join(' '),
      bm.reader_content.slice(0, 1200),
      bm.highlights.map((h) => `${h.text} ${h.note}`).join(' '),
    ]
      .join(' ')
      .toLowerCase();

    let score = 0;
    for (let i = 0; i < rawTokens.length; i++) {
      if (haystack.includes(rawTokens[i])) score += 4;
      else if (stems[i].length >= 3 && haystack.includes(stems[i])) score += 2;
    }
    if (bm.is_favorite) score += 0.5;
    // Slight recency bias as tie-breaker
    score += Math.max(0, 1 - idx / Math.max(bookmarks.length, 1));
    return { bm, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.bm);
}

export async function smartSearchBookmarksWithAi(input: {
  query: string;
  bookmarks: BookmarkRecord[];
}): Promise<SmartSearchAiResult> {
  const cleanQuery = input.query.trim().slice(0, 300);
  if (!cleanQuery) {
    return { matchedIds: [], reasons: {}, model: getAiStatus().model, scannedCount: 0 };
  }

  const candidates = shortlistBookmarksForSmartSearch(input.bookmarks, cleanQuery, 70);
  if (candidates.length === 0) {
    return { matchedIds: [], reasons: {}, model: getAiStatus().model, scannedCount: 0 };
  }

  const catalogLines = candidates.map((bm, i) => {
    const snippetSource = [bm.excerpt, bm.note, bm.reader_content.slice(0, 260)]
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' — ')
      .slice(0, 220);
    const tagStr = bm.tags.length > 0 ? ` #${bm.tags.slice(0, 6).join(' #')}` : '';
    const titleStr = bm.title.replace(/\s+/g, ' ').trim().slice(0, 110);
    return `[${i + 1}] ${titleStr} (${bm.domain})${tagStr}${snippetSource ? ` | ${snippetSource}` : ''}`;
  });

  const systemPrompt = [
    'You are a semantic search engine for a personal bookmark library.',
    'Find bookmarks from the numbered catalog that match the user query by meaning, topic, synonyms, Russian/English equivalents, or intent — not only exact words.',
    'Respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):',
    '{"matches": [{"idx": 1, "reason": "краткое пояснение 3-7 слов на русском"}]}',
    'Rules:',
    '- Order matches from most relevant to least relevant.',
    '- Include only genuinely relevant bookmarks (up to 15). If nothing fits, return {"matches": []}.',
    '- "idx" MUST be an integer index from the catalog.',
    '- Keep "reason" concise in Russian (max 70 chars).',
  ].join('\n');

  const userPrompt = `User search query: ${cleanQuery}\n\nBookmarks catalog (${candidates.length} items):\n${catalogLines.join('\n')}`;

  const { content, model } = await callOpenAiCompatibleChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    520,
    35_000
  );

  const parsed = parseJsonObjectLoose(content);
  const matchedIds: string[] = [];
  const reasons: Record<string, string> = {};
  const seen = new Set<string>();

  const rawMatches = parsed && Array.isArray(parsed.matches) ? parsed.matches : [];
  for (const item of rawMatches) {
    let idxNum: number | null = null;
    let reasonText = '';

    if (typeof item === 'number' && Number.isInteger(item)) {
      idxNum = item;
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const rawIdx = obj.idx ?? obj.index ?? obj.id;
      if (typeof rawIdx === 'number' && Number.isInteger(rawIdx)) {
        idxNum = rawIdx;
      } else if (typeof rawIdx === 'string' && /^\d+$/.test(rawIdx.trim())) {
        idxNum = Number.parseInt(rawIdx.trim(), 10);
      }
      if (typeof obj.reason === 'string') {
        reasonText = obj.reason.replace(/\s+/g, ' ').trim().slice(0, 120);
      }
    }

    if (idxNum === null || idxNum < 1 || idxNum > candidates.length) continue;
    const bm = candidates[idxNum - 1];
    if (!bm || seen.has(bm.id)) continue;
    seen.add(bm.id);
    matchedIds.push(bm.id);
    if (reasonText) {
      reasons[bm.id] = reasonText;
    }
    if (matchedIds.length >= 20) break;
  }

  return {
    matchedIds,
    reasons,
    model,
    scannedCount: candidates.length,
  };
}

export async function summarizeBookmarkWithAi(input: {
  url: string;
  title: string;
  excerpt: string;
  note: string;
  readerContent: string;
  highlights?: string[];
}): Promise<BookmarkSummaryAiResult> {
  const parts: string[] = [];
  if (input.title) parts.push(`Title: ${input.title.slice(0, 240)}`);
  if (input.url) parts.push(`URL: ${input.url.slice(0, 400)}`);
  if (input.excerpt) parts.push(`Description: ${input.excerpt.slice(0, 600)}`);
  if (input.note) parts.push(`User note: ${input.note.slice(0, 600)}`);
  if (input.highlights && input.highlights.length > 0) {
    parts.push(
      `User highlights:\n${input.highlights
        .slice(0, 8)
        .map((h) => `- ${h.slice(0, 240)}`)
        .join('\n')}`
    );
  }
  if (input.readerContent) {
    parts.push(`Article text:\n${input.readerContent.slice(0, 7500)}`);
  }

  const systemPrompt = [
    'You are an expert reading assistant for a personal bookmark manager.',
    'Create a concise, factual TL;DR summary in Russian based strictly on the provided webpage content.',
    'Respond ONLY with a valid JSON object (no markdown fences, no commentary):',
    '{"tldr": "1-2 коротких предложения с главной сутью материала", "bullets": ["Ключевой тезис 1", "Ключевой тезис 2", "Ключевой тезис 3"]}',
    'Rules:',
    '- Language: Russian.',
    '- "tldr": 1-2 clear sentences summarizing the main takeaway (max 340 chars).',
    '- "bullets": 3 to 5 concise, concrete key points (each max 200 chars, no leading dashes or bullets).',
    '- Avoid filler phrases like "В этой статье рассказывается о...". Get straight to the facts.',
  ].join('\n');

  const { content, model } = await callOpenAiCompatibleChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: parts.join('\n\n') },
    ],
    560,
    35_000
  );

  const parsed = parseJsonObjectLoose(content);
  let tldr = '';
  let bullets: string[] = [];

  if (parsed) {
    if (typeof parsed.tldr === 'string') {
      tldr = parsed.tldr.replace(/\s+/g, ' ').trim().slice(0, 420);
    } else if (typeof parsed.summary === 'string') {
      tldr = parsed.summary.replace(/\s+/g, ' ').trim().slice(0, 420);
    }
    const rawBullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
      : Array.isArray(parsed.points)
        ? parsed.points
        : [];
    bullets = rawBullets
      .map((item) =>
        String(item)
          .replace(/^[-•*\d.)\s]+/, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240)
      )
      .filter((s) => s.length >= 4)
      .slice(0, 5);
  } else {
    // Graceful fallback if model returned plain text / bullet lines
    const lines = content
      .replace(/^```(?:json|markdown)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const bulletLines = lines.filter((l) => /^[-•*\d.)]+\s+/.test(l));
    const plainLines = lines.filter((l) => !/^[-•*\d.)]+\s+/.test(l));
    tldr = (plainLines[0] || lines[0] || '').replace(/\s+/g, ' ').trim().slice(0, 420);
    bullets = bulletLines
      .map((l) => l.replace(/^[-•*\d.)]+\s+/, '').trim().slice(0, 240))
      .filter((s) => s.length >= 4)
      .slice(0, 5);
  }

  if (!tldr && bullets.length === 0) {
    throw new Error('ИИ не смог сформировать краткую выжимку для этой страницы');
  }

  return { tldr, bullets, model };
}
