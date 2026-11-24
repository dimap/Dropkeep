import { memo, useMemo, useState, type DragEvent } from 'react';
import {
  Bookmark,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FolderPlus,
  HardDrive,
  Hash,
  Highlighter,
  Image as ImageIcon,
  Inbox,
  Link2,
  Moon,
  Pencil,
  PlayCircle,
  Plus,
  Settings,
  Star,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Collection, NavScope, SmartFilter, SmartStats, TagCount } from '../types';
import { getCollectionIcon } from '../utils/icons';

interface SidebarProps {
  collections: Collection[];
  tags: TagCount[];
  stats: SmartStats;
  scope: NavScope;
  activeCollectionId: string | null;
  activeFilter: SmartFilter;
  activeTag: string | null;
  darkMode: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onSelectScope: (scope: NavScope, collectionId?: string | null) => void;
  onSelectFilter: (filter: SmartFilter) => void;
  onSelectTag: (tag: string) => void;
  onCreateCollection: (parentId: string | null) => void;
  onEditCollection: (collection: Collection) => void;
  onDeleteCollection: (collection: Collection) => void;
  onDeleteTag: (tag: string) => void;
  onDropBookmark: (bookmarkId: string, target: { collectionId?: string | null; favorite?: boolean; trash?: boolean }) => void;
}

