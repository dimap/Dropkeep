import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { removeCoverScreenshotByUrl } from './screenshot.ts';
import { extractDomain, sanitizeBookmarkUrl, sanitizeMediaUrl } from './security.ts';
import {
  getActivePdfEngine,
  getTotalSnapshotsSizeBytes,
  removeSnapshotFile,
} from './snapshot.ts';
import type {
  BookmarkRecord,
  BookmarkType,
  CardColor,
  CollectionRecord,
  HighlightColor,
  HighlightRecord,
  TodoItem,
  TodoPriority,
} from './types.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'dropkeep.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// SQLite's built-in LOWER() only folds ASCII A-Z; register Unicode-aware ulower() so Cyrillic search & sorting work properly.
db.function('ulower', (val: unknown) =>
  typeof val === 'string' ? val.toLocaleLowerCase('ru-RU') : ''
);

db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    icon TEXT NOT NULL DEFAULT 'folder',
    color TEXT NOT NULL DEFAULT '#0B72E7',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    favicon TEXT NOT NULL DEFAULT '',
    domain TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'link',
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_trashed INTEGER NOT NULL DEFAULT 0,
    reader_content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookmark_tags (
    bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (bookmark_id, tag)
  );

  CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY,
    bookmark_id TEXT NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'yellow',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bookmarks_collection ON bookmarks(collection_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_trashed ON bookmarks(is_trashed);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
  CREATE INDEX IF NOT EXISTS idx_tags_tag ON bookmark_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_highlights_bookmark ON highlights(bookmark_id);
`);

// Safe online schema migration for offline PDF snapshots
const existingCols = new Set(
  (db.prepare('PRAGMA table_info(bookmarks)').all() as Array<{ name: string }>).map((c) => c.name)
);
if (!existingCols.has('snapshot_size')) {
  db.exec('ALTER TABLE bookmarks ADD COLUMN snapshot_size INTEGER NOT NULL DEFAULT 0');
}
if (!existingCols.has('snapshot_created_at')) {
  db.exec('ALTER TABLE bookmarks ADD COLUMN snapshot_created_at TEXT');
}
if (!existingCols.has('ai_summary')) {
  db.exec("ALTER TABLE bookmarks ADD COLUMN ai_summary TEXT NOT NULL DEFAULT ''");
}
if (!existingCols.has('card_color')) {
  db.exec("ALTER TABLE bookmarks ADD COLUMN card_color TEXT NOT NULL DEFAULT ''");
}
if (!existingCols.has('todo_items')) {
  db.exec("ALTER TABLE bookmarks ADD COLUMN todo_items TEXT NOT NULL DEFAULT '[]'");
}

const VALID_CARD_COLORS: CardColor[] = [
  '',
  'amber',
  'sage',
  'sky',
  'lavender',
  'rose',
  'sand',
  'slate',
];
const VALID_TODO_PRIORITIES: TodoPriority[] = ['low', 'medium', 'high', 'urgent'];
const VALID_BOOKMARK_TYPES: BookmarkType[] = [
  'link',
  'article',
  'image',
  'video',
  'document',
  'note',
  'todo',
];

function sanitizeCardColor(raw: unknown): CardColor {
  if (typeof raw === 'string' && VALID_CARD_COLORS.includes(raw as CardColor)) {
    return raw as CardColor;
  }
  return '';
}

function sanitizeTodoItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const result: TodoItem[] = [];
  for (const entry of raw.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, 500) : '';
    if (!text) continue;
    const id =
      typeof item.id === 'string' && item.id.trim().length > 0
        ? item.id.trim().slice(0, 64)
        : crypto.randomUUID();
    const rawProgress = Number(item.progress);
    const progress = Number.isFinite(rawProgress)
      ? Math.max(0, Math.min(100, Math.round(rawProgress)))
      : 0;
    const priority: TodoPriority =
      typeof item.priority === 'string' && VALID_TODO_PRIORITIES.includes(item.priority as TodoPriority)
        ? (item.priority as TodoPriority)
        : 'medium';
    result.push({ id, text, progress, priority });
  }
  return result;
}

function parseTodoItemsJson(raw: unknown): TodoItem[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    return sanitizeTodoItems(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function seedInitialDataIfEmpty(): void {
  const seededFlag = getSetting('initial_seed_v1');
  if (seededFlag) return;

  const colCount = (db.prepare('SELECT COUNT(*) as c FROM collections').get() as { c: number }).c;
  const bmCount = (db.prepare('SELECT COUNT(*) as c FROM bookmarks').get() as { c: number }).c;
  if (colCount > 0 || bmCount > 0) {
    setSetting('initial_seed_v1', '1');
    return;
  }

  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600 * 1000).toISOString();

  const insertCol = db.prepare(
    'INSERT INTO collections (id, title, parent_id, icon, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertBm = db.prepare(
    `INSERT INTO bookmarks
      (id, url, title, excerpt, note, cover, favicon, domain, type, collection_id, is_favorite, is_trashed, reader_content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  );
  const insertTag = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag) VALUES (?, ?)');
  const insertHl = db.prepare(
    'INSERT INTO highlights (id, bookmark_id, text, note, color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const seedTx = db.transaction(() => {
    // Collections & nested subcollections
    insertCol.run('col-selfhost', 'Self-Hosting & Docker', null, 'server', '#0B72E7', 1, iso(120));
    insertCol.run('col-homelab', 'Homelab и сети', 'col-selfhost', 'cpu', '#2563EB', 2, iso(118));
    insertCol.run('col-compose', 'Docker Compose', 'col-selfhost', 'layers', '#0284C7', 3, iso(116));
    insertCol.run('col-design', 'Дизайн и интерфейсы', null, 'palette', '#D97706', 4, iso(110));
    insertCol.run('col-typography', 'Типографика', 'col-design', 'type', '#B45309', 5, iso(108));
    insertCol.run('col-dev', 'Разработка', null, 'code', '#16A34A', 6, iso(100));
    insertCol.run('col-read', 'Почитать позже', null, 'book-open', '#7C3AED', 7, iso(95));
    insertCol.run('col-inspo', 'Визуальное вдохновение', null, 'compass', '#DB2777', 8, iso(90));

    const starterBookmarks: Array<{
      id: string;
      url: string;
      title: string;
      excerpt: string;
      note: string;
      cover: string;
      type: BookmarkType;
      collection_id: string | null;
      is_favorite: number;
      hoursAgo: number;
      tags: string[];
      reader: string;
      highlights?: Array<{ text: string; note: string; color: HighlightColor }>;
    }> = [
      {
        id: 'bm-1',
        url: 'https://docs.docker.com/compose/compose-file/',
        title: 'Docker Compose Specification — Полный справочник конфигурации',
        excerpt:
          'Официальная спецификация compose.yaml: именованные тома, сети, healthcheck, профили запуска и ограничения ресурсов для домашнего сервера.',
        note: 'Использовать restart: unless-stopped и отдельные named volumes для всех SQLite-сервисов.',
        cover: '/covers/docker-compose.svg',
        type: 'document',
        collection_id: 'col-compose',
        is_favorite: 1,
        hoursAgo: 2,
        tags: ['docker', 'compose', 'selfhost'],
        reader:
          'Compose Specification определяет платформонезависимый стандарт описания многоконтейнерных приложений.\n\nИменованные тома (volumes) позволяют безопасно хранить базы данных SQLite и пользовательские файлы отдельно от жизненного цикла образа контейнера.\n\nНастройка healthcheck гарантирует, что оркестратор и reverse-proxy направляют трафик только на готовые сервисы.',
        highlights: [
          {
            text: 'Именованные тома позволяют безопасно хранить базы данных SQLite отдельно от жизненного цикла контейнера.',
            note: 'Обязательно для бэкапов /data',
            color: 'blue',
          },
        ],
      },
      {
        id: 'bm-2',
        url: 'https://www.sqlite.org/wal.html',
        title: 'SQLite Write-Ahead Logging (WAL) — Архитектура и производительность',
        excerpt:
          'Как режим WAL позволяет одновременное чтение и запись в один файл базы данных без блокировок — идеально для self-hosted веб-приложений.',
        note: 'WAL + synchronous=NORMAL даёт отличную скорость даже на Raspberry Pi с SSD.',
        cover: '/covers/video-talk.svg',
        type: 'video',
        collection_id: 'col-dev',
        is_favorite: 1,
        hoursAgo: 5,
        tags: ['sqlite', 'database', 'backend'],
        reader:
          'В традиционном журнале отката писатели блокируют читателей. В режиме Write-Ahead Logging (WAL) изменения записываются в отдельный WAL-файл, благодаря чему чтение никогда не блокирует запись, а запись не блокирует чтение.\n\nДля большинства self-hosted приложений на одном сервере SQLite в режиме WAL устраняет необходимость поддерживать отдельный контейнер PostgreSQL.',
        highlights: [
          {
            text: 'В режиме WAL чтение никогда не блокирует запись, а запись не блокирует чтение.',
            note: 'Ключевая причина выбрать SQLite для одиночного контейнера',
            color: 'yellow',
          },
        ],
      },
      {
        id: 'bm-3',
        url: 'https://rauno.me/craft/interaction-design',
        title: 'Невидимые детали дизайна взаимодействий и типографических сеток',
        excerpt:
          'Разбор того, почему спокойные интерфейсы с чёткой иерархией, быстрым откликом и предсказуемыми переходами ощущаются нативными.',
        note: 'Отличный референс по пропорциям боковой панели и плотности списков.',
        cover: '/covers/design-grid.svg',
        type: 'article',
        collection_id: 'col-design',
        is_favorite: 1,
        hoursAgo: 9,
        tags: ['ui', 'ux', 'design-system'],
        reader:
          'Хороший инструмент для ежедневной работы не требует внимания к себе. Пользователь должен видеть собственные данные — ссылки, заметки, коллекции — а не декоративный шум интерфейса.\n\nЧёткие однопиксельные разделители, табличные цифры в счётчиках и мгновенные переходы до 150 мс создают ощущение физического инструмента.',
        highlights: [
          {
            text: 'Хороший инструмент для ежедневной работы не требует внимания к себе — пользователь должен видеть собственные данные.',
            note: 'Принцип минимального интерфейса',
            color: 'green',
          },
        ],
      },
      {
        id: 'bm-4',
        url: 'https://practicaltypography.com/grid-systems.html',
        title: 'Швейцарские модульные сетки и ритм в веб-типографике',
        excerpt:
          'Классические принципы Йозефа Мюллера-Брокмана в современных приложениях: баланс полей, длина строки и оптическая компенсация в тёмной теме.',
        note: '',
        cover: '/covers/typography-editorial.svg',
        type: 'article',
        collection_id: 'col-typography',
        is_favorite: 0,
        hoursAgo: 15,
        tags: ['typography', 'editorial', 'swiss'],
        reader:
          'Оптимальная ширина текстовой колонки для комфортного чтения составляет от 60 до 75 знаков. В тёмных интерфейсах светлый шрифт на тёмном фоне требует чуть более спокойного контраста и аккуратного межбуквенного интервала.',
      },
      {
        id: 'bm-5',
        url: 'https://tailscale.com/kb/1017/install',
        title: 'Домашняя лаборатория: безопасный доступ к Docker-сервисам через Tailscale и Caddy',
        excerpt:
          'Пошаговое руководство по развёртыванию домашнего сервера без проброса портов на роутере с автоматическим HTTPS.',
        note: 'Поставить Caddy перед Dropkeep для автоматических сертификатов Let’s Encrypt.',
        cover: '/covers/homelab-rack.svg',
        type: 'article',
        collection_id: 'col-homelab',
        is_favorite: 1,
        hoursAgo: 22,
        tags: ['homelab', 'networking', 'selfhost', 'caddy'],
        reader:
          'Объединение WireGuard-сети Tailscale и обратного прокси Caddy позволяет открывать домашние сервисы по собственному домену с валидным TLS-сертификатом, не открывая публичные порты на домашнем маршрутизаторе.',
      },
      {
        id: 'bm-6',
        url: 'https://minimalissimo.com/articles/alpine-pavilion',
        title: 'Бетонный павильон в Альпах — Архитектурная подборка',
        excerpt:
          'Минималистичная работа с естественным светом, необработанным бетоном и панорамным остеклением в высокогорном ландшафте.',
        note: 'Сохранить для мудборда в режиме плитки (Masonry).',
        cover: '/covers/alpine-architecture.svg',
        type: 'image',
        collection_id: 'col-inspo',
        is_favorite: 0,
        hoursAgo: 30,
        tags: ['architecture', 'minimalism', 'moodboard'],
        reader: '',
      },
      {
        id: 'bm-7',
        url: 'https://caddyserver.com/docs/caddyfile/directives/reverse_proxy',
        title: 'Caddy Reverse Proxy — Настройка проксирования локальных контейнеров',
        excerpt:
          'Лаконичный Caddyfile в три строки для публикации self-hosted веб-приложений с поддержкой HTTP/3 и автоматического продления сертификатов.',
        note: 'bookmarks.home.arpa { reverse_proxy dropkeep:3000 }',
        cover: '',
        type: 'link',
        collection_id: 'col-homelab',
        is_favorite: 0,
        hoursAgo: 44,
        tags: ['caddy', 'reverse-proxy', 'docker'],
        reader: '',
      },
      {
        id: 'bm-8',
        url: 'https://restic.readthedocs.io/en/stable/',
        title: 'Restic — Быстрое шифрованное резервное копирование томов Docker',
        excerpt:
          'Инкрементальные дедуплицированные бэкапы файлов SQLite и конфигов в S3, Backblaze B2 или на удалённый NAS по расписанию.',
        note: 'Настроить ежедневный cron-снимок /data/dropkeep.db.',
        cover: '',
        type: 'document',
        collection_id: 'col-selfhost',
        is_favorite: 0,
        hoursAgo: 56,
        tags: ['backup', 'selfhost', 'linux'],
        reader: '',
      },
      {
        id: 'bm-9',
        url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
        title: 'MDN: CSS Grid & Subgrid — Практические паттерны раскладок',
        excerpt:
          'Современные адаптивные сетки без лишних медиа-запросов, выравнивание карточек с разной длиной описания и плотные табличные представления.',
        note: '',
        cover: '/covers/design-grid.svg',
        type: 'article',
        collection_id: 'col-read',
        is_favorite: 0,
        hoursAgo: 68,
        tags: ['css', 'frontend'],
        reader: '',
      },
      {
        id: 'bm-10',
        url: 'https://github.com/awesome-selfhosted/awesome-selfhosted',
        title: 'Awesome Selfhosted — Каталог свободного ПО для своего сервера',
        excerpt:
          'Крупнейший поддерживаемый сообществом список автономных веб-приложений, которые можно развернуть на собственном железе.',
        note: 'Разобрать и перенести в нужную коллекцию',
        cover: '/covers/homelab-rack.svg',
        type: 'link',
        collection_id: null, // Unsorted!
        is_favorite: 0,
        hoursAgo: 80,
        tags: [],
        reader: '',
      },
    ];

    for (const bm of starterBookmarks) {
      const ts = iso(bm.hoursAgo);
      const domain = extractDomain(bm.url);
      insertBm.run(
        bm.id,
        bm.url,
        bm.title,
        bm.excerpt,
        bm.note,
        bm.cover,
        '',
        domain,
        bm.type,
        bm.collection_id,
        bm.is_favorite,
        bm.reader,
        ts,
        ts
      );
      for (const tag of bm.tags) {
        insertTag.run(bm.id, tag);
      }
      if (bm.highlights) {
        for (const hl of bm.highlights) {
          insertHl.run(crypto.randomUUID(), bm.id, hl.text, hl.note, hl.color, ts);
        }
      }
    }

    setSetting('initial_seed_v1', '1');
  });

  seedTx();
}

