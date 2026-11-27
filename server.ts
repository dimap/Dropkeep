import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import {
  getAiStatus,
  smartSearchBookmarksWithAi,
  suggestBookmarkEnrichment,
  suggestTagsWithAi,
  summarizeBookmarkWithAi,
  summarizeYouTubeExcerptWithAi,
  testAiConnection,
} from './server/ai.ts';
import {
  checkLoginRateLimit,
  clearDbPassword,
  clearLoginFailures,
  clearSessionCookie,
  createSessionToken,
  extractAuthFromRequest,
  getAuthConfig,
  getClientIp,
  recordFailedLogin,
  requireAuthMiddleware,
  setDbPassword,
  setSessionCookie,
  verifyMasterPassword,
  verifySessionToken,
} from './server/auth.ts';
import {
  addHighlight,
  bulkUpdateBookmarks,
  clearBookmarkSnapshot,
  createBookmark,
  createCollection,
  deleteAllBookmarks,
  deleteBookmarkPermanent,
  deleteCollection,
  deleteHighlight,
  deleteTag,
  emptyTrash,
  ensureCollectionPath,
  getBookmarkById,
  getSmartStats,
  listBookmarks,
  listCollections,
  listTags,
  renameTag,
  updateBookmark,
  updateBookmarkAiSummary,
  updateBookmarkLinkCheck,
  updateBookmarkSnapshot,
  updateCollection,
} from './server/db.ts';
import {
  exportBookmarksCsv,
  exportNetscapeHtml,
  parseBookmarksCsv,
  parseNetscapeHtml,
} from './server/importExport.ts';
import { checkBookmarkAvailability } from './server/linkChecker.ts';
import { scrapeUrlMetadata } from './server/scraper.ts';
import { isYouTubeUrl, scrapeYouTubeMetadata } from './server/youtube.ts';
import {
  captureCoverScreenshot,
  getCoverScreenshotPath,
  isBrowserConfigured,
  removeCoverScreenshotByUrl,
  saveUploadedCoverImage,
} from './server/screenshot.ts';
import {
  checkGotenbergHealth,
  generateBookmarkPdfSnapshot,
  getSnapshotFilePath,
  removeSnapshotFile,
} from './server/snapshot.ts';
import type { BookmarkType, CardColor, HighlightColor, TodoItem } from './server/types.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '8mb' }));

  // --- Healthcheck (used by Docker HEALTHCHECK) ---
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'dropkeep', timestamp: new Date().toISOString() });
  });

  // --- Auth Routes ---
  app.get('/api/auth/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const config = getAuthConfig();
    if (!config.enabled) {
      res.json({ authEnabled: false, authenticated: true, source: 'none' });
      return;
    }
    const { token } = extractAuthFromRequest(req);
    const authenticated = verifySessionToken(token);
    res.json({ authEnabled: true, authenticated, source: config.source });
  });

  app.post('/api/auth/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const config = getAuthConfig();
    if (!config.enabled) {
      res.json({ token: '', authEnabled: false });
      return;
    }
    const clientIp = getClientIp(req);
    const limit = checkLoginRateLimit(clientIp);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({
        error: 'Слишком много неудачных попыток входа. Повторите попытку позже.',
      });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyMasterPassword(password)) {
      recordFailedLogin(clientIp);
      res.status(401).json({ error: 'Неверный пароль' });
      return;
    }

    clearLoginFailures(clientIp);
    const token = createSessionToken();
    setSessionCookie(req, res, token);
    res.json({ token, authEnabled: true });
  });

  // Protect all remaining /api/* routes when password protection is enabled
  app.use('/api', requireAuthMiddleware);

  // --- Lightweight Local Cover Screenshots & Uploaded Note Images (authenticated, UUID filenames, path-confined) ---
  app.get('/api/covers/:filename', (req, res) => {
    const resolved = getCoverScreenshotPath(req.params.filename);
    if (!resolved) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', resolved.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    fs.createReadStream(resolved.filePath).pipe(res);
  });

  app.post('/api/uploads/image', (req, res) => {
    try {
      const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
      const url = saveUploadedCoverImage(dataUrl);
      res.status(201).json({ url });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось загрузить изображение',
      });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/password', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const config = getAuthConfig();
    if (config.source === 'env') {
      res.status(400).json({
        error: 'Пароль задан через переменную окружения APP_PASSWORD. Измените её в docker-compose.yml или .env.',
      });
      return;
    }

    const action = req.body?.action;
    if (action === 'disable') {
      clearDbPassword();
      clearSessionCookie(req, res);
      res.json({ authEnabled: false, source: 'none' });
      return;
    }

    const newPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
      return;
    }

    setDbPassword(newPassword);
    const token = createSessionToken();
    setSessionCookie(req, res, token);
    res.json({ authEnabled: true, source: 'db', token });
  });

  // --- Bootstrap / Sidebar Data ---
  app.get('/api/workspace', async (_req, res) => {
    const baseStats = getSmartStats();
    const pdfEngineStatus = await checkGotenbergHealth();
    res.json({
      collections: listCollections(),
      tags: listTags(),
      stats: {
        ...baseStats,
        pdfEngine: pdfEngineStatus === 'chromium' ? 'chromium' : 'builtin',
        pdfEngineStatus,
      },
      aiConfigured: getAiStatus().configured,
    });
  });

  // --- Collections ---
  app.get('/api/collections', (_req, res) => {
    res.json(listCollections());
  });

  app.post('/api/collections', (req, res) => {
    try {
      const col = createCollection({
        title: String(req.body?.title || ''),
        parent_id: req.body?.parent_id ?? null,
        icon: typeof req.body?.icon === 'string' ? req.body.icon : 'folder',
        color: typeof req.body?.color === 'string' ? req.body.color : '#0B72E7',
      });
      res.status(201).json(col);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Ошибка создания коллекции' });
    }
  });

  app.patch('/api/collections/:id', (req, res) => {
    try {
      const updated = updateCollection(req.params.id, {
        title: req.body?.title,
        parent_id: req.body?.parent_id,
        icon: req.body?.icon,
        color: req.body?.color,
      });
      if (!updated) {
        res.status(404).json({ error: 'Коллекция не найдена' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Ошибка обновления коллекции' });
    }
  });

  app.delete('/api/collections/:id', (req, res) => {
    const ok = deleteCollection(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Коллекция не найдена' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- Bookmarks ---
  app.get('/api/bookmarks', (req, res) => {
    const items = listBookmarks({
      scope: typeof req.query.scope === 'string' ? req.query.scope : 'all',
      collectionId: typeof req.query.collectionId === 'string' ? req.query.collectionId : undefined,
      filterType: typeof req.query.filterType === 'string' ? req.query.filterType : undefined,
      tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      sort: typeof req.query.sort === 'string' ? req.query.sort : 'newest',
      includeNested: req.query.includeNested !== 'false',
      includeContent: false,
    });
    res.json(items);
  });

  app.get('/api/bookmarks/:id', (req, res) => {
    const bm = getBookmarkById(req.params.id);
    if (!bm) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    res.json(bm);
  });

  app.post('/api/bookmarks', async (req, res) => {
    try {
      let created = createBookmark({
        url: typeof req.body?.url === 'string' ? req.body.url : '',
        title: typeof req.body?.title === 'string' ? req.body.title : undefined,
        excerpt: typeof req.body?.excerpt === 'string' ? req.body.excerpt : undefined,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
        cover: typeof req.body?.cover === 'string' ? req.body.cover : undefined,
        favicon: typeof req.body?.favicon === 'string' ? req.body.favicon : undefined,
        type: req.body?.type as BookmarkType | undefined,
        card_color: typeof req.body?.card_color === 'string' ? (req.body.card_color as never) : undefined,
        todo_items: Array.isArray(req.body?.todo_items) ? req.body.todo_items : undefined,
        collection_id: req.body?.collection_id ?? null,
        is_favorite: Boolean(req.body?.is_favorite),
        reader_content: typeof req.body?.reader_content === 'string' ? req.body.reader_content : undefined,
        tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [],
      });

      const shouldAutoAiYoutube =
        req.body?.auto_ai_youtube !== false &&
        req.body?.user_edited_excerpt !== true &&
        Boolean(created.url) &&
        isYouTubeUrl(created.url) &&
        getAiStatus().configured;

      if (shouldAutoAiYoutube) {
        try {
          let nextTitle = created.title;
          let nextCover = created.cover;
          let nextFavicon = created.favicon;
          let nextReader = created.reader_content;
          let nextExcerpt = created.excerpt;

          if (
            nextReader.trim().length < 250 ||
            !nextReader.includes('Расшифровка видео')
          ) {
            const ytMeta = await scrapeYouTubeMetadata(created.url);
            if (ytMeta) {
              if (!nextTitle || nextTitle === created.domain || nextTitle === created.url) {
                nextTitle = ytMeta.title;
              }
              if (!nextCover) nextCover = ytMeta.cover;
              if (!nextFavicon) nextFavicon = ytMeta.favicon;
              if (ytMeta.reader_content.trim().length > nextReader.trim().length) {
                nextReader = ytMeta.reader_content;
              }
              if (!nextExcerpt) nextExcerpt = ytMeta.excerpt;
            }
          }

          if (nextReader.trim().length >= 40 || nextTitle.trim() || nextExcerpt.trim()) {
            const aiRes = await summarizeYouTubeExcerptWithAi({
              url: created.url,
              title: nextTitle,
              excerpt: nextExcerpt,
              readerContent: nextReader,
            });
            const updated = updateBookmark(created.id, {
              title: nextTitle,
              excerpt: aiRes.excerpt,
              cover: nextCover,
              favicon: nextFavicon,
              type: 'video',
              reader_content: nextReader,
            });
            if (updated) created = updated;
          }
        } catch {
          // Never fail bookmark creation if YouTube transcript or AI summary fails
        }
      }

      if (req.body?.save_offline_pdf && created.url) {
        try {
          const snap = await generateBookmarkPdfSnapshot(created);
          const withSnap = updateBookmarkSnapshot(created.id, snap);
          if (withSnap) created = withSnap;
        } catch {
          // Bookmark itself is created even if PDF snapshot fails
        }
      }

      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Ошибка добавления закладки' });
    }
  });

  app.patch('/api/bookmarks/:id', (req, res) => {
    try {
      const updated = updateBookmark(req.params.id, {
        url: req.body?.url,
        title: req.body?.title,
        excerpt: req.body?.excerpt,
        note: req.body?.note,
        cover: req.body?.cover,
        favicon: req.body?.favicon,
        type: req.body?.type,
        card_color: req.body?.card_color,
        todo_items: Array.isArray(req.body?.todo_items) ? req.body.todo_items : undefined,
        collection_id: req.body?.collection_id,
        is_favorite: req.body?.is_favorite,
        is_trashed: req.body?.is_trashed,
        reader_content: req.body?.reader_content,
        tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : undefined,
      });
      if (!updated) {
        res.status(404).json({ error: 'Закладка не найдена' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Ошибка сохранения закладки' });
    }
  });

  app.post('/api/bookmarks/:id/refresh', async (req, res) => {
    const existing = getBookmarkById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    if (!existing.url) {
      res.status(400).json({ error: 'Для локальных заметок и списков задач обновление по URL недоступно' });
      return;
    }
    try {
      const meta = await scrapeUrlMetadata(existing.url);
      let nextCover = meta.cover;

      // If page has no og:image cover and Chromium/Gotenberg is configured, capture a lightweight 800x500 WebP screenshot
      if (!nextCover && isBrowserConfigured()) {
        const screenshotCover = await captureCoverScreenshot(meta.url || existing.url);
        if (screenshotCover) {
          nextCover = screenshotCover;
        }
      }

      const previousCover = existing.cover;
      const updated = updateBookmark(existing.id, {
        title: meta.title || existing.title,
        excerpt: meta.excerpt || existing.excerpt,
        cover: nextCover || existing.cover,
        favicon: meta.favicon || existing.favicon,
        type: meta.type || existing.type,
        reader_content: meta.reader_content || existing.reader_content,
      });

      if (nextCover && previousCover && previousCover !== nextCover) {
        removeCoverScreenshotByUrl(previousCover);
      }

      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось обновить метаданные' });
    }
  });

  app.post('/api/bookmarks/:id/cover', async (req, res) => {
    const existing = getBookmarkById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    if (!existing.url) {
      res.status(400).json({ error: 'Обновление превью доступно только для веб-закладок' });
      return;
    }
    try {
      let nextCover = '';
      let targetUrl = existing.url;
      let scrapedFavicon = '';

      try {
        const meta = await scrapeUrlMetadata(existing.url);
        targetUrl = meta.url || existing.url;
        nextCover = meta.cover || '';
        scrapedFavicon = meta.favicon || '';
      } catch {
        // Page might block simple HTML scraping; fall back to browser screenshot if available
      }

      if (!nextCover && isBrowserConfigured()) {
        const screenshotCover = await captureCoverScreenshot(targetUrl);
        if (screenshotCover) {
          nextCover = screenshotCover;
        }
      }

      if (!nextCover) {
        res.status(400).json({ error: 'Не удалось получить превью со страницы' });
        return;
      }

      const previousCover = existing.cover;
      const updated = updateBookmark(existing.id, {
        cover: nextCover,
        favicon: existing.favicon || scrapedFavicon,
      });

      if (previousCover && previousCover !== nextCover) {
        removeCoverScreenshotByUrl(previousCover);
      }

      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось обновить превью' });
    }
  });

  app.post('/api/bookmarks/:id/check', async (req, res) => {
    const existing = getBookmarkById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    if (!existing.url) {
      res.status(400).json({ error: 'Проверка доступности доступна только для веб-закладок' });
      return;
    }
    try {
      const check = await checkBookmarkAvailability(existing.url);
      const updated = updateBookmarkLinkCheck(existing.id, check);
      res.json({ bookmark: updated || existing, check });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось проверить доступность ссылки',
      });
    }
  });

  // --- Offline PDF Snapshots ---
  app.post('/api/bookmarks/:id/snapshot', async (req, res) => {
    const existing = getBookmarkById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    if (!existing.url) {
      res.status(400).json({ error: 'PDF-снимок доступен только для веб-закладок' });
      return;
    }
    try {
      const snap = await generateBookmarkPdfSnapshot(existing);
      const updated = updateBookmarkSnapshot(existing.id, snap);
      res.json(updated);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Не удалось создать PDF-снимок',
      });
    }
  });

  app.get('/api/bookmarks/:id/snapshot', (req, res) => {
    const existing = getBookmarkById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    const filePath = getSnapshotFilePath(existing.id);
    if (!filePath) {
      res.status(404).json({ error: 'Офлайн PDF-снимок не найден' });
      return;
    }

    const safeBaseName =
      (existing.title || existing.domain || 'bookmark')
        .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
        .trim()
        .slice(0, 80) || 'bookmark';
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="dropkeep-offline.pdf"; filename*=UTF-8''${encodeURIComponent(safeBaseName + '.pdf')}`
    );
    fs.createReadStream(filePath).pipe(res);
  });

  app.delete('/api/bookmarks/:id/snapshot', (req, res) => {
    const existing = getBookmarkById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    removeSnapshotFile(existing.id);
    const updated = clearBookmarkSnapshot(existing.id);
    res.json(updated);
  });

  app.delete('/api/bookmarks/:id', (req, res) => {
    const permanent = req.query.permanent === 'true';
    if (permanent) {
      const ok = deleteBookmarkPermanent(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'Закладка не найдена' });
        return;
      }
      res.json({ deleted: true });
      return;
    }
    const trashed = updateBookmark(req.params.id, { is_trashed: true });
    if (!trashed) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    res.json(trashed);
  });

  app.post('/api/bookmarks/bulk', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const action = req.body?.action;
    if (!['move', 'add_tag', 'favorite', 'unfavorite', 'trash', 'restore', 'delete'].includes(action)) {
      res.status(400).json({ error: 'Недопустимое массовое действие' });
      return;
    }
    const affected = bulkUpdateBookmarks({
      ids,
      action,
      collection_id: req.body?.collection_id ?? null,
      tag: typeof req.body?.tag === 'string' ? req.body.tag : undefined,
    });
    res.json({ affected });
  });

  app.post('/api/trash/empty', (_req, res) => {
    const removed = emptyTrash();
    res.json({ removed });
  });

  app.post('/api/bookmarks/delete-all', (req, res) => {
    const deleteCollections = Boolean(req.body?.deleteCollections);
    const result = deleteAllBookmarks({ deleteCollections });
    res.json(result);
  });

  // --- Highlights ---
  app.post('/api/bookmarks/:id/highlights', (req, res) => {
    try {
      const hl = addHighlight(req.params.id, {
        text: String(req.body?.text || ''),
        note: typeof req.body?.note === 'string' ? req.body.note : '',
        color: req.body?.color as HighlightColor | undefined,
      });
      res.status(201).json(hl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Ошибка добавления выделения' });
    }
  });

  app.delete('/api/highlights/:id', (req, res) => {
    const ok = deleteHighlight(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Выделение не найдено' });
      return;
    }
    res.json({ deleted: true });
  });

  // --- Tags ---
  app.get('/api/tags', (_req, res) => {
    res.json(listTags());
  });

  app.patch('/api/tags/:tag', (req, res) => {
    const newTag = typeof req.body?.newTag === 'string' ? req.body.newTag : '';
    const updated = renameTag(req.params.tag, newTag);
    res.json({ updated });
  });

  app.delete('/api/tags/:tag', (req, res) => {
    const removed = deleteTag(req.params.tag);
    res.json({ removed });
  });

  // --- Safe URL Metadata Scraper ---
  app.post('/api/metadata/fetch', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!rawUrl.trim()) {
      res.status(400).json({ error: 'Укажите URL' });
      return;
    }
    try {
      const metadata = await scrapeUrlMetadata(rawUrl);
      if (!metadata.cover && isBrowserConfigured()) {
        const screenshotCover = await captureCoverScreenshot(metadata.url);
        if (screenshotCover) {
          metadata.cover = screenshotCover;
        }
      }
      res.json(metadata);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить страницу' });
    }
  });

  app.post('/api/metadata/cover', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Укажите URL' });
      return;
    }
    try {
      let nextCover = '';
      let targetUrl = rawUrl;

      try {
        const metadata = await scrapeUrlMetadata(rawUrl);
        targetUrl = metadata.url || rawUrl;
        nextCover = metadata.cover || '';
      } catch {
        // Fall back to screenshot if browser engine is configured
      }

      if (!nextCover && isBrowserConfigured()) {
        const screenshotCover = await captureCoverScreenshot(targetUrl);
        if (screenshotCover) {
          nextCover = screenshotCover;
        }
      }

      if (!nextCover) {
        res.status(400).json({ error: 'Не удалось получить превью со страницы' });
        return;
      }

      res.json({ cover: nextCover });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить превью' });
    }
  });

  // --- AI Enrichment & Tagging (On-Demand Only, Custom OpenAI-Compatible API via Server Env) ---
  app.get('/api/ai/status', (_req, res) => {
    res.json(getAiStatus());
  });

  app.post('/api/ai/test', async (_req, res) => {
    try {
      const result = await testAiConnection();
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось подключиться к ИИ-модели',
      });
    }
  });

  app.post('/api/ai/suggest', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    let title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    let excerpt = typeof req.body?.excerpt === 'string' ? req.body.excerpt.trim() : '';
    let readerContent = typeof req.body?.reader_content === 'string' ? req.body.reader_content.trim() : '';

    const rawFields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : null;
    const fields = {
      tags: rawFields ? Boolean(rawFields.tags) : true,
      collection: rawFields ? Boolean(rawFields.collection) : true,
      excerpt: rawFields ? Boolean(rawFields.excerpt) : true,
    };

    if (!fields.tags && !fields.collection && !fields.excerpt) {
      res.status(400).json({ error: 'Выберите хотя бы одно поле для подбора ИИ' });
      return;
    }

    if (!rawUrl && !title && !excerpt && !readerContent) {
      res.status(400).json({ error: 'Укажите URL или описание страницы' });
      return;
    }

    try {
      let metadata = null;
      const needsYoutubeTranscript =
        rawUrl &&
        isYouTubeUrl(rawUrl) &&
        (!readerContent || !readerContent.includes('Расшифровка видео'));
      if (rawUrl && (!title || !readerContent || needsYoutubeTranscript)) {
        try {
          metadata = await scrapeUrlMetadata(rawUrl);
          if (!metadata.cover && isBrowserConfigured()) {
            const screenshotCover = await captureCoverScreenshot(metadata.url);
            if (screenshotCover) metadata.cover = screenshotCover;
          }
          if (!title) title = metadata.title;
          if (!excerpt) excerpt = metadata.excerpt;
          if (!readerContent || metadata.reader_content.length > readerContent.length) {
            readerContent = metadata.reader_content;
          }
        } catch {
          // Proceed with available fields if target blocks scraping
        }
      }

      const existingTags = fields.tags ? listTags().map((t) => t.tag) : [];
      const collections = fields.collection
        ? listCollections().map((c) => ({ id: c.id, title: c.title, parent_id: c.parent_id }))
        : [];

      const suggestion = await suggestBookmarkEnrichment({
        url: metadata?.url || rawUrl,
        title,
        excerpt,
        readerContent,
        existingTags,
        collections,
        fields,
      });

      res.json({
        ...suggestion,
        metadata,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось получить подсказки от ИИ',
      });
    }
  });

  app.post('/api/ai/suggest-tags', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    let title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    let excerpt = typeof req.body?.excerpt === 'string' ? req.body.excerpt.trim() : '';
    let readerContent = typeof req.body?.reader_content === 'string' ? req.body.reader_content.trim() : '';

    if (!rawUrl && !title && !excerpt && !readerContent) {
      res.status(400).json({ error: 'Укажите URL или описание страницы' });
      return;
    }

    try {
      let metadata = null;
      if (rawUrl && (!title || !readerContent)) {
        try {
          metadata = await scrapeUrlMetadata(rawUrl);
          if (!metadata.cover && isBrowserConfigured()) {
            const screenshotCover = await captureCoverScreenshot(metadata.url);
            if (screenshotCover) metadata.cover = screenshotCover;
          }
          if (!title) title = metadata.title;
          if (!excerpt) excerpt = metadata.excerpt;
          if (!readerContent) readerContent = metadata.reader_content;
        } catch {
          // Proceed with URL and whatever fields are available if target blocks scraping
        }
      }

      const existingTags = listTags().map((t) => t.tag);
      const suggestion = await suggestTagsWithAi({
        url: metadata?.url || rawUrl,
        title,
        excerpt,
        readerContent,
        existingTags,
      });

      res.json({
        ...suggestion,
        metadata,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось подобрать теги',
      });
    }
  });

  app.post('/api/ai/search', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (query.length < 2) {
      res.status(400).json({ error: 'Введите запрос для умного поиска (минимум 2 символа)' });
      return;
    }

    try {
      const candidates = listBookmarks({
        scope: typeof req.body?.scope === 'string' ? req.body.scope : 'all',
        collectionId: typeof req.body?.collectionId === 'string' ? req.body.collectionId : undefined,
        filterType: typeof req.body?.filterType === 'string' ? req.body.filterType : undefined,
        tag: typeof req.body?.tag === 'string' ? req.body.tag : undefined,
        sort: 'newest',
        includeNested: true,
      });

      const result = await smartSearchBookmarksWithAi({
        query: query.slice(0, 300),
        bookmarks: candidates,
      });

      const byId = new Map(candidates.map((bm) => [bm.id, bm]));
      const rankedBookmarks = result.matchedIds
        .map((id) => byId.get(id))
        .filter((bm): bm is NonNullable<typeof bm> => Boolean(bm));

      res.json({
        bookmarks: rankedBookmarks,
        reasons: result.reasons,
        model: result.model,
        scannedCount: result.scannedCount,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось выполнить умный поиск с ИИ',
      });
    }
  });

  app.post('/api/bookmarks/:id/summary', async (req, res) => {
    const existing = getBookmarkById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }

    try {
      let readerContent = existing.reader_content;
      if (readerContent.trim().length < 250) {
        try {
          const meta = await scrapeUrlMetadata(existing.url);
          if (meta.reader_content && meta.reader_content.trim().length > readerContent.trim().length) {
            readerContent = meta.reader_content;
          }
        } catch {
          // Proceed with existing title/excerpt/note/highlights if target site blocks scraping
        }
      }

      if (!readerContent.trim() && !existing.excerpt.trim() && !existing.note.trim() && !existing.title.trim()) {
        res.status(400).json({ error: 'Недостаточно текста для создания краткой выжимки' });
        return;
      }

      const summary = await summarizeBookmarkWithAi({
        url: existing.url,
        title: existing.title,
        excerpt: existing.excerpt,
        note: existing.note,
        readerContent,
        highlights: existing.highlights.map((h) => h.text),
      });

      const storedPayload = JSON.stringify({
        tldr: summary.tldr,
        bullets: summary.bullets,
        model: summary.model,
        created_at: new Date().toISOString(),
      });

      const updated = updateBookmarkAiSummary(existing.id, storedPayload, readerContent);
      res.json({
        bookmark: updated || existing,
        summary,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Не удалось создать краткую выжимку',
      });
    }
  });

  app.delete('/api/bookmarks/:id/summary', (req, res) => {
    const updated = updateBookmarkAiSummary(req.params.id, '');
    if (!updated) {
      res.status(404).json({ error: 'Закладка не найдена' });
      return;
    }
    res.json(updated);
  });

  // --- Import / Export ---
  app.post('/api/import', (req, res) => {
    const format = req.body?.format;
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content.trim()) {
      res.status(400).json({ error: 'Пустой файл импорта' });
      return;
    }

    try {
      let importedCount = 0;

      if (format === 'json') {
        const parsed = JSON.parse(content) as {
          collections?: Array<{ title: string }>;
          bookmarks?: Array<{
            url?: string;
            title?: string;
            excerpt?: string;
            note?: string;
            cover?: string;
            type?: BookmarkType;
            card_color?: CardColor;
            todo_items?: TodoItem[];
            tags?: string[];
            folder?: string;
            created_at?: string;
          }>;
        };
        const items = Array.isArray(parsed) ? parsed : parsed.bookmarks || [];
        for (const item of items) {
          const isLocal = item?.type === 'note' || item?.type === 'todo';
          if (!isLocal && !item?.url) continue;
          const folderPath = typeof item.folder === 'string' && item.folder.trim()
            ? item.folder.split('/').map((s: string) => s.trim()).filter(Boolean)
            : [];
          const colId = folderPath.length ? ensureCollectionPath(folderPath) : null;
          try {
            createBookmark({
              url: item.url || '',
              title: item.title,
              excerpt: item.excerpt,
              note: item.note,
              cover: item.cover,
              type: item.type,
              card_color: item.card_color,
              todo_items: Array.isArray(item.todo_items) ? item.todo_items : undefined,
              collection_id: colId,
              tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
              created_at: item.created_at,
            });
            importedCount++;
          } catch {
            // Skip invalid URLs in batch import
          }
        }
      } else if (format === 'csv') {
        const items = parseBookmarksCsv(content);
        for (const item of items) {
          const colId = item.folderPath.length ? ensureCollectionPath(item.folderPath) : null;
          try {
            createBookmark({
              url: item.url,
              title: item.title,
              excerpt: item.excerpt,
              note: item.note,
              cover: item.cover,
              type: item.type,
              collection_id: colId,
              tags: item.tags,
              created_at: item.created_at,
            });
            importedCount++;
          } catch {
            // Skip invalid rows
          }
        }
      } else {
        // Default: Netscape HTML (Raindrop.io / Chrome / Firefox / Safari)
        const items = parseNetscapeHtml(content);
        for (const item of items) {
          const colId = item.folderPath.length ? ensureCollectionPath(item.folderPath) : null;
          try {
            createBookmark({
              url: item.url,
              title: item.title,
              excerpt: item.excerpt,
              note: item.note,
              cover: item.cover,
              type: item.type,
              collection_id: colId,
              tags: item.tags,
              created_at: item.created_at,
            });
            importedCount++;
          } catch {
            // Skip invalid links
          }
        }
      }

      res.json({ imported: importedCount });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Ошибка разбора файла импорта' });
    }
  });

  app.get('/api/export', (req, res) => {
    const format = typeof req.query.format === 'string' ? req.query.format : 'html';
    const collections = listCollections();
    const bookmarks = listBookmarks({ scope: 'all', sort: 'newest' });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dropkeep-backup.json"');
      res.send(
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            collections,
            bookmarks,
          },
          null,
          2
        )
      );
      return;
    }

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dropkeep-bookmarks.csv"');
      res.send(exportBookmarksCsv(collections, bookmarks));
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dropkeep-bookmarks.html"');
    res.send(exportNetscapeHtml(collections, bookmarks));
  });

  // --- Serve Frontend ---
  const publicDir = path.resolve(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Dropkeep server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Dropkeep server:', err);
  process.exit(1);
});