export const Sidebar = memo(function Sidebar({
  collections,
  tags,
  stats,
  scope,
  activeCollectionId,
  activeFilter,
  activeTag,
  darkMode,
  mobileOpen,
  onCloseMobile,
  onToggleTheme,
  onOpenSettings,
  onSelectScope,
  onSelectFilter,
  onSelectTag,
  onCreateCollection,
  onEditCollection,
  onDeleteCollection,
  onDeleteTag,
  onDropBookmark,
}: SidebarProps) {
  const [collectionsOpen, setCollectionsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Build parent -> children map and O(N) deep counts once per collections change
  const { childrenByParent, deepCounts } = useMemo(() => {
    const byId = new Map<string, Collection>();
    const map = new Map<string | null, Collection[]>();
    for (const col of collections) {
      byId.set(col.id, col);
      const key = col.parent_id ?? null;
      const list = map.get(key) || [];
      list.push(col);
      map.set(key, list);
    }

    const counts = new Map<string, number>();
    const compute = (id: string, depth = 0): number => {
      if (depth > 20) return 0;
      const cached = counts.get(id);
      if (cached !== undefined) return cached;
      const own = byId.get(id)?.count || 0;
      const kids = map.get(id) || [];
      const total = own + kids.reduce((acc, k) => acc + compute(k.id, depth + 1), 0);
      counts.set(id, total);
      return total;
    };
    for (const col of collections) compute(col.id);
    return { childrenByParent: map, deepCounts: counts };
  }, [collections]);

  const getDeepCount = (id: string): number => deepCounts.get(id) || 0;

  const toggleNode = (id: string) => {
    setCollapsedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDragOver = (e: DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverKey !== key) setDragOverKey(key);
  };

  const handleDragLeave = () => {
    setDragOverKey(null);
  };

  const handleDrop = (
    e: DragEvent,
    target: { collectionId?: string | null; favorite?: boolean; trash?: boolean }
  ) => {
    e.preventDefault();
    setDragOverKey(null);
    const bookmarkId = e.dataTransfer.getData('text/dropkeep-bookmark');
    if (bookmarkId) {
      onDropBookmark(bookmarkId, target);
    }
  };

  const isSystemActive = (target: NavScope) =>
    scope === target && !activeFilter && !activeTag;

  const renderCollectionTree = (parentId: string | null, depth: number) => {
    const nodes = childrenByParent.get(parentId) || [];
    return nodes.map((col) => {
      const children = childrenByParent.get(col.id) || [];
      const hasChildren = children.length > 0;
      const isExpanded = !collapsedNodes[col.id];
      const Icon = getCollectionIcon(col.icon);
      const isActive =
        scope === 'collection' && activeCollectionId === col.id && !activeFilter && !activeTag;
      const isDragTarget = dragOverKey === `col-${col.id}`;
      const totalCount = getDeepCount(col.id);

      return (
        <div key={col.id}>
          <div
            onDragOver={(e) => handleDragOver(e, `col-${col.id}`)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, { collectionId: col.id })}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            className={`group flex items-center gap-1.5 pr-2 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer select-none ${
              isDragTarget
                ? 'bg-[#0B72E7]/15 ring-1 ring-[#0B72E7] text-[#0B72E7] dark:text-[#60A5FA]'
                : isActive
                  ? 'bg-[#E8F1FD] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#58A6FF] font-medium'
                  : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]'
            }`}
            onClick={() => {
              onSelectScope('collection', col.id);
              onCloseMobile();
            }}
          >
            <button
              type="button"
              aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleNode(col.id);
              }}
              className={`w-4 h-4 flex items-center justify-center rounded text-[#8B929E] hover:text-[#181A1F] dark:hover:text-white shrink-0 ${
                hasChildren ? 'visible' : 'invisible'
              }`}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            <Icon
              className="w-4 h-4 shrink-0"
              style={{ color: isActive ? undefined : col.color }}
              strokeWidth={1.85}
            />

            <span className="truncate flex-1">{col.title}</span>

            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                title="Создать подколлекцию"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateCollection(col.id);
                }}
                className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[#5F6672] dark:text-[#A1A7B3]"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Редактировать коллекцию"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditCollection(col);
                }}
                className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[#5F6672] dark:text-[#A1A7B3]"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Удалить коллекцию"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteCollection(col);
                }}
                className="p-0.5 rounded hover:bg-red-500/15 text-[#5F6672] hover:text-red-600 dark:text-[#A1A7B3] dark:hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-[11px] tabular-nums text-[#8B929E] dark:text-[#747B88] group-hover:hidden shrink-0">
              {totalCount}
            </span>
          </div>

          {hasChildren && isExpanded && renderCollectionTree(col.id, depth + 1)}
        </div>
      );
    });
  };

  const smartFilters: Array<{
    key: SmartFilter;
    label: string;
    count: number;
    icon: typeof BookOpen;
  }> = [
    { key: 'article', label: 'Статьи', count: stats.articles, icon: BookOpen },
    { key: 'video', label: 'Видео', count: stats.videos, icon: PlayCircle },
    { key: 'image', label: 'Изображения', count: stats.images, icon: ImageIcon },
    { key: 'link', label: 'Ссылки', count: stats.links, icon: Link2 },
    { key: 'document', label: 'Документы', count: stats.documents, icon: FileText },
    { key: 'highlights', label: 'С заметками', count: stats.highlights, icon: Highlighter },
    { key: 'offline', label: 'Офлайн PDF', count: stats.offline, icon: HardDrive },
    { key: 'untagged', label: 'Без тегов', count: stats.untagged, icon: Tag },
    { key: 'duplicates', label: 'Дубликаты', count: stats.duplicates, icon: Copy },
  ];

  const sidebarContent = (
    <aside className="w-[260px] h-full flex flex-col bg-[#F6F7F9] dark:bg-[#1A1B1E] border-r border-[#E6E8EC] dark:border-[#2B2D32] select-none shrink-0">
      {/* Brand + Utility Row */}
      <div className="h-[54px] px-3.5 flex items-center justify-between border-b border-[#E6E8EC]/80 dark:border-[#2B2D32] shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectScope('all');
            onCloseMobile();
          }}
          className="flex items-center gap-2 text-left group focus:outline-none"
        >
          <span className="w-7 h-7 rounded-lg bg-[#0B72E7] flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3.2C12 3.2 6.2 10.1 6.2 14.3C6.2 17.5 8.8 20.1 12 20.1C15.2 20.1 17.8 17.5 17.8 14.3C17.8 10.1 12 3.2 12 3.2Z"
                fill="white"
              />
            </svg>
          </span>
          <span className="text-[15px] font-bold tracking-[-0.02em] text-[#181A1F] dark:text-[#F1F3F5] whitespace-nowrap">
            Dropkeep
          </span>
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onToggleTheme}
            title={darkMode ? 'Светлая тема' : 'Тёмная тема'}
            aria-label={darkMode ? 'Включить светлую тему' : 'Включить тёмную тему'}
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C] hover:text-[#181A1F] dark:hover:text-white transition-colors"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Настройки, импорт и Docker"
            aria-label="Открыть настройки"
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C] hover:text-[#181A1F] dark:hover:text-white transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Закрыть меню"
            className="lg:hidden w-8 h-8 rounded-md flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Navigation */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5">
        {/* System Views */}
        <nav aria-label="Основные разделы" className="space-y-0.5">
          <button
            type="button"
            onClick={() => {
              onSelectScope('all');
              onCloseMobile();
            }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
              isSystemActive('all')
                ? 'bg-[#E8F1FD] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#58A6FF] font-medium'
                : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]'
            }`}
          >
            <Bookmark className="w-4 h-4 shrink-0" strokeWidth={1.85} />
            <span className="flex-1 text-left truncate">Все закладки</span>
            <span className="text-[11px] tabular-nums text-[#8B929E] dark:text-[#747B88]">{stats.all}</span>
          </button>

          <button
            type="button"
            onDragOver={(e) => handleDragOver(e, 'sys-unsorted')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, { collectionId: null })}
            onClick={() => {
              onSelectScope('unsorted');
              onCloseMobile();
            }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
              dragOverKey === 'sys-unsorted'
                ? 'bg-[#0B72E7]/15 ring-1 ring-[#0B72E7] text-[#0B72E7]'
                : isSystemActive('unsorted')
                  ? 'bg-[#E8F1FD] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#58A6FF] font-medium'
                  : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]'
            }`}
          >
            <Inbox className="w-4 h-4 shrink-0" strokeWidth={1.85} />
            <span className="flex-1 text-left truncate">Несортированные</span>
            <span className="text-[11px] tabular-nums text-[#8B929E] dark:text-[#747B88]">{stats.unsorted}</span>
          </button>

          <button
            type="button"
            onDragOver={(e) => handleDragOver(e, 'sys-favorites')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, { favorite: true })}
            onClick={() => {
              onSelectScope('favorites');
              onCloseMobile();
            }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
              dragOverKey === 'sys-favorites'
                ? 'bg-[#0B72E7]/15 ring-1 ring-[#0B72E7] text-[#0B72E7]'
                : isSystemActive('favorites')
                  ? 'bg-[#E8F1FD] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#58A6FF] font-medium'
                  : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]'
            }`}
          >
            <Star className="w-4 h-4 shrink-0 text-[#D97706]" strokeWidth={1.85} />
            <span className="flex-1 text-left truncate">Избранное</span>
            <span className="text-[11px] tabular-nums text-[#8B929E] dark:text-[#747B88]">{stats.favorites}</span>
          </button>

          <button
            type="button"
            onDragOver={(e) => handleDragOver(e, 'sys-trash')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, { trash: true })}
            onClick={() => {
              onSelectScope('trash');
              onCloseMobile();
            }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
              dragOverKey === 'sys-trash'
                ? 'bg-red-500/15 ring-1 ring-red-500 text-red-600'
                : isSystemActive('trash')
                  ? 'bg-[#E8F1FD] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#58A6FF] font-medium'
                  : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]'
            }`}
          >
            <Trash2 className="w-4 h-4 shrink-0" strokeWidth={1.85} />
            <span className="flex-1 text-left truncate">Корзина</span>
            <span className="text-[11px] tabular-nums text-[#8B929E] dark:text-[#747B88]">{stats.trash}</span>
          </button>
        </nav>

        {/* Collections Section */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <button
              type="button"
              onClick={() => setCollectionsOpen((v) => !v)}
              className="flex items-center gap-1 text-[12px] font-semibold text-[#5F6672] dark:text-[#8E96A4] hover:text-[#181A1F] dark:hover:text-white transition-colors"
            >
              {collectionsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <span>Коллекции</span>
            </button>
            <button
              type="button"
              onClick={() => onCreateCollection(null)}
              title="Новая коллекция"
              aria-label="Создать коллекцию"
              className="w-6 h-6 rounded flex items-center justify-center text-[#5F6672] dark:text-[#8E96A4] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C] hover:text-[#181A1F] dark:hover:text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {collectionsOpen && (
            <div className="space-y-0.5">
              {collections.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onCreateCollection(null)}
                  className="w-full text-left px-3 py-2 text-[12px] text-[#8B929E] hover:text-[#0B72E7] transition-colors"
                >
                  Создать первую коллекцию
                </button>
              ) : (
                renderCollectionTree(null, 0)
              )}
            </div>
          )}
        </div>

        {/* Smart Filters Section */}
        <div>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1 px-2 mb-1 text-[12px] font-semibold text-[#5F6672] dark:text-[#8E96A4] hover:text-[#181A1F] dark:hover:text-white transition-colors"
          >
            {filtersOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>Фильтры</span>
          </button>

          {filtersOpen && (
            <div className="space-y-0.5">
              {smartFilters.map((f) => {
                const Icon = f.icon;
                const isActive = activeFilter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      onSelectFilter(isActive ? '' : f.key);
                      onCloseMobile();
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                      isActive
                        ? 'bg-[#E8F1FD] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#58A6FF] font-medium'
                        : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0 opacity-75" strokeWidth={1.8} />
                    <span className="flex-1 text-left truncate">{f.label}</span>
                    <span className="text-[11px] tabular-nums text-[#8B929E] dark:text-[#747B88]">{f.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div>
          <button
            type="button"
            onClick={() => setTagsOpen((v) => !v)}
            className="flex items-center gap-1 px-2 mb-1 text-[12px] font-semibold text-[#5F6672] dark:text-[#8E96A4] hover:text-[#181A1F] dark:hover:text-white transition-colors"
          >
            {tagsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>Теги</span>
            <span className="ml-1 text-[11px] font-normal tabular-nums text-[#8B929E]">({tags.length})</span>
          </button>

          {tagsOpen && (
            <div className="space-y-0.5">
              {tags.length === 0 ? (
                <p className="px-3 py-1.5 text-[12px] text-[#8B929E]">Тегов пока нет</p>
              ) : (
                tags.map((item) => {
                  const isActive = activeTag === item.tag;
                  return (
                    <div
                      key={item.tag}
                      onClick={() => {
                        onSelectTag(item.tag);
                        onCloseMobile();
                      }}
                      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-[#E8F1FD] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#58A6FF] font-medium'
                          : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#EBEDF0] dark:hover:bg-[#25272C]'
                      }`}
                    >
                      <Hash className="w-3.5 h-3.5 shrink-0 text-[#8B929E]" />
                      <span className="flex-1 truncate">{item.tag}</span>
                      <button
                        type="button"
                        title="Удалить тег"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTag(item.tag);
                        }}
                        className="hidden group-hover:flex p-0.5 rounded hover:bg-red-500/15 text-[#8B929E] hover:text-red-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <span className="text-[11px] tabular-nums text-[#8B929E] dark:text-[#747B88] group-hover:hidden">
                        {item.count}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <div className="hidden lg:block h-full shrink-0">{sidebarContent}</div>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
});
