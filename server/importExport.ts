import * as cheerio from 'cheerio';
import { extractDomain, sanitizeBookmarkUrl, sanitizeMediaUrl } from './security.ts';
import type { BookmarkRecord, BookmarkType, CollectionRecord } from './types.ts';

export interface ParsedImportItem {
  url: string;
  title: string;
  excerpt: string;
  note: string;
  cover: string;
  type: BookmarkType;
  tags: string[];
  folderPath: string[];
  created_at?: string;
}

/**
 * Parses Netscape Bookmark HTML exports from Raindrop.io, Chrome, Firefox, and Safari.
 * Preserves nested folder hierarchy and comma-separated TAGS attributes.
 */
export function parseNetscapeHtml(html: string): ParsedImportItem[] {
  const $ = cheerio.load(html);
  const items: ParsedImportItem[] = [];

  function walkDl(dlElement: ReturnType<typeof $>, currentPath: string[]): void {
    const children = dlElement.children();
    children.each((_, node) => {
      const tag = node.type === 'tag' ? node.name.toLowerCase() : '';
      if (tag === 'dt') {
        const dt = $(node);
        const h3 = dt.children('h3').first();
        if (h3.length) {
          const folderName = h3.text().trim();
          const nestedDl = dt.children('dl').first().length
            ? dt.children('dl').first()
            : dt.next('dl').first();
          const nextPath = folderName ? [...currentPath, folderName] : currentPath;
          if (nestedDl.length) {
            walkDl(nestedDl, nextPath);
          }
          return;
        }

        const anchor = dt.children('a').first();
        if (anchor.length) {
          const href = anchor.attr('href') || '';
          const safeUrl = sanitizeBookmarkUrl(href);
          if (!safeUrl) return;

          const title = anchor.text().trim() || extractDomain(safeUrl);
          const tagsAttr = anchor.attr('tags') || '';
          const tags = tagsAttr
            .split(',')
            .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
            .filter(Boolean);

          const addDate = anchor.attr('add_date');
          let createdAt: string | undefined;
          if (addDate && /^\d+$/.test(addDate)) {
            const secs = Number(addDate);
            const ms = secs > 1e12 ? secs : secs * 1000;
            const d = new Date(ms);
            if (!Number.isNaN(d.getTime())) {
              createdAt = d.toISOString();
            }
          }

          // Optional <DD> description immediately following <DT>
          let excerpt = '';
          const nextEl = dt.next();
          if (nextEl.length && nextEl[0].type === 'tag' && nextEl[0].name.toLowerCase() === 'dd') {
            excerpt = nextEl.text().trim().slice(0, 480);
          }

          items.push({
            url: safeUrl,
            title: title.slice(0, 240),
            excerpt,
            note: '',
            cover: sanitizeMediaUrl(anchor.attr('icon')),
            type: 'link',
            tags,
            folderPath: currentPath,
            created_at: createdAt,
          });
        }
      } else if (tag === 'dl') {
        walkDl($(node), currentPath);
      }
    });
  }

  const rootDls = $('dl');
  if (rootDls.length) {
    walkDl(rootDls.first(), []);
  } else {
    // Fallback for flat anchor lists
    $('a[href]').each((_, el) => {
      const anchor = $(el);
      const safeUrl = sanitizeBookmarkUrl(anchor.attr('href') || '');
      if (!safeUrl) return;
      items.push({
        url: safeUrl,
        title: (anchor.text().trim() || extractDomain(safeUrl)).slice(0, 240),
        excerpt: '',
        note: '',
        cover: '',
        type: 'link',
        tags: [],
        folderPath: [],
      });
    });
  }

  return items;
}

/**
 * Parses CSV exports (including Raindrop.io official CSV format:
 * id,title,note,excerpt,url,tags,created,cover,highlights,folder)
 */
