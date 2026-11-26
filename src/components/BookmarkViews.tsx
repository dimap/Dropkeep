import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Check,
  CheckSquare,
  Copy,
  ExternalLink,
  FileCheck2,
  FileDown,
  FolderInput,
  Highlighter,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Star,
  StickyNote,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type {
  Bookmark,
  BookmarkClickAction,
  CardButtonId,
  Collection,
  DisplayFields,
  FallbackCoverStyle,
  NavScope,
  TodoItem,
  ViewMode,
} from '../types';
import { formatShortDate, getBookmarkTypeMeta, isSafeExternalHref } from '../utils/icons';
import {
  formatTodoItemsForAi,
  getCardColorOption,
  getTodoSummary,
  TODO_PRIORITY_META,
} from '../utils/notes';
import { BookmarkCover } from './BookmarkCover';

const INITIAL_VISIBLE_COUNT = 60;
const VISIBLE_BATCH_STEP = 60;

const GRID_COL_CLASSES: Record<number, string> = {
  0: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  1: 'grid-cols-1 max-w-[740px]',
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
};

function getMasonryColumnCount(columnCount: number, containerWidth: number): number {
  if (columnCount === 1) return 1;
  if (columnCount === 2) return 2;
  if (columnCount === 3) return containerWidth < 560 ? 2 : 3;
  if (columnCount === 4) {
    if (containerWidth < 560) return 2;
    if (containerWidth < 820) return 3;
    return 4;
  }
  if (columnCount === 5) {
    if (containerWidth < 560) return 2;
    if (containerWidth < 820) return 3;
    if (containerWidth < 1080) return 4;
    return 5;
  }
  if (columnCount === 6) {
    if (containerWidth < 560) return 2;
    if (containerWidth < 820) return 3;
    if (containerWidth < 1080) return 5;
    return 6;
  }
  // Auto (0): adapts cleanly to actual workspace width
  if (containerWidth < 520) return 1;
  if (containerWidth < 820) return 2;
  if (containerWidth < 1120) return 3;
  return 4;
}

export interface BulkRefreshProgress {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
}

interface BookmarkViewsProps {
  bookmarks: Bookmark[];
  collections: Collection[];
  viewMode: ViewMode;
  displayFields: DisplayFields;
  columnCount: number;
  fallbackCoverStyle: FallbackCoverStyle;
  clickAction: BookmarkClickAction;
  cardButtons: CardButtonId[];
  showTypeBadge: boolean;
  scope: NavScope;
  loading: boolean;
  activeBookmarkId: string | null;
  selectedIds: string[];
  savingPdfId: string | null;
  refreshingIds: string[];
  bulkRefreshProgress: BulkRefreshProgress | null;
  onSelectBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onToggleSelectId: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onUpdateTodoItems: (bookmark: Bookmark, items: TodoItem[]) => void;
  onOpenPdf: (bookmark: Bookmark) => void;
  onSaveOfflinePdf: (bookmark: Bookmark) => void;
  onTrashBookmark: (bookmark: Bookmark) => void;
  onRestoreBookmark: (bookmark: Bookmark) => void;
  onDeletePermanent: (bookmark: Bookmark) => void;
  onEmptyTrash: () => void;
  onBulkAction: (
    action: 'move' | 'add_tag' | 'favorite' | 'trash' | 'restore' | 'delete',
    extra?: { collection_id?: string | null; tag?: string }
  ) => void;
  onBulkRefresh: () => void;
  onCancelBulkRefresh: () => void;
  onClickTag: (tag: string) => void;
  onOpenAddModal: () => void;
}

interface BookmarkItemProps {
  bm: Bookmark;
  viewMode: ViewMode;
  displayFields: DisplayFields;
  fallbackCoverStyle: FallbackCoverStyle;
  clickAction: BookmarkClickAction;
  cardButtons: CardButtonId[];
  showTypeBadge: boolean;
  collectionTitle: string | null;
  isTrash: boolean;
  isSelected: boolean;
  isActive: boolean;
  isCopied: boolean;
  isSavingPdf: boolean;
  isRefreshing: boolean;
  hasSelection: boolean;
  onSelectBookmark: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onToggleSelectId: (id: string) => void;
  onCopyLink: (bookmark: Bookmark) => void;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onUpdateTodoItems: (bookmark: Bookmark, items: TodoItem[]) => void;
  onOpenPdf: (bookmark: Bookmark) => void;
  onSaveOfflinePdf: (bookmark: Bookmark) => void;
  onTrashBookmark: (bookmark: Bookmark) => void;
  onRestoreBookmark: (bookmark: Bookmark) => void;
  onDeletePermanent: (bookmark: Bookmark) => void;
  onClickTag: (tag: string) => void;
}

function handleDragStart(e: DragEvent, bmId: string) {
  e.dataTransfer.setData('text/dropkeep-bookmark', bmId);
  e.dataTransfer.effectAllowed = 'move';
}

