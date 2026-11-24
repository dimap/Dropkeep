import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileDown,
  FileText,
  Highlighter,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type {
  AiSummaryData,
  Bookmark,
  BookmarkType,
  Collection,
  HighlightColor,
  TagCount,
} from '../types';
import { formatBytes, formatShortDate, isSafeExternalHref } from '../utils/icons';
import { BookmarkCover } from './BookmarkCover';

interface InspectorPanelProps {
  bookmark: Bookmark;
  collections: Collection[];
  allTags: TagCount[];
  aiConfigured: boolean;
  savingPdf: boolean;
  onClose: () => void;
  onUpdated: (bookmark: Bookmark) => void;
  onOpenPdf: (bookmark: Bookmark) => void;
  onSaveOfflinePdf: (bookmark: Bookmark) => Promise<void>;
  onDeleteOfflinePdf: (bookmark: Bookmark) => Promise<void>;
  onTrash: (bookmark: Bookmark) => void;
  onRestore: (bookmark: Bookmark) => void;
  onDeletePermanent: (bookmark: Bookmark) => void;
}

function parseSavedSummary(raw: string): AiSummaryData | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<AiSummaryData>;
    if (parsed && typeof parsed === 'object' && (parsed.tldr || (Array.isArray(parsed.bullets) && parsed.bullets.length > 0))) {
      return {
        tldr: typeof parsed.tldr === 'string' ? parsed.tldr : '',
        bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String).filter(Boolean) : [],
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        created_at: typeof parsed.created_at === 'string' ? parsed.created_at : undefined,
      };
    }
  } catch {
    return { tldr: trimmed, bullets: [] };
  }
  return null;
}

const HIGHLIGHT_STYLES: Record<HighlightColor, { bg: string; dot: string; label: string }> = {
  yellow: {
    bg: 'bg-[#FEF9C3]/70 dark:bg-[#713F12]/30 border-[#FDE047]/60 dark:border-[#854D0E]',
    dot: 'bg-[#EAB308]',
    label: 'Жёлтый',
  },
  blue: {
    bg: 'bg-[#DBEAFE]/70 dark:bg-[#1E3A8A]/30 border-[#93C5FD]/60 dark:border-[#1D4ED8]',
    dot: 'bg-[#3B82F6]',
    label: 'Синий',
  },
  pink: {
    bg: 'bg-[#FCE7F3]/70 dark:bg-[#831843]/30 border-[#F9A8D4]/60 dark:border-[#9D174D]',
    dot: 'bg-[#EC4899]',
    label: 'Розовый',
  },
  green: {
    bg: 'bg-[#DCFCE7]/70 dark:bg-[#14532D]/30 border-[#86EFAC]/60 dark:border-[#15803D]',
    dot: 'bg-[#22C55E]',
    label: 'Зелёный',
  },
};

