import { useEffect, useRef, useState } from 'react';
import {
  ClipboardPaste,
  Globe,
  Image as ImageIcon,
  Layers,
  Link2,
  ListChecks,
  Loader2,
  Plus,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { Bookmark, BookmarkType, CardColor, Collection, TodoItem } from '../types';
import { formatTodoItemsForAi } from '../utils/notes';
import { BookmarkCover } from './BookmarkCover';
import { NoteImagePicker } from './NoteImagePicker';
import { CardColorPicker, TodoItemsEditor } from './TodoItemsEditor';

export type AddModalMode = 'single' | 'note' | 'todo' | 'batch';

export interface BookmarkDraft {
  url: string;
  title?: string;
  excerpt?: string;
}

interface AddBookmarkModalProps {
  collections: Collection[];
  defaultCollectionId: string | null;
  aiConfigured: boolean;
  initialMode?: AddModalMode;
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

function isYouTubeUrlClient(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'youtu.be' ||
      host === 'www.youtu.be' ||
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com' ||
      host === 'www.youtube-nocookie.com'
    );
  } catch {
    return false;
  }
}

export function AddBookmarkModal({
  collections,
  defaultCollectionId,
  aiConfigured,
  initialMode = 'single',
  initialDraft,
  onClose,
  onCreated,
  onBatchDone,
}: AddBookmarkModalProps) {
  const [mode, setMode] = useState<AddModalMode>(initialDraft?.url ? 'single' : initialMode);
  const [url, setUrl] = useState(initialDraft?.url || '');
  const [title, setTitle] = useState(initialDraft?.title || '');
  const [excerpt, setExcerpt] = useState(initialDraft?.excerpt || '');
  const [noteBody, setNoteBody] = useState('');
  const [cardColor, setCardColor] = useState<CardColor>('');
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [cover, setCover] = useState('');
  const [favicon, setFavicon] = useState('');
  const [readerContent, setReaderContent] = useState('');
  const [type, setType] = useState<BookmarkType>('link');
  const [collectionId, setCollectionId] = useState<string>(defaultCollectionId || '');
  const [tagsRaw, setTagsRaw] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [saveOfflinePdf, setSaveOfflinePdf] = useState(false);
  const [autoAiYoutube, setAutoAiYoutube] = useState(true);

  const [batchUrls, setBatchUrls] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchingCover, setFetchingCover] = useState(false);
  const [aiBusy, setAiBusy] = useState<null | 'all' | 'tags' | 'excerpt' | 'collection'>(null);
  const [aiNote, setAiNote] = useState('');
  const [clipboardHint, setClipboardHint] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const userEditedUrlRef = useRef(false);
  const userEditedExcerptRef = useRef(false);
  const isYoutubeLink = isYouTubeUrlClient(url);

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

    if (initialMode !== 'single') return;
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
        // Browser blocked automatic clipboard read
      });

    return () => {
      cancelled = true;
    };
  }, [initialDraft, initialMode]);

  const switchMode = (next: AddModalMode) => {
    setMode(next);
    setCover('');
    setError('');
    setAiNote('');
    userEditedExcerptRef.current = false;
  };

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
      setTitle((curr) => (!curr.trim() || curr === meta.domain ? meta.title : curr));
      setExcerpt((curr) => (!curr.trim() ? meta.excerpt : curr));
      setCover((curr) => (!curr.trim() ? meta.cover : curr));
      setFavicon((curr) => curr || meta.favicon);
      setType(meta.type);
      setReaderContent((curr) =>
        meta.reader_content && meta.reader_content.length > curr.length ? meta.reader_content : curr
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить метаданные страницы');
    } finally {
      setFetching(false);
    }
  };

  const handleFetchCoverOnly = async () => {
    if (!url.trim()) return;
    setFetchingCover(true);
    setError('');
    try {
      const res = await api.fetchCoverOnly(url.trim());
      if (res.cover) {
        setCover(res.cover);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить превью со страницы');
    } finally {
      setFetchingCover(false);
    }
  };

  const parseTags = () =>
    tagsRaw
      .split(/[,#\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

  const canRunAi =
    mode === 'single'
      ? Boolean(url.trim() || title.trim() || excerpt.trim())
      : mode === 'note'
        ? Boolean(title.trim() || noteBody.trim())
        : mode === 'todo'
          ? Boolean(title.trim() || excerpt.trim() || todoItems.length > 0)
          : false;

  const runAiSuggest = async (modeType: 'all' | 'tags' | 'excerpt' | 'collection') => {
    if (!canRunAi) return;
    setError('');
    setAiNote('');

    const currentTags = parseTags();
    const fields =
      modeType === 'all'
        ? {
            excerpt: mode !== 'note' && !excerpt.trim(),
            collection: !collectionId,
            tags: currentTags.length === 0,
          }
        : {
            excerpt: mode !== 'note' && modeType === 'excerpt',
            collection: modeType === 'collection',
            tags: modeType === 'tags',
          };

    if (!fields.excerpt && !fields.collection && !fields.tags) {
      setAiNote('Описание, коллекция и теги уже заполнены — обновите нужное поле отдельной кнопкой');
      return;
    }

    setAiBusy(modeType);

    const aiReaderContent =
      mode === 'note'
        ? noteBody.trim()
        : mode === 'todo'
          ? formatTodoItemsForAi(todoItems)
          : readerContent;

    try {
      const res = await api.suggestBookmark({
        url: mode === 'single' ? url.trim() : '',
        title: title.trim(),
        excerpt: mode === 'note' ? '' : excerpt.trim(),
        reader_content: aiReaderContent,
        fields,
      });

      if (mode === 'single' && res.metadata) {
        const meta = res.metadata;
        setUrl(meta.url);
        setTitle((curr) => (!curr.trim() || curr === meta.domain ? meta.title : curr));
        if (!fields.excerpt) {
          setExcerpt((curr) => (!curr.trim() ? meta.excerpt : curr));
        }
        setCover((curr) => (!curr.trim() ? meta.cover : curr));
        setFavicon((curr) => curr || meta.favicon);
        setType(meta.type);
        setReaderContent((curr) =>
          meta.reader_content && meta.reader_content.length > curr.length
            ? meta.reader_content
            : curr
        );
      }

      const summaryParts: string[] = [];

      if (fields.excerpt && res.excerpt) {
        setExcerpt(res.excerpt);
        userEditedExcerptRef.current = true;
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
        setTagsRaw((prev) => {
          const existing = prev
            .split(/[,#\s]+/)
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean);
          return Array.from(new Set([...existing, ...res.tags])).join(', ');
        });
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
        setAiNote('ИИ не смог подобрать значения для этой записи');
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
        auto_ai_youtube: isYoutubeLink && aiConfigured ? autoAiYoutube : false,
        user_edited_excerpt: userEditedExcerptRef.current,
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить закладку');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !noteBody.trim() && !cover.trim()) {
      setError('Введите заголовок, текст заметки или добавьте изображение');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const derivedTitle =
        title.trim() || noteBody.trim().split(/\r?\n/)[0].slice(0, 120) || 'Новая заметка';
      const created = await api.createBookmark({
        url: '',
        title: derivedTitle,
        note: noteBody.trim(),
        cover: cover.trim(),
        type: 'note',
        card_color: cardColor,
        collection_id: collectionId || null,
        is_favorite: isFavorite,
        tags: parseTags(),
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать заметку');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = todoItems.filter((item) => item.text.trim().length > 0);
    if (!title.trim() && validItems.length === 0) {
      setError('Введите название списка или добавьте хотя бы одну задачу');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const created = await api.createBookmark({
        url: '',
        title: title.trim() || 'Список задач',
        excerpt: excerpt.trim(),
        type: 'todo',
        card_color: cardColor,
        todo_items: validItems,
        collection_id: collectionId || null,
        is_favorite: isFavorite,
        tags: parseTags(),
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать список задач');
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
          auto_ai_youtube: aiConfigured,
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

  const renderCollectionAndTags = () => (
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
              disabled={Boolean(aiBusy) || !canRunAi}
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
            placeholder="идеи, работа, планы"
            className="flex-1 min-w-0 h-9 px-3 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
          />
          {aiConfigured && (
            <button
              type="button"
              onClick={() => runAiSuggest('tags')}
              disabled={Boolean(aiBusy) || !canRunAi}
              title="Подобрать 2–3 тега по содержанию (с приоритетом существующих)"
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
  );

  const modalHeading =
    mode === 'note'
      ? 'Новая заметка'
      : mode === 'todo'
        ? 'Новый список задач'
        : mode === 'batch'
          ? 'Добавить несколько ссылок'
          : 'Добавить закладку';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[580px] max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-[#222429] border border-[#E6E8EC] dark:border-[#34373E] shadow-2xl overflow-hidden"
      >
        {/* Header + Mode Tabs */}
        <div className="px-5 pt-3.5 pb-3 border-b border-[#E6E8EC] dark:border-[#30333A] space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
              {modalHeading}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="w-8 h-8 rounded-md flex items-center justify-center text-[#8B929E] hover:bg-[#F4F5F7] dark:hover:bg-[#30333A]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#F4F5F7] dark:bg-[#2C2F36]">
            <button
              type="button"
              onClick={() => switchMode('single')}
              className={`h-8 px-2 rounded-md text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                mode === 'single'
                  ? 'bg-white dark:bg-[#3B3F48] text-[#181A1F] dark:text-white shadow-xs'
                  : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
              }`}
            >
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span>Ссылка</span>
            </button>
            <button
              type="button"
              onClick={() => switchMode('note')}
              className={`h-8 px-2 rounded-md text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                mode === 'note'
                  ? 'bg-white dark:bg-[#3B3F48] text-[#181A1F] dark:text-white shadow-xs'
                  : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
              }`}
            >
              <StickyNote className="w-3.5 h-3.5 shrink-0" />
              <span>Заметка</span>
            </button>
            <button
              type="button"
              onClick={() => switchMode('todo')}
              className={`h-8 px-2 rounded-md text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                mode === 'todo'
                  ? 'bg-white dark:bg-[#3B3F48] text-[#181A1F] dark:text-white shadow-xs'
                  : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5 shrink-0" />
              <span>Задачи</span>
            </button>
            <button
              type="button"
              onClick={() => switchMode('batch')}
              className={`h-8 px-2 rounded-md text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                mode === 'batch'
                  ? 'bg-white dark:bg-[#3B3F48] text-[#181A1F] dark:text-white shadow-xs'
                  : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>Списком</span>
            </button>
          </div>
        </div>

        {/* Scrollable Form Body */}
        <div className="overflow-y-auto flex-1">
          {mode === 'single' && (
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
                      disabled={Boolean(aiBusy) || !canRunAi}
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
                    onClick={handleFetchCoverOnly}
                    disabled={fetchingCover || fetching || !url.trim()}
                    title="Загрузить только картинку превью без изменения названия и описания"
                    className="h-10 px-2.5 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[13px] font-medium text-[#2C313A] dark:text-[#E5E7EB] flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {fetchingCover ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ImageIcon className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">Превью</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleFetchMeta}
                    disabled={fetching || fetchingCover || !url.trim()}
                    title="Загрузить название, описание, превью и текст со страницы"
                    className="h-10 px-3 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[13px] font-medium text-[#2C313A] dark:text-[#E5E7EB] flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
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
                      disabled={Boolean(aiBusy) || !canRunAi}
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
                  onChange={(e) => {
                    userEditedExcerptRef.current = e.target.value.trim().length > 0;
                    setExcerpt(e.target.value);
                  }}
                  placeholder={
                    isYoutubeLink && aiConfigured && autoAiYoutube
                      ? 'Оставьте пустым — ИИ соберёт краткое описание из содержимого ролика при сохранении...'
                      : 'Краткая выдержка на 1–2 предложения...'
                  }
                  className="w-full px-3 py-2 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none resize-none"
                />
              </div>

              {renderCollectionAndTags()}

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
                  {isYoutubeLink && aiConfigured && (
                    <label className="inline-flex items-center gap-2 text-[12.5px] text-[#0B72E7] dark:text-[#58A6FF] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoAiYoutube}
                        onChange={(e) => setAutoAiYoutube(e.target.checked)}
                        className="rounded border-[#CBD5E1] accent-[#0B72E7]"
                      />
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span>Собрать описание из содержимого YouTube-видео (ИИ)</span>
                    </label>
                  )}
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
                    className="h-9 px-4 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-60 text-white text-[13px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    <span>
                      {submitting
                        ? isYoutubeLink && aiConfigured && autoAiYoutube && !userEditedExcerptRef.current
                          ? 'Анализ видео ИИ...'
                          : 'Сохранение...'
                        : 'Сохранить'}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {mode === 'note' && (
            <form onSubmit={handleSubmitNote} className="p-5 space-y-4">
              {error && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                    Заголовок заметки
                  </label>
                  {aiConfigured && (
                    <button
                      type="button"
                      onClick={() => runAiSuggest('all')}
                      disabled={Boolean(aiBusy) || !canRunAi}
                      title="ИИ подберёт подходящую коллекцию и 2–3 тега по тексту заметки"
                      className="text-[12px] font-medium text-[#0B72E7] dark:text-[#58A6FF] hover:underline inline-flex items-center gap-1 disabled:opacity-45"
                    >
                      {aiBusy === 'all' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{aiBusy === 'all' ? 'Подбор...' : 'Подобрать теги и папку ИИ'}</span>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например: Идеи по домашнему серверу"
                  autoFocus
                  className="w-full h-10 px-3 rounded-lg text-[13.5px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                  Текст заметки
                </label>
                <textarea
                  rows={6}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Напишите мысли, команды, фрагменты или памятку..."
                  className="w-full px-3 py-2.5 rounded-lg text-[13.5px] leading-relaxed bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none resize-y"
                />
              </div>

              <NoteImagePicker value={cover} onChange={setCover} />

              <CardColorPicker value={cardColor} onChange={setCardColor} />

              {renderCollectionAndTags()}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#ECEEF2] dark:border-[#30333A]">
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFavorite}
                    onChange={(e) => setIsFavorite(e.target.checked)}
                    className="rounded border-[#CBD5E1] accent-[#0B72E7]"
                  />
                  <span>Добавить в избранное</span>
                </label>

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
                    <span>{submitting ? 'Сохранение...' : 'Создать заметку'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {mode === 'todo' && (
            <form onSubmit={handleSubmitTodo} className="p-5 space-y-4">
              {error && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                    Название списка
                  </label>
                  {aiConfigured && (
                    <button
                      type="button"
                      onClick={() => runAiSuggest('all')}
                      disabled={Boolean(aiBusy) || !canRunAi}
                      title="ИИ составит описание, подберёт коллекцию и 2–3 тега по вашим задачам"
                      className="text-[12px] font-medium text-[#0B72E7] dark:text-[#58A6FF] hover:underline inline-flex items-center gap-1 disabled:opacity-45"
                    >
                      {aiBusy === 'all' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{aiBusy === 'all' ? 'Анализ...' : 'Заполнить с ИИ'}</span>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например: Переезд на новый сервер"
                  autoFocus
                  className="w-full h-10 px-3 rounded-lg text-[13.5px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none"
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
                      disabled={Boolean(aiBusy) || !canRunAi}
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
                  placeholder="Краткое описание цели или контекста списка задач..."
                  className="w-full px-3 py-2 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1.5">
                  Задачи (с прогрессом % и приоритетом)
                </label>
                <TodoItemsEditor items={todoItems} onChange={setTodoItems} />
              </div>

              <CardColorPicker value={cardColor} onChange={setCardColor} />

              {renderCollectionAndTags()}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#ECEEF2] dark:border-[#30333A]">
                <label className="inline-flex items-center gap-2 text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFavorite}
                    onChange={(e) => setIsFavorite(e.target.checked)}
                    className="rounded border-[#CBD5E1] accent-[#0B72E7]"
                  />
                  <span>Добавить в избранное</span>
                </label>

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
                    <span>{submitting ? 'Сохранение...' : 'Создать список'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {mode === 'batch' && (
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
    </div>
  );
}
