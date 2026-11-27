import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Sparkles, X } from 'lucide-react';
import { api } from './api';
import { AddBookmarkModal, type AddModalMode, type BookmarkDraft } from './components/AddBookmarkModal';
import { AuthGate } from './components/AuthGate';
import { BookmarkViews, type BulkRefreshProgress } from './components/BookmarkViews';
import { CollectionModal } from './components/CollectionModal';
import { InspectorPanel } from './components/InspectorPanel';
import { PdfViewerModal } from './components/PdfViewerModal';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { SORT_LABELS, TopBar } from './components/TopBar';
import { ViewSettingsMenu } from './components/ViewSettingsMenu';
import type {
  AppPreferences,
  AuthStatus,
  Bookmark,
  Collection,
  DisplayFields,
  NavScope,
  SmartFilter,
  SmartStats,
  SortMode,
  TagCount,
  TodoItem,
  ViewMode,
} from './types';
import { loadPreferences, savePreferences } from './utils/preferences';

const DEFAULT_DISPLAY_FIELDS: DisplayFields = {
  cover: true,
  title: true,
  note: true,
  excerpt: true,
  highlights: true,
  tags: true,
  info: true,
};

const EMPTY_STATS: SmartStats = {
  all: 0,
  unsorted: 0,
  favorites: 0,
  trash: 0,
  articles: 0,
  videos: 0,
  images: 0,
  links: 0,
  documents: 0,
  notes: 0,
  todos: 0,
  highlights: 0,
  untagged: 0,
  duplicates: 0,
  broken: 0,
  localBlocked: 0,
  offline: 0,
  dbSizeBytes: 0,
  snapshotsSizeBytes: 0,
  dbPath: '',
  pdfEngine: 'builtin',
};

const FILTER_TITLES: Record<SmartFilter, string> = {
  '': '',
  note: 'Заметки',
  todo: 'Списки задач',
  article: 'Статьи',
  video: 'Видео',
  image: 'Изображения',
  link: 'Ссылки',
  document: 'Документы',
  highlights: 'С заметками и цитатами',
  offline: 'Офлайн PDF',
  untagged: 'Без тегов',
  duplicates: 'Дубликаты',
  broken: 'Сломанные ссылки',
  local_blocked: 'Доступны извне (блок локально)',
};

const VALID_NAV_SCOPES: NavScope[] = ['all', 'unsorted', 'favorites', 'trash', 'collection'];

interface SavedNavState {
  scope: NavScope;
  activeCollectionId: string | null;
  activeFilter: SmartFilter;
  activeTag: string | null;
}

function sanitizeNavState(raw: Partial<SavedNavState> | null | undefined): SavedNavState {
  const scopeVal =
    typeof raw?.scope === 'string' && VALID_NAV_SCOPES.includes(raw.scope as NavScope)
      ? (raw.scope as NavScope)
      : 'all';
  const filterVal =
    typeof raw?.activeFilter === 'string' && raw.activeFilter in FILTER_TITLES
      ? (raw.activeFilter as SmartFilter)
      : '';
  const collectionVal =
    scopeVal === 'collection' &&
    typeof raw?.activeCollectionId === 'string' &&
    raw.activeCollectionId.trim()
      ? raw.activeCollectionId.trim()
      : null;
  const tagVal =
    typeof raw?.activeTag === 'string' && raw.activeTag.trim() ? raw.activeTag.trim() : null;

  return {
    scope: scopeVal === 'collection' && !collectionVal ? 'all' : scopeVal,
    activeCollectionId: collectionVal,
    activeFilter: filterVal,
    activeTag: tagVal,
  };
}

function readNavStateFromHash(): SavedNavState | null {
  if (typeof window === 'undefined') return null;
  const rawHash = window.location.hash.replace(/^#/, '').trim();
  if (!rawHash) return null;
  try {
    const params = new URLSearchParams(rawHash);
    const tag = params.get('tag');
    const filter = params.get('filter');
    const collection = params.get('collection');
    const scope = params.get('scope');
    if (!tag && !filter && !collection && !scope) return null;
    return sanitizeNavState({
      scope: collection ? 'collection' : ((scope as NavScope) || 'all'),
      activeCollectionId: collection || null,
      activeFilter: (filter as SmartFilter) || '',
      activeTag: tag || null,
    });
  } catch {
    return null;
  }
}

function loadInitialNavState(): SavedNavState {
  const fromHash = readNavStateFromHash();
  if (fromHash) return fromHash;
  if (typeof window === 'undefined') {
    return { scope: 'all', activeCollectionId: null, activeFilter: '', activeTag: null };
  }
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage.getItem('dropkeep_nav_state');
      if (raw) {
        return sanitizeNavState(JSON.parse(raw) as Partial<SavedNavState>);
      }
    } catch {
      // ignore storage access errors
    }
  }
  return { scope: 'all', activeCollectionId: null, activeFilter: '', activeTag: null };
}

function persistNavState(nav: SavedNavState): void {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(nav);
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      storage.setItem('dropkeep_nav_state', serialized);
    } catch {
      // ignore storage quota errors
    }
  }
  try {
    const params = new URLSearchParams();
    if (nav.activeTag) {
      params.set('tag', nav.activeTag);
    } else if (nav.activeFilter) {
      params.set('filter', nav.activeFilter);
    } else if (nav.scope === 'collection' && nav.activeCollectionId) {
      params.set('collection', nav.activeCollectionId);
    } else if (nav.scope !== 'all') {
      params.set('scope', nav.scope);
    }
    const nextHash = params.toString() ? `#${params.toString()}` : '';
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  } catch {
    // ignore history API errors in restricted iframes
  }
}