export function parseBookmarksCsv(csvText: string): ParsedImportItem[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"' && csvText[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csvText[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row);
    }
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const colIdx = (names: string[]) => headers.findIndex((h) => names.includes(h));

  const urlIdx = colIdx(['url', 'link', 'href']);
  if (urlIdx === -1) return [];

  const titleIdx = colIdx(['title', 'name']);
  const excerptIdx = colIdx(['excerpt', 'description']);
  const noteIdx = colIdx(['note', 'notes']);
  const tagsIdx = colIdx(['tags', 'tag']);
  const folderIdx = colIdx(['folder', 'collection', 'collections']);
  const coverIdx = colIdx(['cover', 'image']);
  const createdIdx = colIdx(['created', 'created_at', 'date']);

  const items: ParsedImportItem[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const safeUrl = sanitizeBookmarkUrl(cells[urlIdx] || '');
    if (!safeUrl) continue;

    const folderRaw = folderIdx >= 0 ? (cells[folderIdx] || '').trim() : '';
    const folderPath = folderRaw
      ? folderRaw
          .split('/')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const tagsRaw = tagsIdx >= 0 ? cells[tagsIdx] || '' : '';
    const tags = tagsRaw
      .split(/[,;]+/)
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);

    items.push({
      url: safeUrl,
      title: ((titleIdx >= 0 ? cells[titleIdx] : '') || extractDomain(safeUrl)).trim().slice(0, 240),
      excerpt: (excerptIdx >= 0 ? cells[excerptIdx] || '' : '').trim().slice(0, 480),
      note: (noteIdx >= 0 ? cells[noteIdx] || '' : '').trim().slice(0, 2000),
      cover: sanitizeMediaUrl(coverIdx >= 0 ? cells[coverIdx] : ''),
      type: 'link',
      tags,
      folderPath,
      created_at: createdIdx >= 0 && cells[createdIdx] ? cells[createdIdx].trim() : undefined,
    });
  }

  return items;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportNetscapeHtml(
  collections: CollectionRecord[],
  bookmarks: BookmarkRecord[]
): string {
  const byParent = new Map<string | null, CollectionRecord[]>();
  for (const col of collections) {
    const list = byParent.get(col.parent_id) || [];
    list.push(col);
    byParent.set(col.parent_id, list);
  }

  const byCollection = new Map<string | null, BookmarkRecord[]>();
  for (const bm of bookmarks) {
    if (bm.is_trashed) continue;
    const list = byCollection.get(bm.collection_id) || [];
    list.push(bm);
    byCollection.set(bm.collection_id, list);
  }

  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- Exported from Dropkeep -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Dropkeep Bookmarks</TITLE>',
    '<H1>Dropkeep Bookmarks</H1>',
    '<DL><p>',
  ];

  function renderBookmarks(list: BookmarkRecord[], indent: string): void {
    for (const bm of list) {
      const ts = Math.floor(new Date(bm.created_at).getTime() / 1000) || Math.floor(Date.now() / 1000);
      const tagsAttr = bm.tags.length ? ` TAGS="${escapeHtml(bm.tags.join(','))}"` : '';
      lines.push(
        `${indent}<DT><A HREF="${escapeHtml(bm.url)}" ADD_DATE="${ts}"${tagsAttr}>${escapeHtml(bm.title)}</A>`
      );
      if (bm.excerpt) {
        lines.push(`${indent}<DD>${escapeHtml(bm.excerpt)}`);
      }
    }
  }

  function renderCollection(col: CollectionRecord, depth: number): void {
    const indent = '  '.repeat(depth);
    lines.push(`${indent}<DT><H3>${escapeHtml(col.title)}</H3>`);
    lines.push(`${indent}<DL><p>`);
    renderBookmarks(byCollection.get(col.id) || [], indent + '  ');
    const children = byParent.get(col.id) || [];
    for (const child of children) {
      renderCollection(child, depth + 1);
    }
    lines.push(`${indent}</DL><p>`);
  }

  // Unsorted first
  const unsorted = byCollection.get(null) || [];
  if (unsorted.length) {
    lines.push('  <DT><H3>Несортированные</H3>');
    lines.push('  <DL><p>');
    renderBookmarks(unsorted, '    ');
    lines.push('  </DL><p>');
  }

  for (const rootCol of byParent.get(null) || []) {
    renderCollection(rootCol, 1);
  }

  lines.push('</DL><p>');
  return lines.join('\n');
}

function escapeCsvCell(value: string): string {
  const safe = /^[\t\r ]*[=+\-@]|^[\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function exportBookmarksCsv(
  collections: CollectionRecord[],
  bookmarks: BookmarkRecord[]
): string {
  const colMap = new Map(collections.map((c) => [c.id, c]));
  function folderPath(colId: string | null): string {
    if (!colId) return 'Unsorted';
    const parts: string[] = [];
    let current = colMap.get(colId);
    let guard = 0;
    while (current && guard < 10) {
      parts.unshift(current.title);
      current = current.parent_id ? colMap.get(current.parent_id) : undefined;
      guard++;
    }
    return parts.join('/');
  }

  const header = ['id', 'title', 'note', 'excerpt', 'url', 'tags', 'created', 'cover', 'folder'];
  const lines = [header.join(',')];

  for (const bm of bookmarks) {
    if (bm.is_trashed) continue;
    lines.push(
      [
        bm.id,
        bm.title,
        bm.note,
        bm.excerpt,
        bm.url,
        bm.tags.join(', '),
        bm.created_at,
        bm.cover,
        folderPath(bm.collection_id),
      ]
        .map((cell) => escapeCsvCell(String(cell ?? '')))
        .join(',')
    );
  }

  return lines.join('\n');
}