const BookmarkItem = memo(function BookmarkItem({
  bm,
  viewMode,
  displayFields,
  fallbackCoverStyle,
  clickAction,
  cardButtons,
  showTypeBadge,
  collectionTitle,
  isTrash,
  isSelected,
  isActive,
  isCopied,
  isSavingPdf,
  isRefreshing,
  hasSelection,
  onSelectBookmark,
  onEditBookmark,
  onToggleSelectId,
  onCopyLink,
  onToggleFavorite,
  onUpdateTodoItems,
  onOpenPdf,
  onSaveOfflinePdf,
  onTrashBookmark,
  onRestoreBookmark,
  onDeletePermanent,
  onClickTag,
}: BookmarkItemProps) {
  const isNote = bm.type === 'note';
  const isTodo = bm.type === 'todo';
  const isLocalItem = isNote || isTodo;
  const hasNoteImage = isNote && Boolean(bm.cover);
  const safeHref = !isLocalItem && isSafeExternalHref(bm.url);
  const canOpenDirectly = !isLocalItem && !isTrash && safeHref && clickAction !== 'inspector';
  const linkTarget = clickAction === 'same_tab' ? undefined : '_blank';
  const formattedDate = formatShortDate(bm.created_at);
  const { icon: TypeIcon, label: typeLabel } = getBookmarkTypeMeta(bm.type);
  const hasBtn = (id: CardButtonId) => cardButtons.includes(id);
  const colorOpt = getCardColorOption(bm.card_color);
  const hasCustomColor = isLocalItem && Boolean(bm.card_color);
  const todoItems = isTodo ? bm.todo_items || [] : [];
  const todoSummary = isTodo ? getTodoSummary(todoItems) : null;

  const handleToggleTodoItem = (itemId: string) => {
    if (!isTodo || isTrash) return;
    const next = todoItems.map((item) =>
      item.id === itemId ? { ...item, progress: item.progress >= 100 ? 0 : 100 } : item
    );
    onUpdateTodoItems(bm, next);
  };

  const renderFavicon = () => {
    if (isNote) {
      return (
        <span className="w-4 h-4 rounded-xs bg-[#FEF3C7] dark:bg-[#3F3117] flex items-center justify-center text-[#D97706] dark:text-[#FBBF24] shrink-0">
          <StickyNote className="w-3 h-3" strokeWidth={2.1} />
        </span>
      );
    }
    if (isTodo) {
      return (
        <span className="w-4 h-4 rounded-xs bg-[#DCFCE7] dark:bg-[#193A27] flex items-center justify-center text-[#16A34A] dark:text-[#4ADE80] shrink-0">
          <ListChecks className="w-3 h-3" strokeWidth={2.1} />
        </span>
      );
    }
    return (
      <span className="w-4 h-4 rounded-xs bg-[#F1F3F6] dark:bg-[#2F3239] flex items-center justify-center text-[10px] font-semibold uppercase text-[#5F6672] dark:text-[#A1A7B3] shrink-0 overflow-hidden">
        {bm.favicon && isSafeExternalHref(bm.favicon) ? (
          <img
            src={bm.favicon}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-4 h-4 object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          (bm.domain || '?').charAt(0)
        )}
      </span>
    );
  };

  const renderQuickActions = (compact = false) => {
    const showEdit = hasBtn('edit');
    const showOpen = !isLocalItem && hasBtn('open') && safeHref;
    const showCopy = hasBtn('copy');
    const showPdf = !isLocalItem && !isTrash && hasBtn('pdf');
    const showFav = !isTrash && hasBtn('favorite');
    const showTrash = !isTrash && hasBtn('trash');

    if (!isTrash && !showEdit && !showOpen && !showCopy && !showPdf && !showFav && !showTrash) {
      return null;
    }

    const btnSize = compact ? 'w-6 h-6' : 'w-7 h-7';
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-0.5 pointer-events-auto bg-white/95 dark:bg-[#202124]/95 backdrop-blur-xs border border-[#DCE1E8] dark:border-[#383B42] rounded-md p-0.5 shadow-md"
      >
        {showEdit && (
          <button
            type="button"
            onClick={() => onEditBookmark(bm)}
            title="Редактировать"
            aria-label="Редактировать"
            className={`${btnSize} rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#EBEDF0] dark:hover:bg-[#32353B] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] transition-colors`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        {showOpen && (
          <a
            href={bm.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Открыть сайт"
            aria-label="Открыть сайт"
            className={`${btnSize} rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#EBEDF0] dark:hover:bg-[#32353B] hover:text-[#181A1F] dark:hover:text-white transition-colors`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}

        {showCopy && (
          <button
            type="button"
            onClick={() => onCopyLink(bm)}
            title={isLocalItem ? 'Копировать текст' : 'Копировать ссылку'}
            aria-label={isLocalItem ? 'Копировать текст' : 'Копировать ссылку'}
            className={`${btnSize} rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#EBEDF0] dark:hover:bg-[#32353B] hover:text-[#181A1F] dark:hover:text-white transition-colors`}
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-[#16A34A]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        {showPdf && (
          <button
            type="button"
            disabled={isSavingPdf}
            onClick={() => (bm.snapshot_size > 0 ? onOpenPdf(bm) : onSaveOfflinePdf(bm))}
            title={bm.snapshot_size > 0 ? 'Открыть офлайн PDF' : 'Сохранить PDF оффлайн'}
            aria-label={bm.snapshot_size > 0 ? 'Открыть офлайн PDF' : 'Сохранить PDF оффлайн'}
            className={`${btnSize} rounded flex items-center justify-center hover:bg-[#EBEDF0] dark:hover:bg-[#32353B] transition-colors disabled:opacity-60 ${
              bm.snapshot_size > 0
                ? 'text-[#0B72E7] dark:text-[#58A6FF]'
                : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7]'
            }`}
          >
            {isSavingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : bm.snapshot_size > 0 ? (
              <FileCheck2 className="w-3.5 h-3.5" />
            ) : (
              <FileDown className="w-3.5 h-3.5" />
            )}
          </button>
        )}

        {showFav && (
          <button
            type="button"
            onClick={() => onToggleFavorite(bm)}
            title={bm.is_favorite ? 'Убрать из избранного' : 'В избранное'}
            aria-label={bm.is_favorite ? 'Убрать из избранного' : 'В избранное'}
            className={`${btnSize} rounded flex items-center justify-center hover:bg-[#EBEDF0] dark:hover:bg-[#32353B] transition-colors ${
              bm.is_favorite
                ? 'text-[#D97706]'
                : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#D97706]'
            }`}
          >
            <Star className="w-3.5 h-3.5" fill={bm.is_favorite ? 'currentColor' : 'none'} />
          </button>
        )}

        {isTrash ? (
          <>
            <button
              type="button"
              onClick={() => onRestoreBookmark(bm)}
              title="Восстановить"
              aria-label="Восстановить"
              className={`${btnSize} rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#EBEDF0] dark:hover:bg-[#32353B] hover:text-[#16A34A] transition-colors`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeletePermanent(bm)}
              title="Удалить навсегда"
              aria-label="Удалить навсегда"
              className={`${btnSize} rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-red-500/15 hover:text-red-600 transition-colors`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          showTrash && (
            <button
              type="button"
              onClick={() => onTrashBookmark(bm)}
              title="В корзину"
              aria-label="Переместить в корзину"
              className={`${btnSize} rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-red-500/15 hover:text-red-600 transition-colors`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )
        )}
      </div>
    );
  };

  // Top corners of card/masonry preview: top-left checkbox, top-right favorite marker
  const renderCardTopCorners = () => (
    <div className="absolute top-2 inset-x-2 z-20 flex items-center justify-between gap-2 pointer-events-none">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelectId(bm.id);
        }}
        aria-label="Выбрать закладку"
        className={`shrink-0 pointer-events-auto w-6 h-6 rounded items-center justify-center border shadow-xs transition-all ${
          isSelected
            ? 'flex bg-[#0B72E7] border-[#0B72E7] text-white opacity-100'
            : hasSelection
              ? 'flex bg-white/92 dark:bg-[#202124]/92 border-[#D4DCE6] dark:border-[#383B42] text-[#5F6672] dark:text-[#A1A7B3] opacity-100 hover:border-[#0B72E7]'
              : 'hidden sm:flex bg-white/92 dark:bg-[#202124]/92 border-[#D4DCE6] dark:border-[#383B42] text-[#5F6672] dark:text-[#A1A7B3] opacity-0 group-hover:opacity-100 hover:border-[#0B72E7]'
        }`}
      >
        {isSelected ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : <Square className="w-3.5 h-3.5" />}
      </button>

      {!isTrash && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(bm);
          }}
          title={bm.is_favorite ? 'Убрать из избранного' : 'В избранное'}
          aria-label={bm.is_favorite ? 'Убрать из избранного' : 'В избранное'}
          className={`shrink-0 pointer-events-auto w-6 h-6 rounded-md flex items-center justify-center border shadow-xs transition-all ${
            bm.is_favorite
              ? 'bg-white/94 dark:bg-[#1E2024]/92 border-[#F59E0B]/40 text-[#F59E0B] opacity-100'
              : 'bg-white/90 dark:bg-[#1E2024]/90 border-[#D4DCE6]/90 dark:border-[#383B42] text-[#6B7280] dark:text-[#A1A7B3] hover:text-[#F59E0B] opacity-0 group-hover:opacity-100'
          }`}
        >
          <Star className="w-3.5 h-3.5" fill={bm.is_favorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );

  // Bottom-left bookmark type badge (compact thumbnail in list view)
  const renderPreviewTypeBadge = (compact = false) => {
    if (!showTypeBadge) return null;
    if (compact) {
      return (
        <span
          title={typeLabel}
          className="absolute bottom-1 left-1 z-10 pointer-events-none inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] bg-[#111318]/72 text-white/95 backdrop-blur-[3px] ring-1 ring-white/10"
        >
          <TypeIcon className="w-2.5 h-2.5" strokeWidth={2.1} />
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded-[5px] bg-[#111318]/72 text-white/95 backdrop-blur-[4px] text-[10.5px] font-medium leading-none tracking-[0.01em] shadow-xs ring-1 ring-white/12 max-w-full min-w-0">
        <TypeIcon className="w-3 h-3 shrink-0 opacity-90" strokeWidth={2} />
        <span className="truncate">{typeLabel}</span>
      </span>
    );
  };

  // Bottom bar inside cover preview: bottom-left type badge + bottom-right floating quick actions
  const renderPreviewBottomOverlay = () => (
    <div className="absolute bottom-2 inset-x-2 z-20 flex items-end justify-between gap-1.5 pointer-events-none">
      <div className="min-w-0 flex items-end">{renderPreviewTypeBadge(false)}</div>

      <div className="shrink-0 flex items-center justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditBookmark(bm);
          }}
          title="Редактировать"
          aria-label="Редактировать"
          className="sm:hidden pointer-events-auto w-7 h-7 rounded-md bg-white/95 dark:bg-[#202124]/95 border border-[#DCE1E8] dark:border-[#34373E] shadow-xs flex items-center justify-center text-[#4B5563] dark:text-[#D3D7DF]"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>

        <div className="hidden sm:group-hover:flex">{renderQuickActions(true)}</div>
      </div>
    </div>
  );

  // Fallback floating actions when cover preview is hidden
  const renderNoCoverFloatingActions = () => (
    <div className="absolute bottom-2 right-2 z-20 flex items-center justify-end pointer-events-none">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEditBookmark(bm);
        }}
        title="Редактировать"
        aria-label="Редактировать"
        className="sm:hidden pointer-events-auto w-7 h-7 rounded-md bg-white/95 dark:bg-[#202124]/95 border border-[#DCE1E8] dark:border-[#34373E] shadow-xs flex items-center justify-center text-[#4B5563] dark:text-[#D3D7DF]"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>

      <div className="hidden sm:group-hover:flex">{renderQuickActions(true)}</div>
    </div>
  );

  const renderTodoListPreview = (maxItems: number) => {
    if (!isTodo) return null;
    if (todoItems.length === 0) {
      return (
        <p className="text-[12px] italic text-[#7A828F] dark:text-[#8E96A4]">
          Список задач пока пуст — откройте, чтобы добавить пункты
        </p>
      );
    }

    const visibleItems = todoItems.slice(0, maxItems);
    const hiddenCount = todoItems.length - visibleItems.length;

    return (
      <div className="space-y-2 pt-0.5">
        {/* Overall progress bar */}
        {todoSummary && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
              <span className="tabular-nums">
                {todoSummary.completed} / {todoSummary.total} выполнено
              </span>
              <span className="tabular-nums font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                {todoSummary.avgProgress}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-black/8 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  todoSummary.avgProgress >= 100
                    ? 'bg-[#16A34A]'
                    : 'bg-[#0B72E7] dark:bg-[#58A6FF]'
                }`}
                style={{ width: `${todoSummary.avgProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Interactive task items */}
        <ul className="space-y-1.5">
          {visibleItems.map((item) => {
            const done = item.progress >= 100;
            const partial = item.progress > 0 && item.progress < 100;
            const prio = TODO_PRIORITY_META[item.priority] || TODO_PRIORITY_META.medium;
            return (
              <li key={item.id} className="space-y-0.5">
                <div className="flex items-start gap-2 text-[12.5px] leading-snug">
                  <button
                    type="button"
                    disabled={isTrash}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleTodoItem(item.id);
                    }}
                    title={done ? 'Снять отметку выполнения' : 'Отметить выполненной (100%)'}
                    aria-label={`Переключить задачу: ${item.text}`}
                    className={`relative z-10 pointer-events-auto mt-0.5 w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      done
                        ? 'bg-[#16A34A] border-[#16A34A] text-white'
                        : partial
                          ? 'bg-white/90 dark:bg-[#1E2024]/90 border-[#0B72E7] text-[#0B72E7] dark:text-[#58A6FF]'
                          : 'bg-white/85 dark:bg-[#1E2024]/85 border-black/20 dark:border-white/25 hover:border-[#0B72E7]'
                    }`}
                  >
                    {done ? (
                      <Check className="w-3 h-3 stroke-[2.8]" />
                    ) : partial ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    ) : null}
                  </button>

                  <span
                    className={`flex-1 min-w-0 break-words ${
                      done
                        ? 'line-through text-[#7A828F] dark:text-[#8E96A4]'
                        : 'text-[#1F242D] dark:text-[#E5E7EB]'
                    }`}
                  >
                    {item.text}
                  </span>

                  <span className="shrink-0 inline-flex items-center gap-1 mt-0.5">
                    {partial && (
                      <span className="text-[10.5px] font-semibold tabular-nums text-[#0B72E7] dark:text-[#60A5FA]">
                        {item.progress}%
                      </span>
                    )}
                    <span
                      title={`Приоритет: ${prio.label}`}
                      className={`inline-flex items-center gap-1 ${
                        item.priority === 'urgent' || item.priority === 'high'
                          ? `px-1.5 py-[1px] rounded text-[10px] font-medium border ${prio.badgeClass}`
                          : 'w-2 h-2 rounded-full ' + prio.dotClass
                      }`}
                    >
                      {(item.priority === 'urgent' || item.priority === 'high') && prio.shortLabel}
                    </span>
                  </span>
                </div>

                {partial && (
                  <div className="pl-6">
                    <div className="h-[3px] w-full rounded-full bg-black/8 dark:bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${prio.barClass}`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {hiddenCount > 0 && (
          <div className="pl-6 text-[11px] font-medium text-[#7A828F] dark:text-[#8E96A4]">
            + ещё {hiddenCount}
          </div>
        )}
      </div>
    );
  };

  // Fixed-height header strip inside Note & To-Do cards without a cover image (floating hover bar prevents layout shift)
  const renderLocalCardHeader = () => (
    <div className="relative z-20 h-9 px-3 flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelectId(bm.id);
          }}
          aria-label="Выбрать запись"
          className={`shrink-0 pointer-events-auto w-5 h-5 rounded items-center justify-center border transition-opacity ${
            isSelected
              ? 'flex bg-[#0B72E7] border-[#0B72E7] text-white opacity-100'
              : hasSelection
                ? 'flex bg-white/85 dark:bg-[#202124]/85 border-[#CBD5E1] dark:border-[#383B42] text-[#5F6672] dark:text-[#A1A7B3] opacity-100 hover:border-[#0B72E7]'
                : 'hidden sm:flex bg-white/80 dark:bg-[#202124]/80 border-[#CBD5E1] dark:border-[#383B42] text-[#5F6672] dark:text-[#A1A7B3] opacity-0 group-hover:opacity-100 hover:border-[#0B72E7]'
          }`}
        >
          {isSelected ? <Check className="w-3 h-3 stroke-[2.6]" /> : <Square className="w-3 h-3" />}
        </button>

        {showTypeBadge && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-black/6 dark:bg-white/10 text-[#3B4252] dark:text-[#D8DCE4] text-[10.5px] font-medium leading-none">
            <TypeIcon className="w-3 h-3 shrink-0 opacity-85" strokeWidth={2} />
            <span>{typeLabel}</span>
          </span>
        )}
      </div>

      {/* Floating desktop quick-actions bar positioned inside the fixed-height header so hovering never shifts content */}
      <div
        className={`hidden sm:flex items-center absolute top-1/2 -translate-y-1/2 z-20 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity ${
          isTrash ? 'right-2.5' : 'right-9'
        }`}
      >
        {renderQuickActions(true)}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditBookmark(bm);
          }}
          title="Редактировать"
          aria-label="Редактировать"
          className="sm:hidden pointer-events-auto w-6 h-6 rounded-md bg-white/80 dark:bg-[#202124]/80 border border-black/10 dark:border-white/10 flex items-center justify-center text-[#4B5563] dark:text-[#D3D7DF]"
        >
          <Pencil className="w-3 h-3" />
        </button>

        {!isTrash && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(bm);
            }}
            title={bm.is_favorite ? 'Убрать из избранного' : 'В избранное'}
            aria-label={bm.is_favorite ? 'Убрать из избранного' : 'В избранное'}
            className={`shrink-0 pointer-events-auto w-6 h-6 rounded-md flex items-center justify-center transition-opacity ${
              bm.is_favorite
                ? 'text-[#F59E0B] opacity-100'
                : 'text-[#6B7280] dark:text-[#A1A7B3] hover:text-[#F59E0B] opacity-0 group-hover:opacity-100'
            }`}
          >
            <Star className="w-3.5 h-3.5" fill={bm.is_favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
    </div>
  );

  const renderMetaLine = (showCollection = true) => {
    const showInfo = displayFields.info;
    const showHighlightCount = !isLocalItem && displayFields.highlights && bm.highlights.length > 0;
    const showTags = displayFields.tags && bm.tags.length > 0;

    if (!showInfo && !showHighlightCount && !showTags) return null;

    let hasLeading = false;
    const sep = () => {
      if (!hasLeading) {
        hasLeading = true;
        return null;
      }
      return <span aria-hidden="true">·</span>;
    };

    return (
      <div className="dk-card-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#7A828F] dark:text-[#8E96A4]">
        {showInfo && (
          <>
            {!isLocalItem && (
              <>
                {sep()}
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  {renderFavicon()}
                  <span className="truncate max-w-[160px] sm:max-w-[200px]">{bm.domain}</span>
                </span>
              </>
            )}
            {sep()}
            <span className="tabular-nums whitespace-nowrap">{formattedDate}</span>
            {showCollection && collectionTitle && (
              <>
                {sep()}
                <span className="truncate max-w-[140px]">{collectionTitle}</span>
              </>
            )}
            {!isLocalItem && bm.snapshot_size > 0 && (
              <>
                {sep()}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenPdf(bm);
                  }}
                  className="relative z-10 pointer-events-auto text-[#0B72E7] dark:text-[#58A6FF] hover:underline font-medium"
                >
                  PDF
                </button>
              </>
            )}
          </>
        )}
        {showHighlightCount && (
          <>
            {sep()}
            <span className="inline-flex items-center gap-1 text-[#B45309] dark:text-[#FBBF24]">
              <Highlighter className="w-3 h-3" />
              <span className="tabular-nums">{bm.highlights.length}</span>
            </span>
          </>
        )}
        {showTags && (
          <>
            {sep()}
            <span className="inline-flex flex-wrap items-center gap-x-2">
              {bm.tags.slice(0, 4).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClickTag(t);
                  }}
                  className="relative z-10 pointer-events-auto text-[#5F6672] dark:text-[#9CA3AF] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] transition-colors"
                >
                  #{t}
                </button>
              ))}
              {bm.tags.length > 4 && <span className="tabular-nums">+{bm.tags.length - 4}</span>}
            </span>
          </>
        )}
      </div>
    );
  };

  if (viewMode === 'list') {
    return (
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, bm.id)}
        onClick={canOpenDirectly ? undefined : () => onSelectBookmark(bm)}
        className={`relative group flex items-start gap-3 sm:gap-3.5 py-3 px-2.5 -mx-2.5 rounded-lg cursor-pointer transition-colors ${
          isActive
            ? 'bg-[#EDF4FE] dark:bg-[#192B44]/80'
            : isSelected
              ? 'bg-[#F5F9FF] dark:bg-[#1F2937]/60'
              : hasCustomColor
                ? colorOpt.listClass
                : 'hover:bg-[#F7F8FA] dark:hover:bg-[#26282C]'
        }`}
      >
        {canOpenDirectly && (
          <a
            href={bm.url}
            target={linkTarget}
            rel="noopener noreferrer"
            aria-label={`Открыть ${bm.title}`}
            className="absolute inset-0 z-0 rounded-lg"
          />
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelectId(bm.id);
          }}
          aria-label="Выбрать закладку"
          className={`relative z-10 pointer-events-auto mt-1 shrink-0 transition-opacity ${
            isSelected
              ? 'flex text-[#0B72E7] opacity-100'
              : hasSelection
                ? 'flex text-[#B0B7C3] opacity-100'
                : 'hidden sm:flex text-[#B0B7C3] opacity-0 group-hover:opacity-100'
          }`}
        >
          {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
        </button>

        {displayFields.cover && (
          <div className="relative z-10 pointer-events-none shrink-0">
            {isLocalItem && !hasNoteImage ? (
              <div
                className={`w-16 h-12 sm:w-[88px] sm:h-[60px] rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                  hasCustomColor
                    ? colorOpt.cardClass
                    : 'bg-[#F6F7F9] dark:bg-[#2A2C31] border-[#E6E8EC] dark:border-[#32353B]'
                }`}
              >
                {isNote ? (
                  <StickyNote className="w-5 h-5 text-[#D97706] dark:text-[#FBBF24]" strokeWidth={1.8} />
                ) : (
                  <>
                    <ListChecks className="w-4 h-4 text-[#16A34A] dark:text-[#4ADE80]" strokeWidth={1.9} />
                    {todoSummary && todoSummary.total > 0 && (
                      <span className="text-[10.5px] font-semibold tabular-nums text-[#2C313A] dark:text-[#E5E7EB]">
                        {todoSummary.avgProgress}%
                      </span>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                <BookmarkCover
                  cover={bm.cover}
                  title={bm.title}
                  domain={bm.domain}
                  type={bm.type}
                  fallbackStyle={fallbackCoverStyle}
                  compact
                  className="w-16 h-12 sm:w-[88px] sm:h-[60px] rounded-md border border-[#E6E8EC] dark:border-[#32353B]"
                />
                {renderPreviewTypeBadge(true)}
              </>
            )}
          </div>
        )}

        <div className="relative z-10 pointer-events-none flex-1 min-w-0 space-y-1">
          {displayFields.title && (
            <h3 className="dk-card-title text-[14px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] leading-snug line-clamp-2 sm:line-clamp-1 flex items-center gap-1.5">
              {isRefreshing && <Loader2 className="w-3.5 h-3.5 text-[#0B72E7] animate-spin shrink-0" />}
              <span className="truncate">{bm.title}</span>
              {bm.is_favorite && !isTrash && (
                <Star className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" fill="currentColor" />
              )}
            </h3>
          )}
          {displayFields.excerpt && bm.excerpt && (
            <p className="dk-card-excerpt text-[13px] text-[#5F6672] dark:text-[#A1A7B3] line-clamp-2 leading-relaxed">
              {bm.excerpt}
            </p>
          )}
          {isNote && displayFields.note && bm.note && (
            <p className="text-[12.5px] text-[#374151] dark:text-[#D1D5DB] whitespace-pre-line line-clamp-3 leading-relaxed">
              {bm.note}
            </p>
          )}
          {isTodo && renderTodoListPreview(3)}
          {!isLocalItem && displayFields.note && bm.note && (
            <p className="text-[12.5px] text-[#4B5563] dark:text-[#C4C9D4] bg-[#F4F5F7] dark:bg-[#2A2C32] rounded px-2 py-1 line-clamp-2">
              {bm.note}
            </p>
          )}
          {!isLocalItem && displayFields.highlights && bm.highlights.length > 0 && (
            <p className="text-[12px] text-[#78350F] dark:text-[#FDE68A] bg-[#FEF3C7]/60 dark:bg-[#78350F]/25 rounded px-2 py-1 line-clamp-2">
              «{bm.highlights[0].text}»
            </p>
          )}
          {renderMetaLine(true)}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditBookmark(bm);
          }}
          title="Редактировать"
          aria-label="Редактировать"
          className="sm:hidden relative z-10 pointer-events-auto shrink-0 self-start mt-0.5 w-8 h-8 rounded-md flex items-center justify-center text-[#7A828F] dark:text-[#9CA3AF] hover:bg-[#EBEDF0] dark:hover:bg-[#32353B]"
        >
          <Pencil className="w-4 h-4" />
        </button>

        <div className="hidden sm:group-hover:flex absolute right-2 top-2 z-20">
          {renderQuickActions()}
        </div>
      </div>
    );
  }

  if (viewMode === 'grid') {
    const cardSurfaceClass = isActive
      ? hasCustomColor
        ? `${colorOpt.cardClass} ring-2 ring-[#0B72E7] border-[#0B72E7]`
        : 'border-[#0B72E7] bg-[#F7FAFF] dark:bg-[#1C283A]'
      : isSelected
        ? hasCustomColor
          ? `${colorOpt.cardClass} ring-1 ring-[#0B72E7] border-[#0B72E7]/80`
          : 'border-[#0B72E7]/70 bg-white dark:bg-[#26282C]'
        : colorOpt.cardClass;

    if (isLocalItem) {
      const showNoteCoverPreview = hasNoteImage && displayFields.cover;
      return (
        <article
          draggable
          data-card-color={hasCustomColor ? 'true' : undefined}
          onDragStart={(e) => handleDragStart(e, bm.id)}
          onClick={() => onSelectBookmark(bm)}
          className={`dk-card relative group rounded-lg border transition-colors overflow-hidden flex flex-col cursor-pointer ${cardSurfaceClass}`}
        >
          {showNoteCoverPreview ? (
            <>
              <div className="relative z-10 pointer-events-none aspect-[16/10] w-full overflow-hidden border-b border-black/8 dark:border-white/10">
                <BookmarkCover
                  cover={bm.cover}
                  title={bm.title}
                  domain=""
                  type={bm.type}
                  fallbackStyle={fallbackCoverStyle}
                  className="w-full h-full"
                />
                {renderPreviewBottomOverlay()}
              </div>
              {renderCardTopCorners()}
            </>
          ) : (
            renderLocalCardHeader()
          )}

          <div
            className={`relative z-10 pointer-events-none px-3.5 pb-3.5 flex-1 flex flex-col gap-2 ${
              showNoteCoverPreview ? 'pt-3' : 'pt-1'
            }`}
          >
            {displayFields.title && (
              <h3 className="dk-card-title text-[14.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] leading-snug line-clamp-2">
                {bm.title}
              </h3>
            )}
            {isTodo && displayFields.excerpt && bm.excerpt && (
              <p className="dk-card-excerpt text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] line-clamp-2 leading-relaxed">
                {bm.excerpt}
              </p>
            )}
            {isNote && displayFields.note && bm.note && (
              <p
                className={`text-[12.5px] text-[#374151] dark:text-[#D1D5DB] whitespace-pre-line leading-relaxed ${
                  showNoteCoverPreview ? 'line-clamp-3' : 'line-clamp-6'
                }`}
              >
                {bm.note}
              </p>
            )}
            {isTodo && renderTodoListPreview(5)}
            <div className="mt-auto pt-1.5">{renderMetaLine(false)}</div>
          </div>
        </article>
      );
    }

    return (
      <article
        draggable
        onDragStart={(e) => handleDragStart(e, bm.id)}
        onClick={canOpenDirectly ? undefined : () => onSelectBookmark(bm)}
        className={`dk-card relative group rounded-lg border transition-colors overflow-hidden flex flex-col cursor-pointer ${cardSurfaceClass}`}
      >
        {canOpenDirectly && (
          <a
            href={bm.url}
            target={linkTarget}
            rel="noopener noreferrer"
            aria-label={`Открыть ${bm.title}`}
            className="absolute inset-0 z-0"
          />
        )}

        {displayFields.cover && (
          <div className="relative z-10 pointer-events-none aspect-[16/10] w-full overflow-hidden border-b border-[#ECEEF2] dark:border-[#30333A]">
            <BookmarkCover
              cover={bm.cover}
              title={bm.title}
              domain={bm.domain}
              type={bm.type}
              fallbackStyle={fallbackCoverStyle}
              className="w-full h-full"
            />
            {renderPreviewBottomOverlay()}
            {isRefreshing && (
              <div className="absolute inset-0 z-30 bg-white/65 dark:bg-[#202124]/65 backdrop-blur-[1px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-[#0B72E7] animate-spin" />
              </div>
            )}
          </div>
        )}

        {renderCardTopCorners()}

        <div
          className={`relative z-10 pointer-events-none p-3.5 flex-1 flex flex-col gap-1.5 ${
            !displayFields.cover ? 'pt-9 min-h-[42px]' : ''
          }`}
        >
          {displayFields.title && (
            <h3 className="dk-card-title text-[14px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] leading-snug line-clamp-2">
              {bm.title}
            </h3>
          )}
          {displayFields.excerpt && bm.excerpt && (
            <p className="dk-card-excerpt text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] line-clamp-2 leading-relaxed">
              {bm.excerpt}
            </p>
          )}
          {displayFields.note && bm.note && (
            <p className="text-[12px] text-[#4B5563] dark:text-[#C4C9D4] bg-[#F4F5F7] dark:bg-[#2E3138] rounded px-2 py-1 line-clamp-2">
              {bm.note}
            </p>
          )}
          {displayFields.highlights && bm.highlights.length > 0 && (
            <p className="text-[12px] text-[#78350F] dark:text-[#FDE68A] bg-[#FEF3C7]/60 dark:bg-[#78350F]/25 rounded px-2 py-1 line-clamp-2">
              «{bm.highlights[0].text}»
            </p>
          )}
          <div className="mt-auto pt-1.5">{renderMetaLine(false)}</div>
          {!displayFields.cover && renderNoCoverFloatingActions()}
        </div>
      </article>
    );
  }

  if (viewMode === 'headlines') {
    return (
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, bm.id)}
        onClick={canOpenDirectly ? undefined : () => onSelectBookmark(bm)}
        className={`relative group min-h-[40px] py-1.5 flex items-center gap-2.5 sm:gap-3 px-2.5 -mx-2.5 rounded-md cursor-pointer transition-colors ${
          isActive
            ? 'bg-[#EDF4FE] dark:bg-[#192B44]/80'
            : hasCustomColor
              ? colorOpt.listClass
              : 'hover:bg-[#F7F8FA] dark:hover:bg-[#26282C]'
        }`}
      >
        {canOpenDirectly && (
          <a
            href={bm.url}
            target={linkTarget}
            rel="noopener noreferrer"
            aria-label={`Открыть ${bm.title}`}
            className="absolute inset-0 z-0 rounded-md"
          />
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelectId(bm.id);
          }}
          aria-label="Выбрать закладку"
          className={`relative z-10 pointer-events-auto shrink-0 transition-opacity ${
            isSelected
              ? 'flex text-[#0B72E7] opacity-100'
              : hasSelection
                ? 'flex text-[#B0B7C3] opacity-100'
                : 'hidden sm:flex text-[#B0B7C3] opacity-0 group-hover:opacity-100'
          }`}
        >
          {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
        </button>

        {displayFields.info && (
          <span className="relative z-10 pointer-events-none shrink-0 flex">
            {renderFavicon()}
          </span>
        )}

        <span className="dk-card-title relative z-10 pointer-events-none text-[13.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5] truncate flex-1 min-w-0 inline-flex items-center gap-1.5">
          {isRefreshing && <Loader2 className="w-3.5 h-3.5 text-[#0B72E7] animate-spin shrink-0" />}
          <span className="truncate">{displayFields.title ? bm.title : bm.domain || typeLabel}</span>
          {bm.is_favorite && !isTrash && (
            <Star className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" fill="currentColor" />
          )}
        </span>

        {isTodo && todoSummary && todoSummary.total > 0 && (
          <span className="relative z-10 pointer-events-none inline-flex items-center gap-1.5 text-[11.5px] tabular-nums font-medium text-[#0B72E7] dark:text-[#60A5FA] shrink-0">
            <span>
              {todoSummary.completed}/{todoSummary.total}
            </span>
            <span className="text-[#7A828F] dark:text-[#8E96A4]">·</span>
            <span>{todoSummary.avgProgress}%</span>
          </span>
        )}

        {displayFields.tags && bm.tags.length > 0 && (
          <span className="relative z-10 pointer-events-none hidden md:inline-flex items-center gap-1.5 text-[12px] text-[#7A828F] dark:text-[#8E96A4] shrink-0">
            {bm.tags.slice(0, 2).map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </span>
        )}

        {displayFields.info && !isLocalItem && bm.snapshot_size > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPdf(bm);
            }}
            className="relative z-10 pointer-events-auto text-[11.5px] font-medium text-[#0B72E7] dark:text-[#58A6FF] hover:underline shrink-0"
          >
            PDF
          </button>
        )}

        {displayFields.info && (
          <>
            <span className="relative z-10 pointer-events-none hidden sm:inline text-[12px] text-[#7A828F] dark:text-[#8E96A4] truncate max-w-[150px] shrink-0">
              {isLocalItem ? typeLabel : bm.domain}
            </span>

            <span className="relative z-10 pointer-events-none text-[12px] tabular-nums text-[#8B929E] dark:text-[#747B88] whitespace-nowrap shrink-0 text-right">
              {formattedDate}
            </span>
          </>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditBookmark(bm);
          }}
          title="Редактировать"
          aria-label="Редактировать"
          className="sm:hidden relative z-10 pointer-events-auto shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[#7A828F] dark:text-[#9CA3AF] hover:bg-[#EBEDF0] dark:hover:bg-[#32353B]"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>

        <div className="hidden sm:group-hover:flex absolute right-2 top-1/2 -translate-y-1/2 z-20">
          {renderQuickActions()}
        </div>
      </div>
    );
  }

  // Masonry view
  const masonrySurfaceClass = isActive
    ? hasCustomColor
      ? `${colorOpt.cardClass} ring-2 ring-[#0B72E7] border-[#0B72E7]`
      : 'border-[#0B72E7] bg-[#F7FAFF] dark:bg-[#1C283A]'
    : isSelected
      ? hasCustomColor
        ? `${colorOpt.cardClass} ring-1 ring-[#0B72E7] border-[#0B72E7]/80`
        : 'border-[#0B72E7]/70 bg-white dark:bg-[#26282C]'
      : colorOpt.cardClass;

  if (isLocalItem) {
    const showNoteCoverPreview = hasNoteImage && displayFields.cover;
    return (
      <article
        draggable
        data-card-color={hasCustomColor ? 'true' : undefined}
        onDragStart={(e) => handleDragStart(e, bm.id)}
        onClick={() => onSelectBookmark(bm)}
        className={`dk-card relative group rounded-lg border overflow-hidden cursor-pointer transition-colors ${masonrySurfaceClass}`}
      >
        {showNoteCoverPreview ? (
          <>
            <div className="relative z-10 pointer-events-none w-full border-b border-black/8 dark:border-white/10">
              <BookmarkCover
                cover={bm.cover}
                title={bm.title}
                domain=""
                type={bm.type}
                fallbackStyle={fallbackCoverStyle}
                naturalAspect
                className="w-full"
              />
              {renderPreviewBottomOverlay()}
            </div>
            {renderCardTopCorners()}
          </>
        ) : (
          renderLocalCardHeader()
        )}

        <div
          className={`relative z-10 pointer-events-none px-3.5 pb-3.5 space-y-2 ${
            showNoteCoverPreview ? 'pt-3' : 'pt-1'
          }`}
        >
          {displayFields.title && (
            <h3 className="dk-card-title text-[14px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] leading-snug">
              {bm.title}
            </h3>
          )}
          {isTodo && displayFields.excerpt && bm.excerpt && (
            <p className="dk-card-excerpt text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] line-clamp-3 leading-relaxed">
              {bm.excerpt}
            </p>
          )}
          {isNote && displayFields.note && bm.note && (
            <p className="text-[12.5px] text-[#374151] dark:text-[#D1D5DB] whitespace-pre-line line-clamp-10 leading-relaxed">
              {bm.note}
            </p>
          )}
          {isTodo && renderTodoListPreview(8)}
          <div className="pt-1">{renderMetaLine(false)}</div>
        </div>
      </article>
    );
  }

  return (
    <article
      draggable
      onDragStart={(e) => handleDragStart(e, bm.id)}
      onClick={canOpenDirectly ? undefined : () => onSelectBookmark(bm)}
      className={`dk-card relative group rounded-lg border overflow-hidden cursor-pointer transition-colors ${masonrySurfaceClass}`}
    >
      {canOpenDirectly && (
        <a
          href={bm.url}
          target={linkTarget}
          rel="noopener noreferrer"
          aria-label={`Открыть ${bm.title}`}
          className="absolute inset-0 z-0"
        />
      )}

      {displayFields.cover && (
        <div className="relative z-10 pointer-events-none w-full border-b border-[#ECEEF2] dark:border-[#30333A]">
          <BookmarkCover
            cover={bm.cover}
            title={bm.title}
            domain={bm.domain}
            type={bm.type}
            fallbackStyle={fallbackCoverStyle}
            naturalAspect={Boolean(bm.cover)}
            className={bm.cover ? 'w-full' : 'w-full h-32'}
          />
          {renderPreviewBottomOverlay()}
          {isRefreshing && (
            <div className="absolute inset-0 z-30 bg-white/65 dark:bg-[#202124]/65 backdrop-blur-[1px] flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-[#0B72E7] animate-spin" />
            </div>
          )}
        </div>
      )}

      {renderCardTopCorners()}

      <div
        className={`relative z-10 pointer-events-none p-3.5 space-y-1.5 ${
          !displayFields.cover ? 'pt-9 min-h-[42px]' : ''
        }`}
      >
        {displayFields.title && (
          <h3 className="dk-card-title text-[13.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] leading-snug">
            {bm.title}
          </h3>
        )}
        {displayFields.excerpt && bm.excerpt && (
          <p className="dk-card-excerpt text-[12px] text-[#5F6672] dark:text-[#A1A7B3] line-clamp-3 leading-relaxed">
            {bm.excerpt}
          </p>
        )}
        {displayFields.note && bm.note && (
          <p className="text-[12px] text-[#4B5563] dark:text-[#C4C9D4] bg-[#F4F5F7] dark:bg-[#2E3138] rounded px-2 py-1 line-clamp-2">
            {bm.note}
          </p>
        )}
        {displayFields.highlights && bm.highlights.length > 0 && (
          <p className="text-[12px] text-[#78350F] dark:text-[#FDE68A] bg-[#FEF3C7]/60 dark:bg-[#78350F]/25 rounded px-2 py-1.5 line-clamp-2">
            «{bm.highlights[0].text}»
          </p>
        )}
        <div className="pt-1">{renderMetaLine(false)}</div>
        {!displayFields.cover && renderNoCoverFloatingActions()}
      </div>
    </article>
  );
});