seedInitialDataIfEmpty();

// --- Helper hydration ---

function hydrateBookmarks(rows: Array<Record<string, unknown>>): BookmarkRecord[] {
  if (!rows.length) return [];

  const ids = rows.map((r) => String(r.id));
  const tagsByBm = new Map<string, string[]>();
  const hlsByBm = new Map<string, HighlightRecord[]>();

  // Chunk IN clauses (max 500 IDs per query) to stay well below SQLite variable limits on large libraries
  const CHUNK_SIZE = 500;
  for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
    const slice = ids.slice(offset, offset + CHUNK_SIZE);
    const placeholders = slice.map(() => '?').join(',');

    const tagRows = db
      .prepare(`SELECT bookmark_id, tag FROM bookmark_tags WHERE bookmark_id IN (${placeholders}) ORDER BY tag ASC`)
      .all(...slice) as Array<{ bookmark_id: string; tag: string }>;

    for (const t of tagRows) {
      const arr = tagsByBm.get(t.bookmark_id) || [];
      arr.push(t.tag);
      tagsByBm.set(t.bookmark_id, arr);
    }

    const hlRows = db
      .prepare(
        `SELECT id, bookmark_id, text, note, color, created_at FROM highlights WHERE bookmark_id IN (${placeholders}) ORDER BY created_at DESC`
      )
      .all(...slice) as HighlightRecord[];

    for (const h of hlRows) {
      const arr = hlsByBm.get(h.bookmark_id) || [];
      arr.push(h);
      hlsByBm.set(h.bookmark_id, arr);
    }
  }

  return rows.map((r) => ({
    id: String(r.id),
    url: String(r.url || ''),
    title: String(r.title),
    excerpt: String(r.excerpt || ''),
    note: String(r.note || ''),
    cover: String(r.cover || ''),
    favicon: String(r.favicon || ''),
    domain: String(r.domain || ''),
    type: (r.type as BookmarkType) || 'link',
    card_color: sanitizeCardColor(r.card_color),
    todo_items: parseTodoItemsJson(r.todo_items),
    collection_id: r.collection_id ? String(r.collection_id) : null,
    is_favorite: Boolean(r.is_favorite),
    is_trashed: Boolean(r.is_trashed),
    reader_content: String(r.reader_content || ''),
    ai_summary: String(r.ai_summary || ''),
    snapshot_size: Number(r.snapshot_size || 0),
    snapshot_created_at: r.snapshot_created_at ? String(r.snapshot_created_at) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    tags: tagsByBm.get(String(r.id)) || [],
    highlights: hlsByBm.get(String(r.id)) || [],
  }));
}