function readBookmarkletDraftFromUrl(): BookmarkDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const rawUrl = (params.get('url') || '').trim();
    if (!rawUrl) return null;
    if (params.get('add') !== '1' && !params.has('url')) return null;
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return {
      url: parsed.toString(),
      title: (params.get('title') || '').trim().slice(0, 300),
      excerpt: (params.get('excerpt') || '').trim().slice(0, 1000),
    };
  } catch {
    return null;
  }
}

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(() => loadPreferences());
  const darkMode = preferences.theme === 'dark';

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = window.localStorage.getItem('dropkeep_view') as ViewMode | null;
      if (saved && ['list', 'grid', 'headlines', 'masonry'].includes(saved)) return saved;
    } catch {
      // ignore
    }
    return loadPreferences().defaultViewMode;
  });

  const [columnCount, setColumnCount] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem('dropkeep_columns'));
      if (!Number.isNaN(saved) && saved >= 0 && saved <= 6) return saved;
    } catch {
      // ignore
    }
    return 0;
  });

  const [displayFields, setDisplayFields] = useState<DisplayFields>(() => {
    try {
      const raw = window.localStorage.getItem('dropkeep_display_fields');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DisplayFields>;
        return {
          cover: parsed.cover ?? true,
          title: parsed.title ?? true,
          note: parsed.note ?? true,
          excerpt: parsed.excerpt ?? true,
          highlights: parsed.highlights ?? true,
          tags: parsed.tags ?? true,
          info: parsed.info ?? true,
        };
      }
    } catch {
      // ignore
    }
    return DEFAULT_DISPLAY_FIELDS;
  });

  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try {
      const saved = window.localStorage.getItem('dropkeep_sort') as SortMode | null;
      if (saved && ['newest', 'oldest', 'title_asc', 'title_desc', 'domain'].includes(saved)) {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'newest';
  });

  const initialNav = useMemo(() => loadInitialNavState(), []);

  const [scope, setScope] = useState<NavScope>(initialNav.scope);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    initialNav.activeCollectionId
  );
  const [activeFilter, setActiveFilter] = useState<SmartFilter>(initialNav.activeFilter);
  const [activeTag, setActiveTag] = useState<string | null>(initialNav.activeTag);
  const [search, setSearch] = useState('');
  const [aiConfigured, setAiConfigured] = useState(false);
  const [smartSearchMode, setSmartSearchMode] = useState(false);
  const [smartSearchLoading, setSmartSearchLoading] = useState(false);
  const [smartSearchMeta, setSmartSearchMeta] = useState<{
    query: string;
    scannedCount: number;
    reasons: Record<string, string>;
  } | null>(null);
  const [smartSearchError, setSmartSearchError] = useState('');

  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [stats, setStats] = useState<SmartStats>(EMPTY_STATS);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeBookmark, setActiveBookmark] = useState<Bookmark | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'preview' | 'edit'>('edit');
  const [pdfViewerBookmark, setPdfViewerBookmark] = useState<Bookmark | null>(null);
  const [savingPdfId, setSavingPdfId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [refreshingIds, setRefreshingIds] = useState<string[]>([]);
  const [bulkRefreshProgress, setBulkRefreshProgress] = useState<BulkRefreshProgress | null>(null);
  const bulkRefreshCancelRef = useRef(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalMode, setAddModalMode] = useState<AddModalMode>('single');
  const [addModalDraft, setAddModalDraft] = useState<BookmarkDraft | null>(null);
  const [pendingBookmarklet, setPendingBookmarklet] = useState<BookmarkDraft | null>(() =>
    readBookmarkletDraftFromUrl()
  );
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [collectionModalState, setCollectionModalState] = useState<{
    open: boolean;
    editing: Collection | null;
    parentId: string | null;
  }>({ open: false, editing: null, parentId: null });
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((curr) => (curr === msg ? null : curr));
    }, 2600);
  }, []);

  // Sync theme (light / dark / dark-sidebar / sepia), largeFont, and persistence
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', preferences.theme === 'dark');
    root.classList.toggle('theme-sepia', preferences.theme === 'sepia');
    root.classList.toggle('font-large', preferences.largeFont);
    savePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    try {
      window.localStorage.setItem('dropkeep_sort', sortMode);
    } catch {
      // ignore
    }
  }, [sortMode]);

  useEffect(() => {
    persistNavState({ scope, activeCollectionId, activeFilter, activeTag });
  }, [scope, activeCollectionId, activeFilter, activeTag]);

  const handleUpdatePreferences = useCallback((patch: Partial<AppPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
    if (patch.defaultViewMode) {
      setViewMode(patch.defaultViewMode);
      try {
        window.localStorage.setItem('dropkeep_view', patch.defaultViewMode);
      } catch {
        // ignore
      }
    }
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem('dropkeep_view', mode);
    } catch {
      // ignore
    }
  };

  const handleColumnCountChange = (cols: number) => {
    const clamped = Math.max(0, Math.min(6, Math.round(cols)));
    setColumnCount(clamped);
    try {
      window.localStorage.setItem('dropkeep_columns', String(clamped));
    } catch {
      // ignore
    }
  };

  const handleToggleDisplayField = (field: keyof DisplayFields) => {
    setDisplayFields((prev) => {
      const next = { ...prev, [field]: !prev[field] };
      try {
        window.localStorage.setItem('dropkeep_display_fields', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Check auth status on initial mount
  const checkAuth = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
    } catch {
      setAuthStatus({ authEnabled: false, authenticated: true, source: 'none' });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadWorkspace = useCallback(async () => {
    try {
      const data = await api.getWorkspace();
      setCollections(data.collections);
      setTags(data.tags);
      setStats(data.stats);
      setAiConfigured(Boolean(data.aiConfigured));
      setActiveCollectionId((curr) => {
        if (curr && !data.collections.some((c) => c.id === curr)) {
          setScope((prevScope) => (prevScope === 'collection' ? 'all' : prevScope));
          return null;
        }
        return curr;
      });
      setActiveTag((curr) => (curr && !data.tags.some((t) => t.tag === curr) ? null : curr));
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setAuthStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
      }
    }
  }, []);

  const effectiveSearch = smartSearchMode ? '' : search.trim();

  const loadBookmarks = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.listBookmarks({
        scope,
        collectionId: scope === 'collection' && activeCollectionId ? activeCollectionId : undefined,
        filterType: activeFilter || undefined,
        tag: activeTag || undefined,
        search: effectiveSearch || undefined,
        sort: sortMode,
        includeNested: preferences.includeNested,
      });
      setBookmarks(items);
      setSelectedIds([]);
      setActiveBookmark((curr) => (curr ? items.find((b) => b.id === curr.id) || null : null));
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setAuthStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
      }
    } finally {
      setLoading(false);
    }
  }, [
    scope,
    activeCollectionId,
    activeFilter,
    activeTag,
    effectiveSearch,
    sortMode,
    preferences.includeNested,
  ]);

  const runSmartSearch = useCallback(
    async (explicitQuery?: string) => {
      const q = (explicitQuery ?? search).trim();
      if (!aiConfigured || q.length < 2) return;
      setSmartSearchMode(true);
      setSmartSearchLoading(true);
      setSmartSearchError('');
      try {
        const res = await api.smartSearch({
          query: q,
          scope,
          collectionId: scope === 'collection' && activeCollectionId ? activeCollectionId : undefined,
          filterType: activeFilter || undefined,
          tag: activeTag || undefined,
        });
        setBookmarks(res.bookmarks);
        setSelectedIds([]);
        setSmartSearchMeta({
          query: q,
          scannedCount: res.scannedCount,
          reasons: res.reasons,
        });
      } catch (err) {
        setSmartSearchError(
          err instanceof Error ? err.message : 'Не удалось выполнить умный поиск с ИИ'
        );
      } finally {
        setSmartSearchLoading(false);
      }
    },
    [aiConfigured, search, scope, activeCollectionId, activeFilter, activeTag]
  );

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setSmartSearchError('');
    if (!val.trim() && smartSearchMeta) {
      setSmartSearchMeta(null);
      loadBookmarks();
    }
  };

  const handleToggleSmartSearch = () => {
    if (!aiConfigured) return;
    setSmartSearchError('');
    if (smartSearchMode) {
      setSmartSearchMode(false);
      setSmartSearchMeta(null);
    } else {
      setSmartSearchMode(true);
      if (search.trim().length >= 2) {
        runSmartSearch(search);
      }
    }
  };

  const handleExitSmartSearch = () => {
    setSmartSearchMode(false);
    setSmartSearchMeta(null);
    setSmartSearchError('');
  };

  useEffect(() => {
    if (authStatus?.authenticated) {
      loadWorkspace();
    }
  }, [authStatus?.authenticated, loadWorkspace]);

  useEffect(() => {
    if (!authStatus?.authenticated) return;
    if (smartSearchMode && (smartSearchMeta || smartSearchLoading)) return;
    const timer = window.setTimeout(() => {
      loadBookmarks();
    }, effectiveSearch ? 140 : 0);
    return () => window.clearTimeout(timer);
  }, [authStatus?.authenticated, loadBookmarks, effectiveSearch, smartSearchMode, smartSearchMeta, smartSearchLoading]);

  // Auto-open AddBookmarkModal when launched via browser bookmarklet (?add=1&url=...)
  useEffect(() => {
    if (!authStatus?.authenticated || !pendingBookmarklet) return;
    setAddModalDraft(pendingBookmarklet);
    setAddModalOpen(true);
    setPendingBookmarklet(null);
    try {
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
    } catch {
      // ignore
    }
  }, [authStatus?.authenticated, pendingBookmarklet]);

  // Global keyboard shortcuts (Escape to close, N to add bookmark)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmState) {
          setConfirmState(null);
        } else if (pdfViewerBookmark) {
          setPdfViewerBookmark(null);
        } else if (addModalOpen) {
          setAddModalOpen(false);
          setAddModalDraft(null);
        } else if (collectionModalState.open) {
          setCollectionModalState({ open: false, editing: null, parentId: null });
        } else if (settingsModalOpen) {
          setSettingsModalOpen(false);
        } else if (activeBookmark) {
          setActiveBookmark(null);
        }
        return;
      }

      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isEditing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (!isEditing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setAddModalDraft(null);
        setAddModalMode(
          activeFilter === 'note' ? 'note' : activeFilter === 'todo' ? 'todo' : 'single'
        );
        setAddModalOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmState,
    pdfViewerBookmark,
    addModalOpen,
    collectionModalState.open,
    settingsModalOpen,
    activeBookmark,
    activeFilter,
  ]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadWorkspace(), loadBookmarks()]);
  }, [loadWorkspace, loadBookmarks]);

  const handleSelectScope = useCallback((nextScope: NavScope, collectionId: string | null = null) => {
    setScope(nextScope);
    setActiveCollectionId(collectionId);
    setActiveFilter('');
    setActiveTag(null);
    setSmartSearchMeta(null);
    setSmartSearchError('');
  }, []);

  const handleSelectFilter = useCallback((filter: SmartFilter) => {
    setActiveFilter(filter);
    setActiveTag(null);
    setScope('all');
    setActiveCollectionId(null);
    setSmartSearchMeta(null);
    setSmartSearchError('');
  }, []);

  const handleSelectTag = useCallback((tag: string) => {
    setActiveTag((curr) => (curr === tag ? null : tag));
    setActiveFilter('');
    setScope('all');
    setActiveCollectionId(null);
    setSmartSearchMeta(null);
    setSmartSearchError('');
  }, []);

  const handleToggleFavorite = useCallback(
    async (bm: Bookmark) => {
      const updated = await api.updateBookmark(bm.id, { is_favorite: !bm.is_favorite });
      setBookmarks((prev) => prev.map((item) => (item.id === bm.id ? updated : item)));
      setActiveBookmark((curr) => (curr?.id === bm.id ? updated : curr));
      loadWorkspace();
    },
    [loadWorkspace]
  );

  const handleUpdateTodoItems = useCallback(
    async (bm: Bookmark, items: TodoItem[]) => {
      const optimistic: Bookmark = { ...bm, todo_items: items };
      setBookmarks((prev) => prev.map((item) => (item.id === bm.id ? optimistic : item)));
      setActiveBookmark((curr) => (curr?.id === bm.id ? optimistic : curr));
      try {
        const updated = await api.updateBookmark(bm.id, { todo_items: items });
        setBookmarks((prev) => prev.map((item) => (item.id === bm.id ? updated : item)));
        setActiveBookmark((curr) => (curr?.id === bm.id ? updated : curr));
      } catch {
        setBookmarks((prev) => prev.map((item) => (item.id === bm.id ? bm : item)));
        setActiveBookmark((curr) => (curr?.id === bm.id ? bm : curr));
        showToast('Не удалось обновить статус задачи');
      }
    },
    [showToast]
  );

  const handleSaveOfflinePdf = useCallback(
    async (bm: Bookmark) => {
      setSavingPdfId(bm.id);
      try {
        const updated = await api.createPdfSnapshot(bm.id);
        setBookmarks((prev) => prev.map((item) => (item.id === bm.id ? updated : item)));
        setActiveBookmark((curr) => (curr?.id === bm.id ? updated : curr));
        setPdfViewerBookmark((curr) => (curr?.id === bm.id ? updated : curr));
        showToast('Офлайн PDF-снимок сохранён');
        loadWorkspace();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Не удалось создать PDF-снимок');
      } finally {
        setSavingPdfId(null);
      }
    },
    [loadWorkspace, showToast]
  );

  const handleDeleteOfflinePdf = useCallback(
    async (bm: Bookmark) => {
      setSavingPdfId(bm.id);
      try {
        const updated = await api.deletePdfSnapshot(bm.id);
        setBookmarks((prev) => prev.map((item) => (item.id === bm.id ? updated : item)));
        setActiveBookmark((curr) => (curr?.id === bm.id ? updated : curr));
        setPdfViewerBookmark((curr) => (curr?.id === bm.id ? null : curr));
        showToast('PDF-снимок удалён');
        loadWorkspace();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Не удалось удалить PDF-снимок');
      } finally {
        setSavingPdfId(null);
      }
    },
    [loadWorkspace, showToast]
  );

  const handleTrashBookmark = useCallback(
    async (bm: Bookmark) => {
      await api.deleteBookmark(bm.id, false);
      setActiveBookmark((curr) => (curr?.id === bm.id ? null : curr));
      showToast('Перемещено в корзину');
      refreshAll();
    },
    [refreshAll, showToast]
  );

  const handleRestoreBookmark = useCallback(
    async (bm: Bookmark) => {
      await api.updateBookmark(bm.id, { is_trashed: false });
      setActiveBookmark((curr) => (curr?.id === bm.id ? null : curr));
      showToast('Закладка восстановлена');
      refreshAll();
    },
    [refreshAll, showToast]
  );

  const handleDeletePermanent = useCallback(
    (bm: Bookmark) => {
      const runDelete = async () => {
        await api.deleteBookmark(bm.id, true);
        setActiveBookmark((curr) => (curr?.id === bm.id ? null : curr));
        showToast('Закладка удалена');
        await refreshAll();
      };
      if (!preferences.confirmPermanentDelete) {
        void runDelete();
        return;
      }
      setConfirmState({
        title: 'Удалить навсегда?',
        message: `Закладка «${bm.title}» и её офлайн-копия будут удалены без возможности восстановления.`,
        confirmLabel: 'Удалить',
        onConfirm: runDelete,
      });
    },
    [preferences.confirmPermanentDelete, refreshAll, showToast]
  );

  const handleEmptyTrash = useCallback(() => {
    setConfirmState({
      title: 'Очистить корзину?',
      message: 'Все закладки в корзине будут удалены безвозвратно.',
      confirmLabel: 'Очистить',
      onConfirm: async () => {
        const res = await api.emptyTrash();
        setActiveBookmark(null);
        showToast(`Корзина очищена (${res.removed})`);
        await refreshAll();
      },
    });
  }, [refreshAll, showToast]);

  const handleDeleteCollection = useCallback(
    (col: Collection) => {
      setConfirmState({
        title: `Удалить коллекцию «${col.title}»?`,
        message:
          'Закладки внутри коллекции не пропадут — они будут перенесены в раздел «Несортированные».',
        confirmLabel: 'Удалить коллекцию',
        onConfirm: async () => {
          await api.deleteCollection(col.id);
          if (activeCollectionId === col.id) {
            handleSelectScope('all');
          }
          showToast('Коллекция удалена');
          await refreshAll();
        },
      });
    },
    [activeCollectionId, handleSelectScope, refreshAll, showToast]
  );

  const handleDeleteTag = useCallback(
    (tag: string) => {
      setConfirmState({
        title: `Удалить тег #${tag}?`,
        message: 'Тег будет снят со всех закладок, сами закладки сохранятся.',
        confirmLabel: 'Удалить тег',
        onConfirm: async () => {
          await api.deleteTag(tag);
          setActiveTag((curr) => (curr === tag ? null : curr));
          showToast(`Тег #${tag} удалён`);
          await refreshAll();
        },
      });
    },
    [refreshAll, showToast]
  );

  const handleSelectBookmark = useCallback((bm: Bookmark) => {
    setActiveBookmark(bm);
    setInspectorMode(bm.type === 'note' || bm.type === 'todo' ? 'preview' : 'edit');
  }, []);

  const handleEditBookmark = useCallback((bm: Bookmark) => {
    setActiveBookmark(bm);
    setInspectorMode('edit');
  }, []);

  const handleToggleSelectId = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(bookmarks.map((b) => b.id));
  }, [bookmarks]);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      bookmarks.length > 0 && prev.length === bookmarks.length
        ? []
        : bookmarks.map((b) => b.id)
    );
  }, [bookmarks]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleOpenPdf = useCallback((bm: Bookmark) => {
    setPdfViewerBookmark(bm);
  }, []);

  const handleOpenAddModal = useCallback((mode: AddModalMode = 'single') => {
    setAddModalDraft(null);
    setAddModalMode(mode);
    setAddModalOpen(true);
  }, []);

  const handleCloseMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const handleToggleTheme = useCallback(() => {
    setPreferences((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsModalOpen(true);
  }, []);

  const handleCreateCollection = useCallback((parentId: string | null) => {
    setCollectionModalState({ open: true, editing: null, parentId });
  }, []);

  const handleEditCollection = useCallback((col: Collection) => {
    setCollectionModalState({ open: true, editing: col, parentId: col.parent_id });
  }, []);

  const handleDropBookmark = useCallback(async (
    bookmarkId: string,
    target: { collectionId?: string | null; favorite?: boolean; trash?: boolean }
  ) => {
    if (target.trash) {
      await api.deleteBookmark(bookmarkId, false);
      showToast('Перемещено в корзину');
    } else if (target.favorite) {
      await api.updateBookmark(bookmarkId, { is_favorite: true });
      showToast('Добавлено в избранное');
    } else if (target.collectionId !== undefined) {
      await api.updateBookmark(bookmarkId, { collection_id: target.collectionId, is_trashed: false });
      const colName = target.collectionId
        ? collections.find((c) => c.id === target.collectionId)?.title || 'коллекцию'
        : 'Несортированные';
      showToast(`Перемещено в «${colName}»`);
    }
    refreshAll();
  }, [collections, refreshAll, showToast]);

  const handleBulkAction = useCallback(async (
    action: 'move' | 'add_tag' | 'favorite' | 'trash' | 'restore' | 'delete',
    extra?: { collection_id?: string | null; tag?: string }
  ) => {
    if (!selectedIds.length) return;
    if (action === 'delete') {
      const runBulkDelete = async () => {
        await api.bulkBookmarks({ ids: selectedIds, action: 'delete' });
        setSelectedIds([]);
        showToast('Выбранные закладки удалены');
        await refreshAll();
      };
      if (!preferences.confirmPermanentDelete) {
        await runBulkDelete();
        return;
      }
      setConfirmState({
        title: `Удалить выбранные (${selectedIds.length})?`,
        message: 'Выбранные закладки будут удалены безвозвратно.',
        confirmLabel: 'Удалить навсегда',
        onConfirm: runBulkDelete,
      });
      return;
    }

    await api.bulkBookmarks({
      ids: selectedIds,
      action,
      collection_id: extra?.collection_id,
      tag: extra?.tag,
    });
    setSelectedIds([]);
    showToast('Изменения применены');
    refreshAll();
  }, [preferences.confirmPermanentDelete, selectedIds, refreshAll, showToast]);

  const handleCancelBulkRefresh = useCallback(() => {
    bulkRefreshCancelRef.current = true;
  }, []);

  const handleBulkRefresh = useCallback(async () => {
    const idsToRefresh = selectedIds.filter((id) => {
      const bm = bookmarks.find((item) => item.id === id);
      return bm ? Boolean(bm.url) : true;
    });
    if (!idsToRefresh.length || bulkRefreshProgress) {
      if (selectedIds.length > 0 && idsToRefresh.length === 0) {
        showToast('Для заметок и списков задач обновление превью не требуется');
      }
      return;
    }

    bulkRefreshCancelRef.current = false;
    let cursor = 0;
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    const failedIds: string[] = [];

    setBulkRefreshProgress({
      completed: 0,
      total: idsToRefresh.length,
      succeeded: 0,
      failed: 0,
    });

    const workerCount = Math.min(3, idsToRefresh.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (!bulkRefreshCancelRef.current) {
        const idx = cursor++;
        if (idx >= idsToRefresh.length) break;
        const id = idsToRefresh[idx];

        setRefreshingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        try {
          const updated = await api.refreshBookmark(id);
          succeeded += 1;
          setBookmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
          setActiveBookmark((curr) => (curr && curr.id === updated.id ? updated : curr));
        } catch {
          failed += 1;
          failedIds.push(id);
        } finally {
          completed += 1;
          setRefreshingIds((prev) => prev.filter((item) => item !== id));
          setBulkRefreshProgress({
            completed,
            total: idsToRefresh.length,
            succeeded,
            failed,
          });
        }
      }
    });

    await Promise.all(workers);

    setBulkRefreshProgress(null);
    setRefreshingIds([]);
    loadWorkspace();

    if (bulkRefreshCancelRef.current) {
      showToast(`Обновление остановлено (обновлено: ${succeeded} из ${idsToRefresh.length})`);
    } else if (failed === 0) {
      setSelectedIds([]);
      showToast(`Обновлено превью и описаний: ${succeeded}`);
    } else if (succeeded > 0) {
      setSelectedIds(failedIds);
      showToast(`Обновлено: ${succeeded} из ${idsToRefresh.length} (не удалось: ${failed})`);
    } else {
      showToast('Не удалось обновить превью для выбранных закладок');
    }
  }, [selectedIds, bookmarks, bulkRefreshProgress, loadWorkspace, showToast]);

  const handleBulkCheckLinks = useCallback(async () => {
    const idsToCheck = selectedIds.filter((id) => {
      const bm = bookmarks.find((item) => item.id === id);
      return bm ? Boolean(bm.url) : true;
    });
    if (!idsToCheck.length || bulkRefreshProgress) {
      if (selectedIds.length > 0 && idsToCheck.length === 0) {
        showToast('Для заметок и списков задач проверка ссылок не требуется');
      }
      return;
    }

    bulkRefreshCancelRef.current = false;
    let cursor = 0;
    let completed = 0;
    let okCount = 0;
    let localBlockedCount = 0;
    let brokenCount = 0;
    let failedCount = 0;

    setBulkRefreshProgress({
      mode: 'check',
      completed: 0,
      total: idsToCheck.length,
      succeeded: 0,
      failed: 0,
    });

    const workerCount = Math.min(2, idsToCheck.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (!bulkRefreshCancelRef.current) {
        const idx = cursor++;
        if (idx >= idsToCheck.length) break;
        const id = idsToCheck[idx];

        setRefreshingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        try {
          const { bookmark: updated, check } = await api.checkBookmarkLink(id);
          if (check.overall === 'ok' || check.overall === 'local_only') {
            okCount += 1;
          } else if (check.overall === 'local_blocked') {
            localBlockedCount += 1;
          } else if (check.overall === 'broken') {
            brokenCount += 1;
          }
          setBookmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
          setActiveBookmark((curr) => (curr && curr.id === updated.id ? updated : curr));
        } catch {
          failedCount += 1;
        } finally {
          completed += 1;
          setRefreshingIds((prev) => prev.filter((item) => item !== id));
          setBulkRefreshProgress({
            mode: 'check',
            completed,
            total: idsToCheck.length,
            succeeded: okCount + localBlockedCount,
            failed: brokenCount + failedCount,
          });
        }
      }
    });

    await Promise.all(workers);

    setBulkRefreshProgress(null);
    setRefreshingIds([]);
    loadWorkspace();

    if (bulkRefreshCancelRef.current) {
      showToast(`Проверка остановлена (${completed} из ${idsToCheck.length})`);
    } else {
      setSelectedIds([]);
      const parts = [`Проверено: ${completed}`];
      if (okCount > 0) parts.push(`доступно: ${okCount}`);
      if (localBlockedCount > 0) parts.push(`извне: ${localBlockedCount}`);
      if (brokenCount > 0) parts.push(`сломано: ${brokenCount}`);
      showToast(parts.join(' · '));
    }
  }, [selectedIds, bookmarks, bulkRefreshProgress, loadWorkspace, showToast]);

  // Compute current workspace header title
  const getHeaderTitle = () => {
    if (activeTag) return `#${activeTag}`;
    if (activeFilter) return FILTER_TITLES[activeFilter];
    if (scope === 'unsorted') return 'Несортированные';
    if (scope === 'favorites') return 'Избранное';
    if (scope === 'trash') return 'Корзина';
    if (scope === 'collection' && activeCollectionId) {
      return collections.find((c) => c.id === activeCollectionId)?.title || 'Коллекция';
    }
    return 'Все закладки';
  };

  const sortedTags = useMemo(() => {
    const copy = [...tags];
    if (preferences.tagSort === 'name') {
      copy.sort((a, b) => a.tag.localeCompare(b.tag, 'ru'));
    } else {
      copy.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ru'));
    }
    return copy;
  }, [tags, preferences.tagSort]);

  if (!authStatus) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-[#202124] text-[13px] text-[#8B929E]">
        Загрузка Dropkeep...
      </div>
    );
  }

  if (authStatus.authEnabled && !authStatus.authenticated) {
    return (
      <AuthGate
        onAuthenticated={() => {
          setAuthStatus((prev) => (prev ? { ...prev, authenticated: true } : prev));
        }}
      />
    );
  }

  return (
    <div className="dk-app-shell h-screen w-screen overflow-hidden flex bg-white dark:bg-[#202124] text-[#181A1F] dark:text-[#F1F3F5]">
      {/* Left Navigation Sidebar */}
      <Sidebar
        collections={collections}
        tags={sortedTags}
        stats={stats}
        scope={scope}
        activeCollectionId={activeCollectionId}
        activeFilter={activeFilter}
        activeTag={activeTag}
        darkMode={darkMode}
        darkSidebar={preferences.theme === 'dark-sidebar'}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={handleCloseMobileSidebar}
        onToggleTheme={handleToggleTheme}
        onOpenSettings={handleOpenSettings}
        onSelectScope={handleSelectScope}
        onSelectFilter={handleSelectFilter}
        onSelectTag={handleSelectTag}
        onCreateCollection={handleCreateCollection}
        onEditCollection={handleEditCollection}
        onDeleteCollection={handleDeleteCollection}
        onDeleteTag={handleDeleteTag}
        onDropBookmark={handleDropBookmark}
      />

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        <TopBar
          title={getHeaderTitle()}
          count={bookmarks.length}
          selectedCount={selectedIds.length}
          search={search}
          aiConfigured={aiConfigured}
          smartSearchMode={smartSearchMode}
          smartSearchLoading={smartSearchLoading}
          viewMode={viewMode}
          displayFields={displayFields}
          sortMode={sortMode}
          columnCount={columnCount}
          onSearchChange={handleSearchChange}
          onToggleSmartSearch={handleToggleSmartSearch}
          onRunSmartSearch={() => runSmartSearch()}
          onViewModeChange={handleViewModeChange}
          onToggleDisplayField={handleToggleDisplayField}
          onSortModeChange={setSortMode}
          onColumnCountChange={handleColumnCountChange}
          onToggleSelectAll={handleToggleSelectAll}
          onOpenAddModal={handleOpenAddModal}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        />

        {/* Mobile Toolbar: Search (+ optional AI Smart Search) + Unified Raindrop View Menu + Sort */}
        <div className="relative z-20 sm:hidden px-3.5 py-2 border-b border-[#E6E8EC] dark:border-[#2B2D32] space-y-2 bg-white dark:bg-[#202124] shrink-0">
          <div className="relative">
            {smartSearchMode && aiConfigured ? (
              smartSearchLoading ? (
                <Loader2 className="w-4 h-4 text-[#0B72E7] dark:text-[#58A6FF] animate-spin absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              ) : (
                <Sparkles className="w-4 h-4 text-[#0B72E7] dark:text-[#58A6FF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              )
            ) : (
              <Search className="w-4 h-4 text-[#8B929E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            )}
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && smartSearchMode && aiConfigured && search.trim().length >= 2) {
                  e.preventDefault();
                  runSmartSearch();
                }
              }}
              placeholder={
                smartSearchMode && aiConfigured
                  ? 'Умный поиск по смыслу...'
                  : 'Поиск закладок, #тегов...'
              }
              className={`w-full h-9 pl-9 ${
                aiConfigured ? 'pr-24' : 'pr-8'
              } rounded-lg text-[13px] bg-[#F4F5F7] dark:bg-[#2A2C31] border ${
                smartSearchMode && aiConfigured
                  ? 'border-[#0B72E7]/60 bg-white dark:bg-[#202124]'
                  : 'border-transparent'
              } focus:outline-none focus:ring-1 focus:ring-[#0B72E7]`}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {search && (
                <button
                  type="button"
                  onClick={() => handleSearchChange('')}
                  aria-label="Очистить поиск"
                  className="p-1 text-[#8B929E]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {aiConfigured && (
                <button
                  type="button"
                  disabled={smartSearchLoading}
                  onClick={() => {
                    if (smartSearchMode && search.trim().length >= 2) {
                      runSmartSearch();
                    } else {
                      handleToggleSmartSearch();
                    }
                  }}
                  className={`h-6 px-2 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1 ${
                    smartSearchMode
                      ? 'bg-[#0B72E7] text-white'
                      : 'text-[#5F6672] dark:text-[#A1A7B3]'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{smartSearchMode && search.trim().length >= 2 ? 'Найти' : 'ИИ'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            {/* Mobile Unified Raindrop View / Fields / Columns Menu */}
            <ViewSettingsMenu
              compact
              align="left"
              viewMode={viewMode}
              displayFields={displayFields}
              columnCount={columnCount}
              onViewModeChange={handleViewModeChange}
              onToggleField={handleToggleDisplayField}
              onColumnCountChange={handleColumnCountChange}
            />

            {/* Mobile Sort selector */}
            <select
              aria-label="Сортировка"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="h-8 px-2.5 rounded-lg text-[12px] font-medium bg-[#F4F5F7] dark:bg-[#2A2C31] text-[#2C313A] dark:text-[#D3D7DF] focus:outline-none focus:ring-1 focus:ring-[#0B72E7] max-w-[170px] truncate"
            >
              {(Object.keys(SORT_LABELS) as SortMode[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Smart Search Active Status / Error Strip */}
        {aiConfigured && (smartSearchMeta || smartSearchError) && (
          <div className="px-4 lg:px-6 py-2 border-b border-[#ECEEF2] dark:border-[#2B2D32] flex flex-wrap items-center justify-between gap-2 text-[12.5px] bg-[#F5F9FF] dark:bg-[#192334] shrink-0">
            {smartSearchError ? (
              <span className="text-red-600 dark:text-red-300">{smartSearchError}</span>
            ) : smartSearchMeta ? (
              <div className="flex items-center gap-2 text-[#2C313A] dark:text-[#D3D7DF] min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-[#0B72E7] dark:text-[#58A6FF] shrink-0" />
                <span className="truncate">
                  Умный поиск ИИ по запросу <strong className="font-medium">«{smartSearchMeta.query}»</strong>: найдено {bookmarks.length} из {smartSearchMeta.scannedCount}
                </span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleExitSmartSearch}
              className="text-[12px] font-medium text-[#0B72E7] dark:text-[#58A6FF] hover:underline whitespace-nowrap shrink-0"
            >
              Обычный поиск
            </button>
          </div>
        )}

        {/* Active Secondary Filter Bar (when tag or smart filter is active alongside a collection) */}
        {(activeFilter || activeTag) && (
          <div className="px-4 lg:px-6 py-2 border-b border-[#ECEEF2] dark:border-[#2B2D32] flex items-center gap-3 text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] bg-[#FAFBFD] dark:bg-[#1D1E22] shrink-0">
            <span>Активные фильтры:</span>
            {activeFilter && (
              <button
                type="button"
                onClick={() => setActiveFilter('')}
                className="inline-flex items-center gap-1 text-[#0B72E7] dark:text-[#58A6FF] hover:underline font-medium"
              >
                <span>{FILTER_TITLES[activeFilter]}</span>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {activeTag && (
              <button
                type="button"
                onClick={() => setActiveTag(null)}
                className="inline-flex items-center gap-1 text-[#0B72E7] dark:text-[#58A6FF] hover:underline font-medium"
              >
                <span>#{activeTag}</span>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Bookmarks Workspace */}
        <BookmarkViews
          bookmarks={bookmarks}
          collections={collections}
          viewMode={viewMode}
          displayFields={displayFields}
          columnCount={columnCount}
          fallbackCoverStyle={preferences.fallbackCoverStyle}
          clickAction={preferences.clickAction}
          cardButtons={preferences.cardButtons}
          showTypeBadge={preferences.showTypeBadge}
          scope={scope}
          loading={loading || smartSearchLoading}
          activeBookmarkId={activeBookmark?.id || null}
          selectedIds={selectedIds}
          savingPdfId={savingPdfId}
          refreshingIds={refreshingIds}
          bulkRefreshProgress={bulkRefreshProgress}
          onSelectBookmark={handleSelectBookmark}
          onEditBookmark={handleEditBookmark}
          onToggleSelectId={handleToggleSelectId}
          onSelectAll={handleSelectAll}
          onClearSelection={handleClearSelection}
          onToggleFavorite={handleToggleFavorite}
          onUpdateTodoItems={handleUpdateTodoItems}
          onOpenPdf={handleOpenPdf}
          onSaveOfflinePdf={handleSaveOfflinePdf}
          onTrashBookmark={handleTrashBookmark}
          onRestoreBookmark={handleRestoreBookmark}
          onDeletePermanent={handleDeletePermanent}
          onEmptyTrash={handleEmptyTrash}
          onBulkAction={handleBulkAction}
          onBulkRefresh={handleBulkRefresh}
          onBulkCheck={handleBulkCheckLinks}
          onCancelBulkRefresh={handleCancelBulkRefresh}
          onClickTag={handleSelectTag}
          onOpenAddModal={() =>
            handleOpenAddModal(
              activeFilter === 'note' ? 'note' : activeFilter === 'todo' ? 'todo' : 'single'
            )
          }
        />
      </main>

      {/* Right Split-View Inspector & Reader Panel */}
      {activeBookmark && (
        <InspectorPanel
          bookmark={activeBookmark}
          collections={collections}
          allTags={sortedTags}
          aiConfigured={aiConfigured}
          savingPdf={savingPdfId === activeBookmark.id}
          fallbackCoverStyle={preferences.fallbackCoverStyle}
          mode={inspectorMode}
          onModeChange={setInspectorMode}
          onClose={() => setActiveBookmark(null)}
          onUpdated={(updated) => {
            setActiveBookmark(updated);
            setBookmarks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
            loadWorkspace();
          }}
          onUpdateTodoItems={handleUpdateTodoItems}
          onClickTag={handleSelectTag}
          onOpenPdf={(bm) => setPdfViewerBookmark(bm)}
          onSaveOfflinePdf={handleSaveOfflinePdf}
          onDeleteOfflinePdf={handleDeleteOfflinePdf}
          onTrash={handleTrashBookmark}
          onRestore={handleRestoreBookmark}
          onDeletePermanent={handleDeletePermanent}
        />
      )}

      {/* Offline PDF Viewer Modal */}
      {pdfViewerBookmark && (
        <PdfViewerModal
          bookmark={pdfViewerBookmark}
          refreshing={savingPdfId === pdfViewerBookmark.id}
          onClose={() => setPdfViewerBookmark(null)}
          onRefreshSnapshot={() => handleSaveOfflinePdf(pdfViewerBookmark)}
        />
      )}

      {/* Modals */}
      {addModalOpen && (
        <AddBookmarkModal
          collections={collections}
          defaultCollectionId={scope === 'collection' ? activeCollectionId : null}
          aiConfigured={aiConfigured}
          initialMode={addModalMode}
          initialDraft={addModalDraft}
          onClose={() => {
            setAddModalOpen(false);
            setAddModalDraft(null);
          }}
          onCreated={(created) => {
            showToast(
              created.type === 'note'
                ? 'Заметка создана'
                : created.type === 'todo'
                  ? 'Список задач создан'
                  : created.snapshot_size > 0
                    ? 'Закладка и PDF-снимок сохранены'
                    : 'Закладка добавлена'
            );
            setInspectorMode(created.type === 'note' || created.type === 'todo' ? 'preview' : 'edit');
            setActiveBookmark(created);
            refreshAll();
          }}
          onBatchDone={() => {
            showToast('Ссылки добавлены');
            refreshAll();
          }}
        />
      )}

      {collectionModalState.open && (
        <CollectionModal
          collections={collections}
          editingCollection={collectionModalState.editing}
          defaultParentId={collectionModalState.parentId}
          onClose={() => setCollectionModalState({ open: false, editing: null, parentId: null })}
          onSaved={() => {
            showToast(collectionModalState.editing ? 'Коллекция обновлена' : 'Коллекция создана');
            refreshAll();
          }}
        />
      )}

      {settingsModalOpen && (
        <SettingsModal
          stats={stats}
          authStatus={authStatus}
          preferences={preferences}
          onUpdatePreferences={handleUpdatePreferences}
          onClose={() => setSettingsModalOpen(false)}
          onDataChanged={refreshAll}
          onAuthChanged={setAuthStatus}
        />
      )}

      {/* Clean In-App Confirmation Dialog (no window.confirm) */}
      {confirmState && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setConfirmState(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[380px] rounded-xl bg-white dark:bg-[#222429] border border-[#E6E8EC] dark:border-[#34373E] shadow-2xl p-5 space-y-4"
          >
            <div>
              <h3 className="text-[15px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                {confirmState.title}
              </h3>
              <p className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] mt-1.5 leading-relaxed">
                {confirmState.message}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#30333A]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmState.onConfirm;
                  setConfirmState(null);
                  await action();
                }}
                className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[13px] font-medium"
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-[#181A1F] dark:bg-[#F1F3F5] text-white dark:text-[#181A1F] text-[13px] font-medium shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}