export const BookmarkViews = memo(function BookmarkViews({
  bookmarks,
  collections,
  viewMode,
  displayFields,
  columnCount,
  fallbackCoverStyle,
  clickAction,
  cardButtons,
  showTypeBadge,
  scope,
  loading,
  activeBookmarkId,
  selectedIds,
  savingPdfId,
  refreshingIds,
  bulkRefreshProgress,
  onSelectBookmark,
  onEditBookmark,
  onToggleSelectId,
  onSelectAll,
  onClearSelection,
  onToggleFavorite,
  onUpdateTodoItems,
  onOpenPdf,
  onSaveOfflinePdf,
  onTrashBookmark,
  onRestoreBookmark,
  onDeletePermanent,
  onEmptyTrash,
  onBulkAction,
  onBulkRefresh,
  onCancelBulkRefresh,
  onClickTag,
  onOpenAddModal,
}: BookmarkViewsProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState('');
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Measure actual workspace width so left-to-right masonry adapts cleanly (even when inspector opens)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || viewMode !== 'masonry') return;

    const updateWidth = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setContainerWidth((prev) => (prev === next ? prev : next));
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, loading]);

  // Reset rendered window cleanly when dataset changes
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [bookmarks, viewMode]);

  // Progressive infinite-scroll loading so huge libraries (1000+ bookmarks) stay instant
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || visibleCount >= bookmarks.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(bookmarks.length, prev + VISIBLE_BATCH_STEP));
        }
      },
      { root, rootMargin: '400px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, bookmarks.length]);

  const collectionMap = useMemo(
    () => new Map(collections.map((c) => [c.id, c.title])),
    [collections]
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const refreshingSet = useMemo(() => new Set(refreshingIds), [refreshingIds]);
  const hasSelection = selectedIds.length > 0;
  const isTrash = scope === 'trash';
  const isBulkRefreshing = Boolean(bulkRefreshProgress);

  const visibleBookmarks = useMemo(
    () => bookmarks.slice(0, visibleCount),
    [bookmarks, visibleCount]
  );

  const masonryColCount = useMemo(
    () => getMasonryColumnCount(columnCount, containerWidth),
    [columnCount, containerWidth]
  );

  // Distribute bookmarks left-to-right across masonry columns so sort order reads naturally row-by-row
  const masonryColumns = useMemo(() => {
    if (viewMode !== 'masonry') return [];
    const cols = Array.from({ length: masonryColCount }, () => [] as Bookmark[]);
    visibleBookmarks.forEach((bm, idx) => {
      cols[idx % masonryColCount].push(bm);
    });
    return cols;
  }, [viewMode, visibleBookmarks, masonryColCount]);

  const handleCopyLink = useCallback((bm: Bookmark) => {
    const payload =
      bm.type === 'note'
        ? [bm.title, bm.note].filter(Boolean).join('\n\n')
        : bm.type === 'todo'
          ? [bm.title, bm.excerpt, formatTodoItemsForAi(bm.todo_items || [])]
              .filter(Boolean)
              .join('\n\n')
          : bm.url;
    navigator.clipboard?.writeText(payload).catch(() => {});
    setCopiedId(bm.id);
    setTimeout(() => setCopiedId((curr) => (curr === bm.id ? null : curr)), 1500);
  }, []);

  if (loading) {
    return (
      <div className="p-4 lg:p-6 space-y-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="flex items-center gap-4 py-3 border-b border-[#ECEEF2] dark:border-[#2B2D32] animate-pulse"
          >
            <div className="w-20 h-14 rounded-md bg-[#ECEEF2] dark:bg-[#2B2D32] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-[#ECEEF2] dark:bg-[#2B2D32]" />
              <div className="h-3 w-4/5 rounded bg-[#F3F4F6] dark:bg-[#26282C]" />
              <div className="h-3 w-1/3 rounded bg-[#F3F4F6] dark:bg-[#26282C]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const remainingCount = bookmarks.length - visibleBookmarks.length;

  return (
    <div ref={scrollContainerRef} className="relative z-0 flex-1 overflow-y-auto">
      {/* Bulk Selection Bar */}
      {(selectedIds.length > 0 || bulkRefreshProgress) && (
        <div className="sticky top-0 z-20 px-4 lg:px-6 py-2.5 bg-[#EDF4FE] dark:bg-[#192B44] border-b border-[#C9DFFA] dark:border-[#28446B] flex flex-wrap items-center justify-between gap-3">
          {bulkRefreshProgress ? (
            <div className="flex items-center gap-3 w-full justify-between flex-wrap">
              <div className="flex items-center gap-2 text-[13px] font-medium text-[#0B72E7] dark:text-[#60A5FA]">
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                <span className="tabular-nums">
                  Обновление превью и описаний: {bulkRefreshProgress.completed} / {bulkRefreshProgress.total}
                </span>
              </div>
              <button
                type="button"
                onClick={onCancelBulkRefresh}
                className="h-8 px-3 rounded-md bg-white dark:bg-[#26282C] border border-[#D4DCE6] dark:border-[#383B42] text-[12px] font-medium text-[#5F6672] dark:text-[#C4C9D4] hover:border-red-400 hover:text-red-600 dark:hover:text-red-400 transition-colors whitespace-nowrap"
              >
                Остановить
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#0B72E7] dark:text-[#60A5FA]">
                  <CheckSquare className="w-4 h-4" />
                  <span className="tabular-nums">Выбрано: {selectedIds.length}</span>
                </div>
                {selectedIds.length < bookmarks.length && (
                  <button
                    type="button"
                    onClick={onSelectAll}
                    className="text-[12px] font-medium text-[#0B72E7] dark:text-[#60A5FA] hover:underline"
                  >
                    Выбрать все ({bookmarks.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white"
                >
                  Снять выбор
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                {!isTrash && (
                  <>
                    <button
                      type="button"
                      disabled={isBulkRefreshing}
                      onClick={() => {
                        setBulkMoveOpen(false);
                        setBulkTagOpen(false);
                        onBulkRefresh();
                      }}
                      title="Загрузить свежие превью, заголовки и описания со страниц"
                      className="h-8 px-2.5 rounded-md bg-white dark:bg-[#26282C] border border-[#D4DCE6] dark:border-[#383B42] text-[12px] font-medium flex items-center gap-1.5 hover:border-[#0B72E7] disabled:opacity-60 whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-[#0B72E7] dark:text-[#58A6FF]" />
                      <span>Обновить превью</span>
                    </button>

                    <div className="relative">
                      <button
                        type="button"
                        disabled={isBulkRefreshing}
                        onClick={() => {
                          setBulkMoveOpen((v) => !v);
                          setBulkTagOpen(false);
                        }}
                        className="h-8 px-2.5 rounded-md bg-white dark:bg-[#26282C] border border-[#D4DCE6] dark:border-[#383B42] text-[12px] font-medium flex items-center gap-1.5 hover:border-[#0B72E7] disabled:opacity-60 whitespace-nowrap"
                      >
                        <FolderInput className="w-3.5 h-3.5" />
                        <span>Переместить</span>
                      </button>
                      {bulkMoveOpen && (
                        <div className="absolute right-0 top-[calc(100%+4px)] w-52 max-h-60 overflow-y-auto rounded-lg bg-white dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#383B42] shadow-lg py-1 z-30">
                          <button
                            type="button"
                            onClick={() => {
                              onBulkAction('move', { collection_id: null });
                              setBulkMoveOpen(false);
                            }}
                            className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#F4F5F7] dark:hover:bg-[#32353B]"
                          >
                            Несортированные
                          </button>
                          {collections.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                onBulkAction('move', { collection_id: c.id });
                                setBulkMoveOpen(false);
                              }}
                              className="w-full text-left px-3 py-1.5 text-[13px] truncate hover:bg-[#F4F5F7] dark:hover:bg-[#32353B]"
                            >
                              {c.parent_id ? '↳ ' : ''}
                              {c.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        disabled={isBulkRefreshing}
                        onClick={() => {
                          setBulkTagOpen((v) => !v);
                          setBulkMoveOpen(false);
                        }}
                        className="h-8 px-2.5 rounded-md bg-white dark:bg-[#26282C] border border-[#D4DCE6] dark:border-[#383B42] text-[12px] font-medium flex items-center gap-1.5 hover:border-[#0B72E7] disabled:opacity-60 whitespace-nowrap"
                      >
                        <Tag className="w-3.5 h-3.5" />
                        <span>Тег</span>
                      </button>
                      {bulkTagOpen && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (bulkTagValue.trim()) {
                              onBulkAction('add_tag', { tag: bulkTagValue.trim() });
                              setBulkTagValue('');
                              setBulkTagOpen(false);
                            }
                          }}
                          className="absolute right-0 top-[calc(100%+4px)] w-56 p-2 rounded-lg bg-white dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#383B42] shadow-lg flex gap-1.5 z-30"
                        >
                          <input
                            type="text"
                            value={bulkTagValue}
                            onChange={(e) => setBulkTagValue(e.target.value)}
                            placeholder="Имя тега..."
                            autoFocus
                            className="flex-1 min-w-0 h-8 px-2 rounded text-[12px] bg-[#F4F5F7] dark:bg-[#1E2024] focus:outline-none focus:ring-1 focus:ring-[#0B72E7]"
                          />
                          <button
                            type="submit"
                            className="px-2.5 h-8 rounded bg-[#0B72E7] text-white text-[12px] font-medium"
                          >
                            Ок
                          </button>
                        </form>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={isBulkRefreshing}
                      onClick={() => onBulkAction('favorite')}
                      className="h-8 px-2.5 rounded-md bg-white dark:bg-[#26282C] border border-[#D4DCE6] dark:border-[#383B42] text-[12px] font-medium flex items-center gap-1.5 hover:border-[#D97706] disabled:opacity-60 whitespace-nowrap"
                    >
                      <Star className="w-3.5 h-3.5 text-[#D97706]" />
                      <span>В избранное</span>
                    </button>

                    <button
                      type="button"
                      disabled={isBulkRefreshing}
                      onClick={() => onBulkAction('trash')}
                      className="h-8 px-2.5 rounded-md bg-white dark:bg-[#26282C] border border-[#D4DCE6] dark:border-[#383B42] text-[12px] font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5 hover:border-red-500 disabled:opacity-60 whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>В корзину</span>
                    </button>
                  </>
                )}

                {isTrash && (
                  <>
                    <button
                      type="button"
                      onClick={() => onBulkAction('restore')}
                      className="h-8 px-2.5 rounded-md bg-white dark:bg-[#26282C] border border-[#D4DCE6] dark:border-[#383B42] text-[12px] font-medium text-[#16A34A] flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Восстановить</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onBulkAction('delete')}
                      className="h-8 px-2.5 rounded-md bg-red-600 text-white text-[12px] font-medium flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Удалить навсегда</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Trash Banner */}
      {isTrash && bookmarks.length > 0 && (
        <div className="px-4 lg:px-6 py-2.5 bg-[#FAF4F4] dark:bg-[#2C1E20] border-b border-[#F3D5D5] dark:border-[#4A282C] flex items-center justify-between gap-4 text-[13px]">
          <span className="text-[#7F1D1D] dark:text-[#FCA5A5]">
            Закладки в корзине можно восстановить или удалить безвозвратно.
          </span>
          <button
            type="button"
            onClick={onEmptyTrash}
            className="px-3 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors"
          >
            Очистить корзину
          </button>
        </div>
      )}

      {/* Empty State */}
      {bookmarks.length === 0 ? (
        <div className="h-[60vh] flex flex-col items-center justify-center px-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-[#F4F5F7] dark:bg-[#2A2C31] flex items-center justify-center text-[#8B929E] mb-4">
            {isTrash ? <Trash2 className="w-5 h-5" /> : <X className="w-5 h-5" />}
          </div>
          <h2 className="text-[16px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] mb-1">
            {isTrash ? 'Корзина пуста' : 'Закладок не найдено'}
          </h2>
          <p className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] max-w-sm mb-5">
            {isTrash
              ? 'Удалённые закладки сначала попадают сюда, чтобы их можно было вернуть.'
              : 'Добавьте новую ссылку или измените параметры поиска и фильтров.'}
          </p>
          {!isTrash && (
            <button
              type="button"
              onClick={onOpenAddModal}
              className="h-9 px-4 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить закладку</span>
            </button>
          )}
        </div>
      ) : (
        <div className="p-4 lg:p-6">
          {viewMode === 'masonry' ? (
            <div className={`flex items-start gap-4 ${columnCount === 1 ? 'max-w-[740px]' : ''}`}>
              {masonryColumns.map((colItems, colIdx) => (
                <div key={colIdx} className="flex-1 min-w-0 flex flex-col gap-4">
                  {colItems.map((bm) => (
                    <BookmarkItem
                      key={bm.id}
                      bm={bm}
                      viewMode={viewMode}
                      displayFields={displayFields}
                      fallbackCoverStyle={fallbackCoverStyle}
                      clickAction={clickAction}
                      cardButtons={cardButtons}
                      showTypeBadge={showTypeBadge}
                      collectionTitle={bm.collection_id ? collectionMap.get(bm.collection_id) ?? null : null}
                      isTrash={isTrash}
                      isSelected={selectedSet.has(bm.id)}
                      isActive={activeBookmarkId === bm.id}
                      isCopied={copiedId === bm.id}
                      isSavingPdf={savingPdfId === bm.id}
                      isRefreshing={refreshingSet.has(bm.id)}
                      hasSelection={hasSelection}
                      onSelectBookmark={onSelectBookmark}
                      onEditBookmark={onEditBookmark}
                      onToggleSelectId={onToggleSelectId}
                      onCopyLink={handleCopyLink}
                      onToggleFavorite={onToggleFavorite}
                      onUpdateTodoItems={onUpdateTodoItems}
                      onOpenPdf={onOpenPdf}
                      onSaveOfflinePdf={onSaveOfflinePdf}
                      onTrashBookmark={onTrashBookmark}
                      onRestoreBookmark={onRestoreBookmark}
                      onDeletePermanent={onDeletePermanent}
                      onClickTag={onClickTag}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div
              className={
                viewMode === 'list'
                  ? 'divide-y divide-[#ECEEF2] dark:divide-[#2B2D32]'
                  : viewMode === 'grid'
                    ? `grid gap-4 ${GRID_COL_CLASSES[columnCount] || GRID_COL_CLASSES[0]}`
                    : 'divide-y divide-[#ECEEF2] dark:divide-[#2B2D32]'
              }
            >
              {visibleBookmarks.map((bm) => (
                <BookmarkItem
                  key={bm.id}
                  bm={bm}
                  viewMode={viewMode}
                  displayFields={displayFields}
                  fallbackCoverStyle={fallbackCoverStyle}
                  clickAction={clickAction}
                  cardButtons={cardButtons}
                  showTypeBadge={showTypeBadge}
                  collectionTitle={bm.collection_id ? collectionMap.get(bm.collection_id) ?? null : null}
                  isTrash={isTrash}
                  isSelected={selectedSet.has(bm.id)}
                  isActive={activeBookmarkId === bm.id}
                  isCopied={copiedId === bm.id}
                  isSavingPdf={savingPdfId === bm.id}
                  isRefreshing={refreshingSet.has(bm.id)}
                  hasSelection={hasSelection}
                  onSelectBookmark={onSelectBookmark}
                  onEditBookmark={onEditBookmark}
                  onToggleSelectId={onToggleSelectId}
                  onCopyLink={handleCopyLink}
                  onToggleFavorite={onToggleFavorite}
                  onUpdateTodoItems={onUpdateTodoItems}
                  onOpenPdf={onOpenPdf}
                  onSaveOfflinePdf={onSaveOfflinePdf}
                  onTrashBookmark={onTrashBookmark}
                  onRestoreBookmark={onRestoreBookmark}
                  onDeletePermanent={onDeletePermanent}
                  onClickTag={onClickTag}
                />
              ))}
            </div>
          )}

          {remainingCount > 0 && (
            <div ref={loadMoreRef} className="pt-6 pb-4 flex justify-center">
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((prev) => Math.min(bookmarks.length, prev + VISIBLE_BATCH_STEP))
                }
                className="h-9 px-4 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12.5px] font-medium text-[#5F6672] dark:text-[#C4C9D4] hover:text-[#181A1F] dark:hover:text-white transition-colors"
              >
                Показать ещё ({remainingCount})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