// --- Collections ---

export function listCollections(): CollectionRecord[] {
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM bookmarks b WHERE b.collection_id = c.id AND b.is_trashed = 0) AS count
       FROM collections c
       ORDER BY c.sort_order ASC, c.title COLLATE NOCASE ASC`
    )
    .all() as CollectionRecord[];
  return rows;
}

export function createCollection(input: {
  title: string;
  parent_id?: string | null;
  icon?: string;
  color?: string;
}): CollectionRecord {
  const id = crypto.randomUUID();
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new Error('Название коллекции не может быть пустым');

  const parentId = input.parent_id ? String(input.parent_id) : null;
  if (parentId) {
    const exists = db.prepare('SELECT id FROM collections WHERE id = ?').get(parentId);
    if (!exists) throw new Error('Родительская коллекция не найдена');
  }

  const maxOrder = (
    db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM collections').get() as { m: number }
  ).m;

  const icon = (input.icon || 'folder').slice(0, 40);
  const color = /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? input.color! : '#0B72E7';
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO collections (id, title, parent_id, icon, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title, parentId, icon, color, maxOrder + 1, now);

  return { id, title, parent_id: parentId, icon, color, sort_order: maxOrder + 1, created_at: now, count: 0 };
}

function isDescendant(targetParentId: string, collectionId: string): boolean {
  let curr: string | null = targetParentId;
  let depth = 0;
  while (curr && depth < 32) {
    if (curr === collectionId) return true;
    const row = db.prepare('SELECT parent_id FROM collections WHERE id = ?').get(curr) as
      | { parent_id: string | null }
      | undefined;
    curr = row?.parent_id ?? null;
    depth++;
  }
  return false;
}

export function updateCollection(
  id: string,
  input: { title?: string; parent_id?: string | null; icon?: string; color?: string }
): CollectionRecord | null {
  const existing = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as CollectionRecord | undefined;
  if (!existing) return null;

  const title = input.title !== undefined ? input.title.trim().slice(0, 120) : existing.title;
  if (!title) throw new Error('Название коллекции не может быть пустым');

  let parentId = existing.parent_id;
  if (input.parent_id !== undefined) {
    parentId = input.parent_id ? String(input.parent_id) : null;
    if (parentId && (parentId === id || isDescendant(parentId, id))) {
      throw new Error('Нельзя вложить коллекцию саму в себя');
    }
  }

  const icon = input.icon !== undefined ? input.icon.slice(0, 40) : existing.icon;
  const color =
    input.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : existing.color;

  db.prepare('UPDATE collections SET title = ?, parent_id = ?, icon = ?, color = ? WHERE id = ?').run(
    title,
    parentId,
    icon,
    color,
    id
  );

  const count = (
    db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE collection_id = ? AND is_trashed = 0').get(id) as {
      c: number;
    }
  ).c;

  return { ...existing, title, parent_id: parentId, icon, color, count };
}

export function deleteCollection(id: string): boolean {
  const tx = db.transaction(() => {
    const col = db.prepare('SELECT parent_id FROM collections WHERE id = ?').get(id) as
      | { parent_id: string | null }
      | undefined;
    if (!col) return false;
    // Reparent child collections to deleted collection's parent
    db.prepare('UPDATE collections SET parent_id = ? WHERE parent_id = ?').run(col.parent_id, id);
    // Move bookmarks to Unsorted (collection_id = NULL) rather than destroying them
    db.prepare('UPDATE bookmarks SET collection_id = NULL WHERE collection_id = ?').run(id);
    db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    return true;
  });
  return tx();
}

export function ensureCollectionPath(pathSegments: string[]): string | null {
  let parentId: string | null = null;
  for (const rawName of pathSegments) {
    const name = rawName.trim().slice(0, 120);
    if (!name || name.toLowerCase() === 'unsorted' || name.toLowerCase() === 'несортированные') {
      continue;
    }
    const existing = (
      parentId === null
        ? db
            .prepare('SELECT id FROM collections WHERE parent_id IS NULL AND LOWER(title) = LOWER(?)')
            .get(name)
        : db
            .prepare('SELECT id FROM collections WHERE parent_id = ? AND LOWER(title) = LOWER(?)')
            .get(parentId, name)
    ) as { id: string } | undefined;

    if (existing) {
      parentId = existing.id;
    } else {
      const created = createCollection({ title: name, parent_id: parentId });
      parentId = created.id;
    }
  }
  return parentId;
}

// --- Bookmarks Query & Counts ---

const SORT_MAP: Record<string, string> = {
  newest: 'b.created_at DESC',
  oldest: 'b.created_at ASC',
  title_asc: 'ulower(b.title) ASC',
  title_desc: 'ulower(b.title) DESC',
  domain: 'ulower(b.domain) ASC, b.created_at DESC',
};

function getDescendantCollectionIds(rootId: string): string[] {
  const all = db.prepare('SELECT id, parent_id FROM collections').all() as Array<{
    id: string;
    parent_id: string | null;
  }>;
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of all) {
      if (c.parent_id && result.has(c.parent_id) && !result.has(c.id)) {
        result.add(c.id);
        changed = true;
      }
    }
  }
  return Array.from(result);
}

export function listBookmarks(params: {
  scope?: string;
  collectionId?: string;
  filterType?: string;
  tag?: string;
  search?: string;
  sort?: string;
  includeNested?: boolean;
  includeContent?: boolean;
}): BookmarkRecord[] {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.scope === 'trash') {
    conditions.push('b.is_trashed = 1');
  } else {
    conditions.push('b.is_trashed = 0');
    if (params.scope === 'unsorted') {
      conditions.push('b.collection_id IS NULL');
    } else if (params.scope === 'favorites') {
      conditions.push('b.is_favorite = 1');
    } else if (params.scope === 'collection' && params.collectionId) {
      if (params.includeNested) {
        const ids = getDescendantCollectionIds(params.collectionId);
        conditions.push(`b.collection_id IN (${ids.map(() => '?').join(',')})`);
        bindings.push(...ids);
      } else {
        conditions.push('b.collection_id = ?');
        bindings.push(params.collectionId);
      }
    }
  }

  if (params.filterType) {
    if (VALID_BOOKMARK_TYPES.includes(params.filterType as BookmarkType)) {
      conditions.push('b.type = ?');
      bindings.push(params.filterType);
    } else if (params.filterType === 'highlights') {
      conditions.push(
        "(EXISTS (SELECT 1 FROM highlights h WHERE h.bookmark_id = b.id) OR (b.type != 'note' AND LENGTH(TRIM(b.note)) > 0))"
      );
    } else if (params.filterType === 'untagged') {
      conditions.push('NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)');
    } else if (params.filterType === 'duplicates') {
      conditions.push(
        "b.url != '' AND b.url IN (SELECT url FROM bookmarks WHERE is_trashed = 0 AND url != '' GROUP BY url HAVING COUNT(*) > 1)"
      );
    } else if (params.filterType === 'offline') {
      conditions.push('b.snapshot_size > 0');
    }
  }

  if (params.tag) {
    conditions.push(
      'EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id AND ulower(bt.tag) = ?)'
    );
    bindings.push(params.tag.toLocaleLowerCase('ru-RU'));
  }

  // Raindrop-style search operators: #tag, domain:example.com, type:video, type:note, type:todo, is:favorite
  if (params.search && params.search.trim()) {
    const tokens = params.search.trim().split(/\s+/);
    const freeTerms: string[] = [];

    for (const token of tokens) {
      const lowerToken = token.toLocaleLowerCase('ru-RU');
      if (token.startsWith('#') && token.length > 1) {
        conditions.push(
          'EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id AND ulower(bt.tag) = ?)'
        );
        bindings.push(lowerToken.slice(1));
      } else if (lowerToken.startsWith('domain:') && token.length > 7) {
        conditions.push('ulower(b.domain) LIKE ?');
        bindings.push(`%${lowerToken.slice(7)}%`);
      } else if (lowerToken.startsWith('type:') && token.length > 5) {
        const t = lowerToken.slice(5);
        if (VALID_BOOKMARK_TYPES.includes(t as BookmarkType)) {
          conditions.push('b.type = ?');
          bindings.push(t);
        }
      } else if (lowerToken === 'is:favorite' || lowerToken === 'is:fav') {
        conditions.push('b.is_favorite = 1');
      } else if (lowerToken === 'is:untagged') {
        conditions.push('NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)');
      } else if (lowerToken === 'is:offline' || lowerToken === 'is:pdf') {
        conditions.push('b.snapshot_size > 0');
      } else {
        freeTerms.push(token);
      }
    }

    for (const term of freeTerms) {
      const pattern = `%${term.toLocaleLowerCase('ru-RU')}%`;
      conditions.push(
        `(ulower(b.title) LIKE ? OR ulower(b.excerpt) LIKE ? OR ulower(b.note) LIKE ? OR ulower(b.url) LIKE ? OR ulower(b.domain) LIKE ? OR ulower(b.reader_content) LIKE ? OR ulower(b.todo_items) LIKE ? OR EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id AND ulower(bt.tag) LIKE ?) OR EXISTS (SELECT 1 FROM highlights h WHERE h.bookmark_id = b.id AND (ulower(h.text) LIKE ? OR ulower(h.note) LIKE ?)))`
      );
      bindings.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
  }

  const orderBy = SORT_MAP[params.sort || 'newest'] || SORT_MAP.newest;
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const selectColumns =
    params.includeContent === false
      ? `b.id, b.url, b.title, b.excerpt, b.note, b.cover, b.favicon, b.domain, b.type, b.card_color, b.todo_items, b.collection_id, b.is_favorite, b.is_trashed, '' AS reader_content, '' AS ai_summary, b.snapshot_size, b.snapshot_created_at, b.created_at, b.updated_at`
      : 'b.*';

  const rows = db
    .prepare(`SELECT ${selectColumns} FROM bookmarks b ${whereClause} ORDER BY ${orderBy}`)
    .all(...bindings) as Array<Record<string, unknown>>;

  return hydrateBookmarks(rows);
}

export function getBookmarkById(id: string): BookmarkRecord | null {
  const row = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return hydrateBookmarks([row])[0];
}

export function createBookmark(input: {
  url?: string;
  title?: string;
  excerpt?: string;
  note?: string;
  cover?: string;
  favicon?: string;
  type?: BookmarkType;
  card_color?: CardColor;
  todo_items?: TodoItem[];
  collection_id?: string | null;
  is_favorite?: boolean;
  reader_content?: string;
  tags?: string[];
  created_at?: string;
}): BookmarkRecord {
  const type: BookmarkType =
    input.type && VALID_BOOKMARK_TYPES.includes(input.type) ? input.type : 'link';
  const isStandalone = type === 'note' || type === 'todo';

  let safeUrl = '';
  let domain = '';
  if (!isStandalone) {
    const sanitized = sanitizeBookmarkUrl(input.url || '');
    if (!sanitized) {
      throw new Error('Укажите корректный URL (http:// или https://)');
    }
    safeUrl = sanitized;
    domain = extractDomain(safeUrl);
  } else if (input.url && input.url.trim()) {
    const sanitized = sanitizeBookmarkUrl(input.url);
    if (sanitized) {
      safeUrl = sanitized;
      domain = extractDomain(sanitized);
    }
  }

  const id = crypto.randomUUID();
  const defaultTitle =
    type === 'note' ? 'Новая заметка' : type === 'todo' ? 'Список задач' : domain || safeUrl;
  const title = (input.title?.trim() || defaultTitle).slice(0, 240);
  const excerpt = (input.excerpt || '').trim().slice(0, 2000);
  const note = (input.note || '').trim().slice(0, 20000);
  const cover = type === 'todo' ? '' : sanitizeMediaUrl(input.cover);
  const favicon = isStandalone ? '' : sanitizeMediaUrl(input.favicon);
  const cardColor = sanitizeCardColor(input.card_color);
  const todoItems = type === 'todo' ? sanitizeTodoItems(input.todo_items) : [];
  const collectionId = input.collection_id ? String(input.collection_id) : null;
  const isFavorite = input.is_favorite ? 1 : 0;
  const readerContent = (input.reader_content || '').slice(0, 15000);
  const now = input.created_at && !Number.isNaN(Date.parse(input.created_at))
    ? new Date(input.created_at).toISOString()
    : new Date().toISOString();

  const normalizedTags = Array.from(
    new Set(
      (input.tags || [])
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter((t) => t.length > 0 && t.length <= 48)
    )
  );

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO bookmarks
        (id, url, title, excerpt, note, cover, favicon, domain, type, card_color, todo_items, collection_id, is_favorite, is_trashed, reader_content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      id,
      safeUrl,
      title,
      excerpt,
      note,
      cover,
      favicon,
      domain,
      type,
      cardColor,
      JSON.stringify(todoItems),
      collectionId,
      isFavorite,
      readerContent,
      now,
      now
    );

    const insertTag = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag) VALUES (?, ?)');
    for (const tag of normalizedTags) {
      insertTag.run(id, tag);
    }
  });

  tx();
  return getBookmarkById(id)!;
}

export function updateBookmark(
  id: string,
  input: Partial<{
    url: string;
    title: string;
    excerpt: string;
    note: string;
    cover: string;
    favicon: string;
    type: BookmarkType;
    card_color: CardColor;
    todo_items: TodoItem[];
    collection_id: string | null;
    is_favorite: boolean;
    is_trashed: boolean;
    reader_content: string;
    tags: string[];
  }>
): BookmarkRecord | null {
  const existing = getBookmarkById(id);
  if (!existing) return null;

  const type: BookmarkType =
    input.type !== undefined && VALID_BOOKMARK_TYPES.includes(input.type) ? input.type : existing.type;
  const isStandalone = type === 'note' || type === 'todo';

  let url = existing.url;
  let domain = existing.domain;
  if (input.url !== undefined) {
    if (isStandalone && !input.url.trim()) {
      url = '';
      domain = '';
    } else {
      const safeUrl = sanitizeBookmarkUrl(input.url);
      if (!safeUrl) throw new Error('Некорректный URL');
      url = safeUrl;
      domain = extractDomain(safeUrl);
    }
  }

  const fallbackTitle =
    type === 'note' ? 'Заметка' : type === 'todo' ? 'Список задач' : domain || existing.title;
  const title =
    input.title !== undefined ? (input.title.trim() || fallbackTitle).slice(0, 240) : existing.title;
  const excerpt = input.excerpt !== undefined ? input.excerpt.trim().slice(0, 2000) : existing.excerpt;
  const note = input.note !== undefined ? input.note.trim().slice(0, 20000) : existing.note;
  const cover =
    type === 'todo'
      ? ''
      : input.cover !== undefined
        ? sanitizeMediaUrl(input.cover)
        : existing.cover;
  const favicon = input.favicon !== undefined ? sanitizeMediaUrl(input.favicon) : existing.favicon;
  const cardColor =
    input.card_color !== undefined ? sanitizeCardColor(input.card_color) : existing.card_color;
  const todoItems =
    input.todo_items !== undefined ? sanitizeTodoItems(input.todo_items) : existing.todo_items;
  const collectionId = input.collection_id !== undefined ? input.collection_id : existing.collection_id;
  const isFavorite = input.is_favorite !== undefined ? (input.is_favorite ? 1 : 0) : existing.is_favorite ? 1 : 0;
  const isTrashed = input.is_trashed !== undefined ? (input.is_trashed ? 1 : 0) : existing.is_trashed ? 1 : 0;
  const readerContent =
    input.reader_content !== undefined ? input.reader_content.slice(0, 15000) : existing.reader_content;
  const updatedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE bookmarks
       SET url = ?, title = ?, excerpt = ?, note = ?, cover = ?, favicon = ?, domain = ?,
           type = ?, card_color = ?, todo_items = ?, collection_id = ?, is_favorite = ?, is_trashed = ?, reader_content = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      url,
      title,
      excerpt,
      note,
      cover,
      favicon,
      domain,
      type,
      cardColor,
      JSON.stringify(todoItems),
      collectionId,
      isFavorite,
      isTrashed,
      readerContent,
      updatedAt,
      id
    );

    if (input.tags !== undefined) {
      db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag) VALUES (?, ?)');
      const uniqueTags = Array.from(
        new Set(
          input.tags
            .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
            .filter((t) => t.length > 0 && t.length <= 48)
        )
      );
      for (const tag of uniqueTags) {
        insertTag.run(id, tag);
      }
    }
  });

  tx();
  if (
    existing.cover &&
    existing.cover.startsWith('/api/covers/') &&
    cover !== existing.cover
  ) {
    removeCoverScreenshotByUrl(existing.cover);
  }
  return getBookmarkById(id);
}

export function updateBookmarkSnapshot(
  id: string,
  input: { sizeBytes: number; createdAt: string; readerContent?: string }
): BookmarkRecord | null {
  const existing = getBookmarkById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const nextReader =
    input.readerContent && input.readerContent.trim().length > existing.reader_content.length
      ? input.readerContent.slice(0, 15000)
      : existing.reader_content;

  db.prepare(
    'UPDATE bookmarks SET snapshot_size = ?, snapshot_created_at = ?, reader_content = ?, updated_at = ? WHERE id = ?'
  ).run(input.sizeBytes, input.createdAt, nextReader, now, id);
  return getBookmarkById(id);
}

export function clearBookmarkSnapshot(id: string): BookmarkRecord | null {
  const existing = getBookmarkById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE bookmarks SET snapshot_size = 0, snapshot_created_at = NULL, updated_at = ? WHERE id = ?'
  ).run(now, id);
  return getBookmarkById(id);
}

export function updateBookmarkAiSummary(
  id: string,
  aiSummary: string,
  readerContent?: string
): BookmarkRecord | null {
  const existing = getBookmarkById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const nextReader =
    readerContent && readerContent.trim().length > existing.reader_content.length
      ? readerContent.slice(0, 15000)
      : existing.reader_content;
  const safeSummary = aiSummary.slice(0, 8000);

  db.prepare(
    'UPDATE bookmarks SET ai_summary = ?, reader_content = ?, updated_at = ? WHERE id = ?'
  ).run(safeSummary, nextReader, now, id);
  return getBookmarkById(id);
}

export function deleteBookmarkPermanent(id: string): boolean {
  const existing = db.prepare('SELECT cover FROM bookmarks WHERE id = ?').get(id) as
    | { cover: string }
    | undefined;
  const result = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  if (result.changes > 0) {
    removeSnapshotFile(id);
    removeCoverScreenshotByUrl(existing?.cover);
    return true;
  }
  return false;
}

export function emptyTrash(): number {
  const trashedRows = db
    .prepare('SELECT id, cover FROM bookmarks WHERE is_trashed = 1')
    .all() as Array<{ id: string; cover: string }>;
  const result = db.prepare('DELETE FROM bookmarks WHERE is_trashed = 1').run();
  for (const row of trashedRows) {
    removeSnapshotFile(row.id);
    removeCoverScreenshotByUrl(row.cover);
  }
  return result.changes;
}

export function deleteAllBookmarks(options?: {
  deleteCollections?: boolean;
}): { removedBookmarks: number; removedCollections: number } {
  const allRows = db
    .prepare('SELECT id, cover FROM bookmarks')
    .all() as Array<{ id: string; cover: string }>;

  const deleteCollections = Boolean(options?.deleteCollections);

  const tx = db.transaction(() => {
    const removedBookmarks = db.prepare('DELETE FROM bookmarks').run().changes;
    let removedCollections = 0;
    if (deleteCollections) {
      removedCollections = db.prepare('DELETE FROM collections').run().changes;
    }
    // Keep initial seed marker set so starter demo bookmarks are never re-created on restart
    setSetting('initial_seed_v1', '1');
    return { removedBookmarks, removedCollections };
  });

  const result = tx();
  for (const row of allRows) {
    removeSnapshotFile(row.id);
    removeCoverScreenshotByUrl(row.cover);
  }
  return result;
}

export function bulkUpdateBookmarks(input: {
  ids: string[];
  action: 'move' | 'add_tag' | 'favorite' | 'unfavorite' | 'trash' | 'restore' | 'delete';
  collection_id?: string | null;
  tag?: string;
}): number {
  const validIds = input.ids.filter((id) => typeof id === 'string' && id.length > 0);
  if (!validIds.length) return 0;

  const placeholders = validIds.map(() => '?').join(',');
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    switch (input.action) {
      case 'move':
        return db
          .prepare(`UPDATE bookmarks SET collection_id = ?, is_trashed = 0, updated_at = ? WHERE id IN (${placeholders})`)
          .run(input.collection_id ?? null, now, ...validIds).changes;
      case 'favorite':
        return db
          .prepare(`UPDATE bookmarks SET is_favorite = 1, updated_at = ? WHERE id IN (${placeholders})`)
          .run(now, ...validIds).changes;
      case 'unfavorite':
        return db
          .prepare(`UPDATE bookmarks SET is_favorite = 0, updated_at = ? WHERE id IN (${placeholders})`)
          .run(now, ...validIds).changes;
      case 'trash':
        return db
          .prepare(`UPDATE bookmarks SET is_trashed = 1, updated_at = ? WHERE id IN (${placeholders})`)
          .run(now, ...validIds).changes;
      case 'restore':
        return db
          .prepare(`UPDATE bookmarks SET is_trashed = 0, updated_at = ? WHERE id IN (${placeholders})`)
          .run(now, ...validIds).changes;
      case 'delete': {
        const rows = db
          .prepare(`SELECT id, cover FROM bookmarks WHERE id IN (${placeholders})`)
          .all(...validIds) as Array<{ id: string; cover: string }>;
        const changes = db.prepare(`DELETE FROM bookmarks WHERE id IN (${placeholders})`).run(...validIds).changes;
        for (const row of rows) {
          removeSnapshotFile(row.id);
          removeCoverScreenshotByUrl(row.cover);
        }
        return changes;
      }
      case 'add_tag': {
        const cleanTag = (input.tag || '').trim().toLowerCase().replace(/^#/, '');
        if (!cleanTag) return 0;
        const stmt = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag) VALUES (?, ?)');
        let count = 0;
        for (const id of validIds) {
          count += stmt.run(id, cleanTag).changes;
        }
        return count;
      }
      default:
        return 0;
    }
  });

  return tx();
}

// --- Highlights ---

export function addHighlight(
  bookmarkId: string,
  input: { text: string; note?: string; color?: HighlightColor }
): HighlightRecord {
  const exists = db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(bookmarkId);
  if (!exists) throw new Error('Закладка не найдена');

  const text = input.text.trim().slice(0, 2000);
  if (!text) throw new Error('Текст выделения не может быть пустым');

  const note = (input.note || '').trim().slice(0, 1000);
  const validColors: HighlightColor[] = ['yellow', 'blue', 'pink', 'green'];
  const color: HighlightColor = input.color && validColors.includes(input.color) ? input.color : 'yellow';
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  db.prepare(
    'INSERT INTO highlights (id, bookmark_id, text, note, color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, bookmarkId, text, note, color, created_at);

  return { id, bookmark_id: bookmarkId, text, note, color, created_at };
}

export function deleteHighlight(highlightId: string): boolean {
  return db.prepare('DELETE FROM highlights WHERE id = ?').run(highlightId).changes > 0;
}

// --- Tags & Smart Stats ---

export function listTags(): Array<{ tag: string; count: number }> {
  return db
    .prepare(
      `SELECT bt.tag, COUNT(*) as count
       FROM bookmark_tags bt
       INNER JOIN bookmarks b ON b.id = bt.bookmark_id
       WHERE b.is_trashed = 0
       GROUP BY bt.tag
       ORDER BY count DESC, bt.tag COLLATE NOCASE ASC`
    )
    .all() as Array<{ tag: string; count: number }>;
}

export function renameTag(oldTag: string, newTag: string): number {
  const cleanOld = oldTag.trim().toLowerCase().replace(/^#/, '');
  const cleanNew = newTag.trim().toLowerCase().replace(/^#/, '');
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return 0;

  const tx = db.transaction(() => {
    const affected = db
      .prepare('SELECT bookmark_id FROM bookmark_tags WHERE tag = ?')
      .all(cleanOld) as Array<{ bookmark_id: string }>;
    const ins = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag) VALUES (?, ?)');
    for (const row of affected) {
      ins.run(row.bookmark_id, cleanNew);
    }
    return db.prepare('DELETE FROM bookmark_tags WHERE tag = ?').run(cleanOld).changes;
  });

  return tx();
}

export function deleteTag(tag: string): number {
  const clean = tag.trim().toLowerCase().replace(/^#/, '');
  return db.prepare('DELETE FROM bookmark_tags WHERE tag = ?').run(clean).changes;
}

export function getSmartStats(): {
  all: number;
  unsorted: number;
  favorites: number;
  trash: number;
  articles: number;
  videos: number;
  images: number;
  links: number;
  documents: number;
  notes: number;
  todos: number;
  highlights: number;
  untagged: number;
  duplicates: number;
  offline: number;
  dbSizeBytes: number;
  snapshotsSizeBytes: number;
  pdfEngine: 'chromium' | 'builtin';
  dbPath: string;
} {
  const q = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = fs.statSync(DB_PATH).size;
  } catch {
    dbSizeBytes = 0;
  }

  return {
    all: q('SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0'),
    unsorted: q('SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND collection_id IS NULL'),
    favorites: q('SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND is_favorite = 1'),
    trash: q('SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 1'),
    articles: q("SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND type = 'article'"),
    videos: q("SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND type = 'video'"),
    images: q("SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND type = 'image'"),
    links: q("SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND type = 'link'"),
    documents: q("SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND type = 'document'"),
    notes: q("SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND type = 'note'"),
    todos: q("SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND type = 'todo'"),
    highlights: q(
      "SELECT COUNT(*) as c FROM bookmarks b WHERE b.is_trashed = 0 AND (EXISTS (SELECT 1 FROM highlights h WHERE h.bookmark_id = b.id) OR (b.type != 'note' AND LENGTH(TRIM(b.note)) > 0))"
    ),
    untagged: q(
      'SELECT COUNT(*) as c FROM bookmarks b WHERE b.is_trashed = 0 AND NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = b.id)'
    ),
    duplicates: q(
      "SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND url != '' AND url IN (SELECT url FROM bookmarks WHERE is_trashed = 0 AND url != '' GROUP BY url HAVING COUNT(*) > 1)"
    ),
    offline: q('SELECT COUNT(*) as c FROM bookmarks WHERE is_trashed = 0 AND snapshot_size > 0'),
    dbSizeBytes,
    snapshotsSizeBytes: getTotalSnapshotsSizeBytes(),
    pdfEngine: getActivePdfEngine(),
    dbPath: DB_PATH,
  };
}
