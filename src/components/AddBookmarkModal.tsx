import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Globe, Layers, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import type { Bookmark, BookmarkType, Collection } from '../types';
import { BookmarkCover } from './BookmarkCover';

export interface BookmarkDraft {
  url: string;
  title?: string;
  excerpt?: string;
}

interface AddBookmarkModalProps {
  collections: Collection[];
  defaultCollectionId: string | null;
  aiConfigured: boolean;
  initialDraft?: BookmarkDraft | null;
  onClose: () => void;
  onCreated: (bookmark: Bookmark) => void;
  onBatchDone: () => void;
}

function extractValidHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048 || /[\r\n\s]/.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function AddBookmarkModal({
  collections,
  defaultCollectionId,
  aiConfigured,
  initialDraft,
  onClose,
  onCreated,
  onBatchDone,
}: AddBookmarkModalProps) {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [url, setUrl] = useState(initialDraft?.url || '');
  const [title, setTitle] = useState(initialDraft?.title || '');
  const [excerpt, setExcerpt] = useState(initialDraft?.excerpt || '');
  const [cover, setCover] = useState('');
  const [favicon, setFavicon] = useState('');
  const [readerContent, setReaderContent] = useState('');
  const [type, setType] = useState<BookmarkType>('link');
  const [collectionId, setCollectionId] = useState<string>(defaultCollectionId || '');
  const [tagsRaw, setTagsRaw] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [saveOfflinePdf, setSaveOfflinePdf] = useState(false);

  const [batchUrls, setBatchUrls] = useState('');
  const [fetching, setFetching] = useState(false);
  const [aiBusy, setAiBusy] = useState<null | 'all' | 'tags' | 'excerpt' | 'collection'>(null);
  const [aiNote, setAiNote] = useState('');
  const [clipboardHint, setClipboardHint] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const userEditedUrlRef = useRef(false);

  // Auto-paste a valid URL from clipboard when opening empty single-URL form,
  // or auto-fetch cover/favicon/content when opened via browser bookmarklet.
  useEffect(() => {
    let cancelled = false;

    if (initialDraft?.url) {
      setFetching(true);
      api
        .fetchMetadata(initialDraft.url)
        .then((meta) => {
          if (cancelled) return;
          setUrl((curr) => (curr === initialDraft.url ? meta.url : curr));
          setTitle((curr) => (!curr.trim() || curr === meta.domain ? meta.title : curr));
          setExcerpt((curr) => (!curr.trim() ? meta.excerpt : curr));
          setCover((curr) => (!curr.trim() ? meta.cover : curr));
          setFavicon((curr) => curr || meta.favicon);
          setType(meta.type);
          setReaderContent((curr) => curr || meta.reader_content);
        })
        .catch(() => {
          // Keep prefilled URL/title/excerpt even if target site blocks scraping
        })
        .finally(() => {
          if (!cancelled) setFetching(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return;

    navigator.clipboard
      .readText()
      .then((text) => {
        if (cancelled || userEditedUrlRef.current) return;
        const validUrl = extractValidHttpUrl(text);
        if (!validUrl) return;
        if (validUrl === window.location.href) return;
        setUrl(validUrl);
        setClipboardHint('Ссылка вставлена из буфера обмена');
      })
      .catch(() => {
        // Browser blocked automatic clipboard read (e.g. iframe or permission prompt)
      });

    return () => {
      cancelled = true;
    };
  }, [initialDraft]);

  const handleManualClipboardPaste = async () => {
    if (!navigator.clipboard?.readText) {
      setError('Браузер не разрешает доступ к буферу обмена. Вставьте ссылку через Ctrl+V / ⌘+V.');
      return;
    }
    setError('');
    try {
      const text = await navigator.clipboard.readText();
      const validUrl = extractValidHttpUrl(text);
      if (!validUrl) {
        setClipboardHint('В буфере обмена нет корректной http/https ссылки');
        return;
      }
      userEditedUrlRef.current = true;
      setUrl(validUrl);
      setClipboardHint('Ссылка вставлена из буфера обмена');
    } catch {
      setError('Нет доступа к буферу обмена. Вставьте ссылку вручную (Ctrl+V / ⌘+V).');
    }
  };

  const handleFetchMeta = async () => {
    if (!url.trim()) return;
    setFetching(true);
    setError('');
    try {
      const meta = await api.fetchMetadata(url.trim());
      setUrl(meta.url);
      if (!title.trim() || title === meta.domain) setTitle(meta.title);
      if (!excerpt.trim()) setExcerpt(meta.excerpt);
      if (!cover.trim()) setCover(meta.cover);
      setFavicon(meta.favicon);
      setType(meta.type);
      setReaderContent(meta.reader_content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить метаданные страницы');
    } finally {
      setFetching(false);
    }
  };

  const parseTags = () =>
    tagsRaw
      .split(/[,#\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

  const runAiSuggest = async (modeType: 'all' | 'tags' | 'excerpt' | 'collection') => {
    if (!url.trim() && !title.trim() && !excerpt.trim()) return;
    setAiBusy(modeType);
    setError('');
    setAiNote('');

    const fields =
      modeType === 'all'
        ? { tags: true, collection: true, excerpt: true }
        : {
            tags: modeType === 'tags',
            collection: modeType === 'collection',
            excerpt: modeType === 'excerpt',
          };

    try {
      const res = await api.suggestBookmark({
        url: url.trim(),
        title: title.trim(),
        excerpt: excerpt.trim(),
        reader_content: readerContent,
        fields,
      });

      if (res.metadata) {
        setUrl(res.metadata.url);
        if (!title.trim() || title === res.metadata.domain) setTitle(res.metadata.title);
        if (!fields.excerpt && !excerpt.trim()) setExcerpt(res.metadata.excerpt);
        if (!cover.trim()) setCover(res.metadata.cover);
        if (!favicon) setFavicon(res.metadata.favicon);
        setType(res.metadata.type);
        if (!readerContent) setReaderContent(res.metadata.reader_content);
      }

      const summaryParts: string[] = [];

      if (fields.excerpt && res.excerpt) {
        setExcerpt(res.excerpt);
        summaryParts.push('описание');
      }

      if (fields.collection) {
        if (res.collection_id) {
          setCollectionId(res.collection_id);
          summaryParts.push(`коллекция «${res.collection_title}»`);
        } else if (modeType === 'collection') {
          summaryParts.push('подходящая коллекция не найдена');
        }
      }

      if (fields.tags && res.tags.length > 0) {
        const merged = Array.from(new Set([...parseTags(), ...res.tags]));
        setTagsRaw(merged.join(', '));
        const tagDetails: string[] = [];
        if (res.existingMatches.length > 0) {
          tagDetails.push(`из ваших: ${res.existingMatches.map((t) => `#${t}`).join(', ')}`);
        }
        if (res.newTags.length > 0) {
          tagDetails.push(`новые: ${res.newTags.map((t) => `#${t}`).join(', ')}`);
        }
        summaryParts.push(tagDetails.join(', '));
      }

      if (summaryParts.length > 0) {
        setAiNote(summaryParts.join(' · '));
      } else {
        setAiNote('ИИ не смог подобрать значения для этой страницы');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить подсказки от ИИ');
    } finally {
      setAiBusy(null);
    }
  };

  const handleSubmitSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Введите адрес ссылки');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let finalTitle = title.trim();
      let finalExcerpt = excerpt.trim();
      let finalCover = cover.trim();
      let finalFavicon = favicon;
      let finalType = type;
      let finalReader = readerContent;

      // Auto-fetch metadata once if user pressed Save directly before metadata finished loading
      if ((!finalTitle && !finalExcerpt) || (!finalCover && !finalFavicon && !finalReader)) {
        try {
          const meta = await api.fetchMetadata(url.trim());
          finalTitle = finalTitle || meta.title;
          finalExcerpt = finalExcerpt || meta.excerpt;
          finalCover = finalCover || meta.cover;
          finalFavicon = finalFavicon || meta.favicon;
          finalType = meta.type;
          finalReader = finalReader || meta.reader_content;
        } catch {
          // Proceed with basic save even if target site blocks bot
        }
      }

      const created = await api.createBookmark({
        url: url.trim(),
        title: finalTitle || undefined,
        excerpt: finalExcerpt,
        cover: finalCover,
        favicon: finalFavicon,
        type: finalType,
        collection_id: collectionId || null,
        is_favorite: isFavorite,
        reader_content: finalReader,
        tags: parseTags(),
        save_offline_pdf: saveOfflinePdf,
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить закладку');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = batchUrls
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) {
      setError('Вставьте хотя бы одну ссылку');
      return;
    }

    setSubmitting(true);
    setError('');
    const tags = parseTags();
    let okCount = 0;

    for (const line of lines) {
      try {
        let meta = null;
        try {
          meta = await api.fetchMetadata(line);
        } catch {
          meta = null;
        }
        await api.createBookmark({
          url: meta?.url || line,
          title: meta?.title,
          excerpt: meta?.excerpt || '',
          cover: meta?.cover || '',
          favicon: meta?.favicon || '',
          type: meta?.type || 'link',
          collection_id: collectionId || null,
          reader_content: meta?.reader_content || '',
          tags,
        });
        okCount++;
      } catch {
        // skip invalid line
      }
    }

    setSubmitting(false);
    if (okCount === 0) {
      setError('Не удалось добавить ссылки. Проверьте корректность адресов.');
      return;
    }
    onBatchDone();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] rounded-xl bg-white dark:bg-[#222429] border border-[#E6E8EC] dark:border-[#34373E] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#E6E8EC] dark:border-[#30333A] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
              Добавить закладку
            </h2>
            <div className="flex items-center p-0.5 rounded-md bg-[#F4F5F7] dark:bg-[#2C2F36]">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`px-2.5 py-1 rounded text-[12px] font-medium transition-colors ${
                  mode === 'single'
                    ? 'bg-white dark:bg-[#3B3F48] text-[#181A1F] dark:text-white shadow-xs'
                    : 'text-[#5F6672] dark:text-[#A1A7B3]'
                }`}
              >
                Одна ссылка
              </button>
              <button
                type="button"
                onClick={() => setMode('batch')}
                className={`px-2.5 py-1 rounded text-[12px] font-medium transition-colors flex items-center gap-1 ${
                  mode === 'batch'
                    ? 'bg-white dark:bg-[#3B3F48] text-[#181A1F] dark:text-white shadow-xs'
                    : 'text-[#5F6672] dark:text-[#A1A7B3]'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Список</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#8B929E] hover:bg-[#F4F5F7] dark:hover:bg-[#30333A]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        {mode === 'single' ? (
          <form onSubmit={handleSubmitSingle} className="p-5 space-y-4">
            {error && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                  URL страницы
                </label>
                {aiConfigured && (
                  <button
                    type="button"
                    onClick={() => runAiSuggest('all')}
                    disabled={Boolean(aiBusy) || (!url.trim() && !title.trim())}
                    title="ИИ заполнит описание (1–2 предложения), подберёт коллекцию и 2–3 тега"
                    className="text-[12px] font-medium text-[#0B72E7] dark:text-[#58A6FF] hover:underline inline-flex items-center gap-1 disabled:opacity-45"
                  >
                    {aiBusy === 'all' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>{aiBusy === 'all' ? 'Анализ страницы...' : 'Заполнить с ИИ'}</span>
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => {
                      userEditedUrlRef.current = true;
                      setUrl(e.target.value);
                      if (clipboardHint) setClipboardHint('');
                    }}
                    placeholder="https://example.com/article"
                    autoFocus
                    className={`w-full h-10 pl-3 ${!url.trim() ? 'pr-9' : 'pr-3'} rounded-lg text-[13.5px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none`}
                  />
                  {!url.trim() && (
                    <button
                      type="button"
                      onClick={handleManualClipboardPaste}
                      title="Вставить ссылку из буфера обмена"
                      aria-label="Вставить ссылку из буфера обмена"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-[#8B929E] hover:text-[#0B72E7] hover:bg-[#ECEEF2] dark:hover:bg-[#363A44] transition-colors"
                    >
                      <ClipboardPaste className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleFetchMeta}
                  disabled={fetching || !url.trim()}
                  className="h-10 px-3.5 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[13px] font-medium text-[#2C313A] dark:text-[#E5E7EB] flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                  <span>Загрузить</span>
                </button>
              </div>
              {clipboardHint && (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-[#5F6672] dark:text-[#9CA3AF]">
                  <span>{clipboardHint}</span>
                  {url.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        userEditedUrlRef.current = true;
                        setUrl('');
                        setClipboardHint('');
                      }}
                      className="text-[#0B72E7] dark:text-[#58A6FF] hover:underline shrink-0"
                    >
                      Очистить
                    </button>
                  )}
                </div>
              )}
            </div>

            {cover && (
              <div className="h-32 rounded-lg overflow-hidden border border-[#E6E8EC] dark:border-[#34373E]">
                <BookmarkCover cover={cover} title={title} domain="" type={type} className="w-full h-full" />
              </div>
            )}

            <div>
              <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                Название (заполнится автоматически)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Заголовок закладки"
                className="w-full h-9 px-3 rounded-lg text-[13.5px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                  Описание
                </label>
                {aiConfigured && (
                  <button
                    type="button"
                    onClick={() => runAiSuggest('excerpt')}
                    disabled={Boolean(aiBusy) || (!url.trim() && !title.trim())}
                    className="text-[11.5px] text-[#5F6672] dark:text-[#9CA3AF] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    {aiBusy === 'excerpt' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    <span>Составить ИИ</span>
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Краткая выдержка на 1–2 предложения..."
                className="w-full px-3 py-2 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none resize-none"
              />
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                    Коллекция
                  </label>
                  {aiConfigured && (
                    <button
                      type="button"
                      onClick={() => runAiSuggest('collection')}
                      disabled={Boolean(aiBusy) || (!url.trim() && !title.trim())}
                      className="text-[11.5px] text-[#5F6672] dark:text-[#9CA3AF] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] inline-flex items-center gap-1 disabled:opacity-40"
                    >
                      {aiBusy === 'collection' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>Подобрать ИИ</span>
                    </button>
                  )}
                </div>
                <select
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                >
                  <option value="">Несортированные</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parent_id ? '↳ ' : ''}
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                  Теги (через запятую)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagsRaw}
                    onChange={(e) => setTagsRaw(e.target.value)}
                    placeholder="docker, homelab, design"
                    className="flex-1 min-w-0 h-9 px-3 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                  />
                  {aiConfigured && (
                    <button
                      type="button"
                      onClick={() => runAiSuggest('tags')}
                      disabled={Boolean(aiBusy) || (!url.trim() && !title.trim())}
                      title="Подобрать 2–3 тега по содержанию страницы (с приоритетом существующих)"
                      className="h-9 px-3 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12.5px] font-medium text-[#2C313A] dark:text-[#E5E7EB] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                    >
                      {aiBusy === 'tags' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-[#0B72E7] dark:text-[#58A6FF]" />
                      )}
                      <span>{aiBusy === 'tags' ? 'Подбор...' : 'Получить теги'}</span>
                    </button>
                  )}
                </div>
                {aiConfigured && aiNote && (
                  <div className="mt-1.5 text-[11.5px] text-[#5F6672] dark:text-[#9CA3AF]">
                    Подобрано ИИ: {aiNote}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#ECEEF2] dark:border-[#30333A]">
              <div className="flex flex-col gap-1.5">
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFavorite}
                    onChange={(e) => setIsFavorite(e.target.checked)}
                    className="rounded border-[#CBD5E1] accent-[#0B72E7]"
                  />
                  <span>Добавить в избранное</span>
                </label>
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveOfflinePdf}
                    onChange={(e) => setSaveOfflinePdf(e.target.checked)}
                    className="rounded border-[#CBD5E1] accent-[#0B72E7]"
                  />
                  <span>Сохранить PDF-снимок для чтения оффлайн</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#30333A]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-9 px-4 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-60 text-white text-[13px] font-medium inline-flex items-center gap-1.5"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span>{submitting ? 'Сохранение...' : 'Сохранить'}</span>
                </button>
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitBatch} className="p-5 space-y-4">
            {error && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <div>
              <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                Ссылки (по одной в строке)
              </label>
              <textarea
                rows={5}
                value={batchUrls}
                onChange={(e) => setBatchUrls(e.target.value)}
                placeholder={'https://docs.docker.com/\nhttps://caddyserver.com/\nhttps://sqlite.org/'}
                autoFocus
                className="w-full px-3 py-2 rounded-lg text-[13px] font-mono bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                  Коллекция
                </label>
                <select
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                >
                  <option value="">Несортированные</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parent_id ? '↳ ' : ''}
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                  Общие теги
                </label>
                <input
                  type="text"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="selfhost, tools"
                  className="w-full h-9 px-3 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#ECEEF2] dark:border-[#30333A]">
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#30333A]"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-9 px-4 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-60 text-white text-[13px] font-medium inline-flex items-center gap-1.5"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{submitting ? 'Импорт ссылок...' : 'Добавить все'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