export function InspectorPanel({
  bookmark,
  collections,
  allTags,
  aiConfigured,
  savingPdf,
  onClose,
  onUpdated,
  onOpenPdf,
  onSaveOfflinePdf,
  onDeleteOfflinePdf,
  onTrash,
  onRestore,
  onDeletePermanent,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<'edit' | 'reader'>('edit');
  const [title, setTitle] = useState(bookmark.title);
  const [excerpt, setExcerpt] = useState(bookmark.excerpt);
  const [note, setNote] = useState(bookmark.note);
  const [url, setUrl] = useState(bookmark.url);
  const [cover, setCover] = useState(bookmark.cover);
  const [type, setType] = useState<BookmarkType>(bookmark.type);
  const [collectionId, setCollectionId] = useState<string>(bookmark.collection_id || '');
  const [tags, setTags] = useState<string[]>(bookmark.tags);
  const [tagInput, setTagInput] = useState('');
  const [readerContent, setReaderContent] = useState(bookmark.reader_content);
  const [aiSummaryRaw, setAiSummaryRaw] = useState(bookmark.ai_summary);

  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [aiBusy, setAiBusy] = useState<null | 'all' | 'tags' | 'excerpt' | 'collection' | 'summary'>(null);
  const [aiNote, setAiNote] = useState('');
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [summarySavedToNote, setSummarySavedToNote] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const savedSummary = useMemo(() => parseSavedSummary(aiSummaryRaw), [aiSummaryRaw]);

  // Highlight composer
  const [hlText, setHlText] = useState('');
  const [hlNote, setHlNote] = useState('');
  const [hlColor, setHlColor] = useState<HighlightColor>('yellow');
  const [addingHl, setAddingHl] = useState(false);

  useEffect(() => {
    setTitle(bookmark.title);
    setExcerpt(bookmark.excerpt);
    setNote(bookmark.note);
    setUrl(bookmark.url);
    setCover(bookmark.cover);
    setType(bookmark.type);
    setCollectionId(bookmark.collection_id || '');
    setTags(bookmark.tags);
    setReaderContent(bookmark.reader_content);
    setAiSummaryRaw(bookmark.ai_summary);
    setTagInput('');
    setError('');
    setAiNote('');
    setSummaryCopied(false);
    setSummarySavedToNote(false);
    setSavedFeedback(false);
  }, [bookmark]);

  // Hydrate full reader_content & ai_summary lazily so list API stays tiny & instant
  useEffect(() => {
    let cancelled = false;
    api
      .getBookmark(bookmark.id)
      .then((full) => {
        if (cancelled) return;
        setReaderContent(full.reader_content);
        setAiSummaryRaw(full.ai_summary);
      })
      .catch(() => {
        // ignore background hydration failure
      });
    return () => {
      cancelled = true;
    };
  }, [bookmark.id]);

  const addTagValue = (raw: string) => {
    const clean = raw.trim().toLowerCase().replace(/^#/, '');
    if (clean && !tags.includes(clean)) {
      setTags((prev) => [...prev, clean]);
    }
    setTagInput('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateBookmark(bookmark.id, {
        title,
        excerpt,
        note,
        url,
        cover,
        type,
        collection_id: collectionId || null,
        tags,
      });
      onUpdated(updated);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshMetadata = async () => {
    setRefreshing(true);
    setError('');
    try {
      const updated = await api.refreshBookmark(bookmark.id);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить данные со страницы');
    } finally {
      setRefreshing(false);
    }
  };

  const runAiSuggest = async (modeType: 'all' | 'tags' | 'excerpt' | 'collection') => {
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
        url,
        title,
        excerpt,
        reader_content: readerContent,
        fields,
      });

      const parts: string[] = [];
      if (fields.excerpt && res.excerpt) {
        setExcerpt(res.excerpt);
        parts.push('описание');
      }
      if (fields.collection) {
        if (res.collection_id) {
          setCollectionId(res.collection_id);
          parts.push(`коллекция «${res.collection_title}»`);
        } else if (modeType === 'collection') {
          parts.push('коллекция не подобрана');
        }
      }
      if (fields.tags && res.tags.length > 0) {
        setTags((prev) => Array.from(new Set([...prev, ...res.tags])));
        parts.push(`теги: ${res.tags.map((t) => `#${t}`).join(', ')}`);
      }

      if (parts.length > 0) {
        setAiNote(`ИИ: ${parts.join(' · ')} (нажмите «Сохранить»)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить подсказки от ИИ');
    } finally {
      setAiBusy(null);
    }
  };

  const handleGenerateSummary = async (switchToReader = false) => {
    setAiBusy('summary');
    setError('');
    try {
      const res = await api.generateBookmarkSummary(bookmark.id);
      onUpdated(res.bookmark);
      if (switchToReader) setTab('reader');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать краткую выжимку');
    } finally {
      setAiBusy(null);
    }
  };

  const handleDeleteSummary = async () => {
    setAiBusy('summary');
    setError('');
    try {
      const updated = await api.deleteBookmarkSummary(bookmark.id);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить выжимку');
    } finally {
      setAiBusy(null);
    }
  };

  const formatSummaryPlainText = (summary: AiSummaryData): string => {
    const lines: string[] = [];
    if (summary.tldr) lines.push(summary.tldr);
    if (summary.bullets.length > 0) {
      lines.push(...summary.bullets.map((b) => `• ${b}`));
    }
    return lines.join('\n');
  };

  const handleCopySummary = () => {
    if (!savedSummary) return;
    navigator.clipboard?.writeText(formatSummaryPlainText(savedSummary)).catch(() => {});
    setSummaryCopied(true);
    setTimeout(() => setSummaryCopied(false), 1500);
  };

  const handleSaveSummaryToNote = async () => {
    if (!savedSummary) return;
    const textBlock = formatSummaryPlainText(savedSummary);
    const nextNote = note.trim() ? `${note.trim()}\n\n${textBlock}` : textBlock;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateBookmark(bookmark.id, { note: nextNote });
      setNote(updated.note);
      onUpdated(updated);
      setSummarySavedToNote(true);
      setTimeout(() => setSummarySavedToNote(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить выжимку в заметку');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFavorite = async () => {
    try {
      const updated = await api.updateBookmark(bookmark.id, { is_favorite: !bookmark.is_favorite });
      onUpdated(updated);
    } catch {
      // ignore
    }
  };

  const handleAddHighlight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hlText.trim()) return;
    setAddingHl(true);
    setError('');
    try {
      const created = await api.addHighlight(bookmark.id, {
        text: hlText.trim(),
        note: hlNote.trim(),
        color: hlColor,
      });
      onUpdated({
        ...bookmark,
        highlights: [created, ...bookmark.highlights],
      });
      setHlText('');
      setHlNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления выделения');
    } finally {
      setAddingHl(false);
    }
  };

  const handleDeleteHighlight = async (hlId: string) => {
    try {
      await api.deleteHighlight(hlId);
      onUpdated({
        ...bookmark,
        highlights: bookmark.highlights.filter((h) => h.id !== hlId),
      });
    } catch {
      // ignore
    }
  };

  const tagSuggestions = allTags
    .map((t) => t.tag)
    .filter((t) => !tags.includes(t) && (!tagInput.trim() || t.includes(tagInput.trim().toLowerCase())))
    .slice(0, 6);

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-[400px] xl:static xl:w-[390px] xl:shrink-0 h-full flex flex-col bg-white dark:bg-[#1E1F23] border-l border-[#E6E8EC] dark:border-[#2B2D32] shadow-xl xl:shadow-none">
      {/* Header */}
      <div className="h-[54px] px-4 flex items-center justify-between gap-2 border-b border-[#E6E8EC] dark:border-[#2B2D32] shrink-0">
        <div className="flex items-center p-0.5 rounded-lg bg-[#F4F5F7] dark:bg-[#2A2C31]">
          <button
            type="button"
            onClick={() => setTab('edit')}
            className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors whitespace-nowrap ${
              tab === 'edit'
                ? 'bg-white dark:bg-[#3A3D45] text-[#181A1F] dark:text-white shadow-xs'
                : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
            }`}
          >
            Свойства
          </button>
          <button
            type="button"
            onClick={() => setTab('reader')}
            className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'reader'
                ? 'bg-white dark:bg-[#3A3D45] text-[#181A1F] dark:text-white shadow-xs'
                : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Копия и цитаты</span>
            {bookmark.highlights.length > 0 && (
              <span className="tabular-nums text-[11px] opacity-75">({bookmark.highlights.length})</span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleFavorite}
            title={bookmark.is_favorite ? 'Убрать из избранного' : 'В избранное'}
            className={`w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#F3F4F6] dark:hover:bg-[#2B2D32] transition-colors ${
              bookmark.is_favorite ? 'text-[#D97706]' : 'text-[#5F6672] dark:text-[#A1A7B3]'
            }`}
          >
            <Star className="w-4 h-4" fill={bookmark.is_favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть панель"
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#2B2D32]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {tab === 'edit' ? (
          <>
            {/* Cover Preview */}
            <div className="space-y-2">
              <div className="relative aspect-[16/9] rounded-lg overflow-hidden border border-[#E6E8EC] dark:border-[#32353B]">
                <BookmarkCover
                  cover={cover}
                  title={title}
                  domain={bookmark.domain}
                  type={type}
                  className="w-full h-full"
                />
                <button
                  type="button"
                  onClick={handleRefreshMetadata}
                  disabled={refreshing}
                  title="Обновить обложку (или сделать скриншот через браузер), описание и копию текста со страницы"
                  className="absolute bottom-2 right-2 h-7 px-2.5 rounded-md bg-white/95 dark:bg-[#202124]/95 border border-[#D4DCE6] dark:border-[#383B42] text-[11.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-1.5 hover:border-[#0B72E7] transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>{refreshing ? 'Обновление...' : 'Обновить метаданные'}</span>
                </button>
              </div>

              {/* On-demand AI enrichment action bar (hidden when AI is not configured) */}
              {aiConfigured && (
                <>
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B]">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#0B72E7] dark:text-[#58A6FF] shrink-0" />
                        <span className="truncate">ИИ по запросу</span>
                      </div>
                      <div className="text-[11px] text-[#7A828F] truncate">
                        Поля или краткая выжимка
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={Boolean(aiBusy)}
                        onClick={() => handleGenerateSummary(true)}
                        title="Создать краткую выжимку (TL;DR) по содержимому страницы"
                        className="h-7 px-2 rounded-md border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[11.5px] font-medium text-[#5F6672] dark:text-[#C4C9D4] hover:text-[#181A1F] dark:hover:text-white inline-flex items-center gap-1 disabled:opacity-50 whitespace-nowrap"
                      >
                        {aiBusy === 'summary' && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>Выжимка</span>
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(aiBusy)}
                        onClick={() => runAiSuggest('all')}
                        title="Заполнить описание, коллекцию и 2–3 тега"
                        className="h-7 px-2.5 rounded-md border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[11.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5] inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                      >
                        {aiBusy === 'all' && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>{aiBusy === 'all' ? 'Анализ...' : 'Заполнить'}</span>
                      </button>
                    </div>
                  </div>

                  {aiNote && (
                    <div className="text-[11.5px] text-[#0B72E7] dark:text-[#58A6FF] px-1 leading-snug">
                      {aiNote}
                    </div>
                  )}
                </>
              )}

              {/* Compact 1-click Offline PDF status bar */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B]">
                <div className="flex items-center gap-2 min-w-0">
                  {bookmark.snapshot_size > 0 ? (
                    <FileCheck2 className="w-4 h-4 text-[#0B72E7] dark:text-[#58A6FF] shrink-0" />
                  ) : (
                    <FileDown className="w-4 h-4 text-[#7A828F] shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-[#181A1F] dark:text-[#F1F3F5] truncate">
                      {bookmark.snapshot_size > 0 ? 'Офлайн PDF сохранён' : 'Офлайн-снимок PDF'}
                    </div>
                    {bookmark.snapshot_size > 0 && (
                      <div className="text-[11px] text-[#7A828F] tabular-nums">
                        {formatBytes(bookmark.snapshot_size)}
                        {bookmark.snapshot_created_at
                          ? ` · ${formatShortDate(bookmark.snapshot_created_at)}`
                          : ''}
                      </div>
                    )}
                  </div>
                </div>

                {bookmark.snapshot_size > 0 ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenPdf(bookmark)}
                      className="h-7 px-2.5 rounded-md bg-[#0B72E7] hover:bg-[#0960C5] text-white text-[11.5px] font-medium whitespace-nowrap"
                    >
                      Читать PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => api.downloadPdfSnapshot(bookmark.id, bookmark.title).catch(() => {})}
                      title="Скачать PDF"
                      aria-label="Скачать PDF"
                      className="w-7 h-7 rounded-md border border-[#E2E5EB] dark:border-[#383B42] flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={savingPdf}
                    onClick={() => onSaveOfflinePdf(bookmark)}
                    className="h-7 px-2.5 rounded-md border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[11.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5] inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {savingPdf && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{savingPdf ? 'Сохранение...' : 'Сохранить PDF'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Title */}
            <div>
              <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                Название
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-[13.5px] font-medium bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none"
              />
            </div>

            {/* Excerpt */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                  Описание
                </label>
                {aiConfigured && (
                  <button
                    type="button"
                    onClick={() => runAiSuggest('excerpt')}
                    disabled={Boolean(aiBusy)}
                    className="text-[11.5px] text-[#0B72E7] dark:text-[#58A6FF] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {aiBusy === 'excerpt' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    <span>Составить</span>
                  </button>
                )}
              </div>
              <textarea
                rows={3}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Краткое описание страницы..."
                className="w-full px-3 py-2 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none resize-none leading-relaxed"
              />
            </div>

            {/* Personal Note */}
            <div>
              <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                Личная заметка
              </label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ваши комментарии, команды или выводы..."
                className="w-full px-3 py-2 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none resize-none leading-relaxed"
              />
            </div>

            {/* Collection & Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                    Коллекция
                  </label>
                  {aiConfigured && (
                    <button
                      type="button"
                      onClick={() => runAiSuggest('collection')}
                      disabled={Boolean(aiBusy)}
                      title="Подобрать коллекцию с помощью ИИ"
                      className="text-[11px] text-[#0B72E7] dark:text-[#58A6FF] hover:underline inline-flex items-center gap-0.5 disabled:opacity-50"
                    >
                      {aiBusy === 'collection' ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-2.5 h-2.5" />
                      )}
                      <span>ИИ</span>
                    </button>
                  )}
                </div>
                <select
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:outline-none"
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
                  Тип
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as BookmarkType)}
                  className="w-full h-9 px-2.5 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:outline-none"
                >
                  <option value="link">Ссылка</option>
                  <option value="article">Статья</option>
                  <option value="video">Видео</option>
                  <option value="image">Изображение</option>
                  <option value="document">Документ</option>
                </select>
              </div>
            </div>

            {/* Tags Editor */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                  Теги
                </label>
                {aiConfigured && (
                  <button
                    type="button"
                    onClick={() => runAiSuggest('tags')}
                    disabled={Boolean(aiBusy)}
                    className="text-[11.5px] font-medium text-[#0B72E7] dark:text-[#58A6FF] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {aiBusy === 'tags' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    <span>{aiBusy === 'tags' ? 'Подбор...' : 'Получить теги'}</span>
                  </button>
                )}
              </div>
              <div className="p-2 rounded-lg bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus-within:border-[#0B72E7]">
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-[#32353B] border border-[#E2E5EB] dark:border-[#424650] text-[12px] text-[#2C313A] dark:text-[#E5E7EB]"
                      >
                        <span>#{t}</span>
                        <button
                          type="button"
                          onClick={() => setTags((prev) => prev.filter((item) => item !== t))}
                          aria-label={`Удалить тег ${t}`}
                          className="text-[#8B929E] hover:text-red-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTagValue(tagInput);
                    }
                  }}
                  placeholder="Введите тег и нажмите Enter..."
                  className="w-full text-[13px] bg-transparent focus:outline-none placeholder:text-[#8B929E]"
                />
              </div>
              {tagSuggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5 text-[11.5px] text-[#8B929E]">
                  <span>Частые:</span>
                  {tagSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addTagValue(s)}
                      className="hover:text-[#0B72E7] dark:hover:text-[#58A6FF] transition-colors"
                    >
                      +{s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* URL */}
            <div>
              <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                Адрес URL
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg text-[12.5px] font-mono bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(url).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }}
                  title="Копировать URL"
                  className="w-9 h-9 rounded-lg border border-[#E6E8EC] dark:border-[#32353B] flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white shrink-0"
                >
                  {copied ? <Check className="w-4 h-4 text-[#16A34A]" /> : <Copy className="w-4 h-4" />}
                </button>
                {isSafeExternalHref(url) && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Открыть в новой вкладке"
                    className="w-9 h-9 rounded-lg border border-[#E6E8EC] dark:border-[#32353B] flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7] shrink-0"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Cover URL */}
            <div>
              <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                URL обложки
              </label>
              <input
                type="text"
                value={cover}
                onChange={(e) => setCover(e.target.value)}
                placeholder="https://... или /covers/..."
                className="w-full h-9 px-3 rounded-lg text-[12.5px] font-mono bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:outline-none"
              />
            </div>

            <div className="text-[11.5px] text-[#8B929E] tabular-nums pt-1">
              Добавлено {formatShortDate(bookmark.created_at)} · Обновлено {formatShortDate(bookmark.updated_at)}
            </div>
          </>
        ) : (
          /* READER SNAPSHOT & HIGHLIGHTS TAB */
          <div className="space-y-5">
            {/* Offline Local PDF Snapshot Card */}
            <section className="p-3.5 rounded-lg bg-[#F6F7F9] dark:bg-[#25272C] border border-[#E6E8EC] dark:border-[#32353B] space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[13px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-1.5">
                    {bookmark.snapshot_size > 0 ? (
                      <FileCheck2 className="w-4 h-4 text-[#0B72E7] dark:text-[#58A6FF]" />
                    ) : (
                      <FileDown className="w-4 h-4 text-[#5F6672] dark:text-[#A1A7B3]" />
                    )}
                    <span>Локальный PDF-снимок</span>
                  </h3>
                  <p className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3] mt-0.5 leading-relaxed">
                    {bookmark.snapshot_size > 0
                      ? `Сохранён на сервере (${formatBytes(bookmark.snapshot_size)}${
                          bookmark.snapshot_created_at
                            ? ` · ${formatShortDate(bookmark.snapshot_created_at)}`
                            : ''
                        }). Доступен без интернета.`
                      : 'Сохраняет структурированную копию статьи, заметки и выделения в локальный PDF-файл в томе /data/snapshots/.'}
                  </p>
                </div>
              </div>

              {bookmark.snapshot_size > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onOpenPdf(bookmark)}
                    className="h-8 px-3 rounded-md bg-[#0B72E7] hover:bg-[#0960C5] text-white text-[12px] font-medium inline-flex items-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Открыть PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => api.downloadPdfSnapshot(bookmark.id, bookmark.title).catch(() => {})}
                    className="h-8 px-2.5 rounded-md bg-white dark:bg-[#2E3138] border border-[#D4DCE6] dark:border-[#3F434D] text-[12px] font-medium text-[#2C313A] dark:text-[#E5E7EB] inline-flex items-center gap-1.5 hover:border-[#0B72E7]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingPdf}
                    onClick={() => onSaveOfflinePdf(bookmark)}
                    title="Пересоздать PDF со свежими данными"
                    className="h-8 px-2.5 rounded-md bg-white dark:bg-[#2E3138] border border-[#D4DCE6] dark:border-[#3F434D] text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${savingPdf ? 'animate-spin' : ''}`} />
                    <span>Обновить</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingPdf}
                    onClick={() => onDeleteOfflinePdf(bookmark)}
                    title="Удалить локальный PDF-файл"
                    className="h-8 px-2 rounded-md text-[12px] text-[#8B929E] hover:text-red-600 hover:bg-red-500/10 inline-flex items-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={savingPdf}
                  onClick={() => onSaveOfflinePdf(bookmark)}
                  className="h-8 px-3.5 rounded-md bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-60 text-white text-[12px] font-medium inline-flex items-center gap-1.5"
                >
                  {savingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  <span>{savingPdf ? 'Создание PDF...' : 'Сохранить PDF оффлайн'}</span>
                </button>
              )}
            </section>

            {/* On-demand AI TL;DR Summary Section (shown when AI is configured or summary already saved) */}
            {(aiConfigured || savedSummary) && (
              <section className="p-3.5 rounded-lg bg-[#F6F7F9] dark:bg-[#25272C] border border-[#E6E8EC] dark:border-[#32353B] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#0B72E7] dark:text-[#58A6FF] shrink-0" />
                    <span>Краткая выжимка (TL;DR)</span>
                  </h3>
                  {savedSummary && aiConfigured && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={Boolean(aiBusy)}
                        onClick={() => handleGenerateSummary(false)}
                        title="Обновить выжимку"
                        className="h-6 px-2 rounded text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${aiBusy === 'summary' ? 'animate-spin' : ''}`} />
                        <span>Обновить</span>
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(aiBusy)}
                        onClick={handleDeleteSummary}
                        title="Удалить выжимку"
                        aria-label="Удалить выжимку"
                        className="w-6 h-6 rounded flex items-center justify-center text-[#8B929E] hover:text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {savedSummary ? (
                  <div className="space-y-2.5">
                    {savedSummary.tldr && (
                      <p className="text-[13px] leading-relaxed text-[#181A1F] dark:text-[#F1F3F5]">
                        {savedSummary.tldr}
                      </p>
                    )}

                    {savedSummary.bullets.length > 0 && (
                      <ul className="space-y-1.5 pl-4 list-disc text-[12.5px] leading-relaxed text-[#2C313A] dark:text-[#D3D7DF]">
                        {savedSummary.bullets.map((point, idx) => (
                          <li key={idx}>{point}</li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={handleCopySummary}
                        className="h-7 px-2.5 rounded-md bg-white dark:bg-[#2E3138] border border-[#D4DCE6] dark:border-[#3F434D] text-[11.5px] font-medium text-[#2C313A] dark:text-[#E5E7EB] hover:border-[#0B72E7] inline-flex items-center gap-1.5"
                      >
                        {summaryCopied ? (
                          <Check className="w-3 h-3 text-[#16A34A]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{summaryCopied ? 'Скопировано' : 'Копировать'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleSaveSummaryToNote}
                        className="h-7 px-2.5 rounded-md bg-white dark:bg-[#2E3138] border border-[#D4DCE6] dark:border-[#3F434D] text-[11.5px] font-medium text-[#2C313A] dark:text-[#E5E7EB] hover:border-[#0B72E7] inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {summarySavedToNote ? (
                          <Check className="w-3 h-3 text-[#16A34A]" />
                        ) : (
                          <FileText className="w-3 h-3" />
                        )}
                        <span>{summarySavedToNote ? 'Добавлено в заметку' : 'В заметку'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                      ИИ прочитает сохранённый текст статьи (или загрузит страницу) и соберёт 3–5 главных тезисов.
                    </p>
                    <button
                      type="button"
                      disabled={Boolean(aiBusy)}
                      onClick={() => handleGenerateSummary(false)}
                      className="h-8 px-3.5 rounded-md bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-60 text-white text-[12px] font-medium inline-flex items-center gap-1.5"
                    >
                      {aiBusy === 'summary' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{aiBusy === 'summary' ? 'Составление выжимки...' : 'Сделать выжимку'}</span>
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* Highlights Composer */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-1.5">
                  <Highlighter className="w-4 h-4 text-[#D97706]" />
                  <span>Выделения и цитаты</span>
                </h3>
                <span className="text-[11.5px] tabular-nums text-[#8B929E]">
                  {bookmark.highlights.length}
                </span>
              </div>

              <form onSubmit={handleAddHighlight} className="space-y-2">
                <textarea
                  rows={2}
                  value={hlText}
                  onChange={(e) => setHlText(e.target.value)}
                  placeholder="Сохранить важную цитату со страницы..."
                  className="w-full px-3 py-2 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:outline-none resize-none"
                />
                <input
                  type="text"
                  value={hlNote}
                  onChange={(e) => setHlNote(e.target.value)}
                  placeholder="Комментарий к выделению (необязательно)"
                  className="w-full h-8 px-3 rounded-lg text-[12.5px] bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] focus:border-[#0B72E7] focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {(Object.keys(HIGHLIGHT_STYLES) as HighlightColor[]).map((colorKey) => (
                      <button
                        key={colorKey}
                        type="button"
                        title={HIGHLIGHT_STYLES[colorKey].label}
                        onClick={() => setHlColor(colorKey)}
                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-transform ${
                          hlColor === colorKey ? 'ring-2 ring-offset-2 ring-[#0B72E7] dark:ring-offset-[#1E1F23] scale-105' : ''
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-full ${HIGHLIGHT_STYLES[colorKey].dot}`} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={addingHl || !hlText.trim()}
                    className="h-8 px-3 rounded-md bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-50 text-white text-[12px] font-medium inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>
              </form>

              {bookmark.highlights.length > 0 && (
                <div className="space-y-2 pt-1">
                  {bookmark.highlights.map((hl) => {
                    const style = HIGHLIGHT_STYLES[hl.color] || HIGHLIGHT_STYLES.yellow;
                    return (
                      <div
                        key={hl.id}
                        className={`p-3 rounded-lg border text-[13px] space-y-1.5 ${style.bg}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[#181A1F] dark:text-[#F1F3F5] leading-relaxed">{hl.text}</p>
                          <button
                            type="button"
                            onClick={() => handleDeleteHighlight(hl.id)}
                            aria-label="Удалить выделение"
                            className="text-[#8B929E] hover:text-red-600 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {hl.note && (
                          <p className="text-[12px] text-[#5F6672] dark:text-[#CBD5E1]">{hl.note}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Offline Reader Snapshot */}
            <section className="pt-3 border-t border-[#ECEEF2] dark:border-[#2B2D32] space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                  Постоянная офлайн-копия
                </h3>
                <button
                  type="button"
                  onClick={handleRefreshMetadata}
                  disabled={refreshing}
                  className="text-[12px] text-[#0B72E7] dark:text-[#58A6FF] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>{readerContent ? 'Обновить' : 'Скачать текст'}</span>
                </button>
              </div>

              {readerContent ? (
                <div className="space-y-3 text-[13.5px] leading-[1.65] text-[#2C313A] dark:text-[#D3D7DF] bg-[#F8F9FB] dark:bg-[#25272C] border border-[#E6E8EC] dark:border-[#32353B] rounded-lg p-3.5">
                  {readerContent.split('\n\n').map((para, idx) => (
                    <p key={idx}>{para}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-[#8B929E] leading-relaxed">
                  Текстовая копия ещё не сохранена. Нажмите «Скачать текст», чтобы сохранить содержимое страницы локально в SQLite на вашем сервере.
                </p>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-[#E6E8EC] dark:border-[#2B2D32] flex items-center justify-between gap-2 shrink-0">
        {bookmark.is_trashed ? (
          <>
            <button
              type="button"
              onClick={() => onDeletePermanent(bookmark)}
              className="h-9 px-3 rounded-lg text-[12.5px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>Удалить навсегда</span>
            </button>
            <button
              type="button"
              onClick={() => onRestore(bookmark)}
              className="h-9 px-4 rounded-lg bg-[#16A34A] hover:bg-[#15803D] text-white text-[13px] font-medium inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Восстановить</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onTrash(bookmark)}
              className="h-9 px-3 rounded-lg text-[12.5px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1.5 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>В корзину</span>
            </button>

            {tab === 'edit' && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="h-9 px-4 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-60 text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                {savedFeedback ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Сохранено</span>
                  </>
                ) : (
                  <span>{saving ? 'Сохранение...' : 'Сохранить'}</span>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
