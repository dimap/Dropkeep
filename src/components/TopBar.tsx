import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Loader2,
  Menu,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { DisplayFields, SortMode, ViewMode } from '../types';
import { ViewSettingsMenu } from './ViewSettingsMenu';

interface TopBarProps {
  title: string;
  count: number;
  search: string;
  aiConfigured: boolean;
  smartSearchMode: boolean;
  smartSearchLoading: boolean;
  viewMode: ViewMode;
  displayFields: DisplayFields;
  sortMode: SortMode;
  columnCount: number;
  onSearchChange: (val: string) => void;
  onToggleSmartSearch: () => void;
  onRunSmartSearch: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onToggleDisplayField: (field: keyof DisplayFields) => void;
  onSortModeChange: (sort: SortMode) => void;
  onColumnCountChange: (cols: number) => void;
  onOpenAddModal: () => void;
  onOpenMobileSidebar: () => void;
}

export const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Сначала новые',
  oldest: 'Сначала старые',
  title_asc: 'По названию (А–Я)',
  title_desc: 'По названию (Я–А)',
  domain: 'По домену',
};

const SEARCH_HINTS = [
  { token: 'is:favorite', desc: 'Только избранное' },
  { token: 'is:offline', desc: 'Сохранённые в PDF оффлайн' },
  { token: 'type:article', desc: 'Только статьи' },
  { token: 'type:video', desc: 'Только видео' },
  { token: 'is:untagged', desc: 'Без тегов' },
  { token: 'domain:github.com', desc: 'Поиск по сайту' },
];

export function TopBar({
  title,
  count,
  search,
  aiConfigured,
  smartSearchMode,
  smartSearchLoading,
  viewMode,
  displayFields,
  sortMode,
  columnCount,
  onSearchChange,
  onToggleSmartSearch,
  onRunSmartSearch,
  onViewModeChange,
  onToggleDisplayField,
  onSortModeChange,
  onColumnCountChange,
  onOpenAddModal,
  onOpenMobileSidebar,
}: TopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Cmd/Ctrl + K shortcut to focus search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const appendSearchToken = (token: string) => {
    const next = search.trim() ? `${search.trim()} ${token} ` : `${token} `;
    onSearchChange(next);
    inputRef.current?.focus();
  };

  return (
    <header className="h-[54px] px-4 lg:px-6 flex items-center justify-between gap-3 lg:gap-4 border-b border-[#E6E8EC] dark:border-[#2B2D32] bg-white dark:bg-[#202124] shrink-0 z-20">
      {/* Left: Mobile toggle + Section Title */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Открыть боковую панель"
          className="lg:hidden w-9 h-9 rounded-md flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#2B2D32] shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-[#181A1F] dark:text-[#F1F3F5] truncate">
          {title}
        </h1>
        <span className="text-[12px] tabular-nums text-[#8B929E] dark:text-[#747B88] whitespace-nowrap shrink-0">
          {count}
        </span>
      </div>

      {/* Center: Integrated Search Bar (+ optional AI Smart Search when AI is configured) */}
      <div className="relative flex-1 max-w-[460px] hidden sm:block">
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
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && smartSearchMode && aiConfigured && search.trim().length >= 2) {
              e.preventDefault();
              setSearchFocused(false);
              onRunSmartSearch();
            }
          }}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
          placeholder={
            smartSearchMode && aiConfigured
              ? 'Умный поиск по смыслу... Нажмите Enter'
              : 'Поиск закладок, заметок, #тегов, is:offline...'
          }
          className={`w-full h-9 pl-9 ${
            aiConfigured ? 'pr-24' : 'pr-14'
          } rounded-lg text-[13px] bg-[#F4F5F7] dark:bg-[#2A2C31] text-[#181A1F] dark:text-[#F1F3F5] placeholder:text-[#8B929E] border ${
            smartSearchMode && aiConfigured
              ? 'border-[#0B72E7]/60 bg-white dark:bg-[#202124]'
              : 'border-transparent focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124]'
          } focus:outline-none transition-colors`}
        />

        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Очистить поиск"
              className="p-1 rounded text-[#8B929E] hover:text-[#181A1F] dark:hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            !aiConfigured && (
              <kbd className="px-1 text-[11px] font-mono text-[#8B929E] pointer-events-none">
                ⌘K
              </kbd>
            )
          )}

          {aiConfigured && (
            <button
              type="button"
              disabled={smartSearchLoading}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (smartSearchMode && search.trim().length >= 2) {
                  onRunSmartSearch();
                } else {
                  onToggleSmartSearch();
                  inputRef.current?.focus();
                }
              }}
              title={
                smartSearchMode
                  ? search.trim().length >= 2
                    ? 'Искать по смыслу (Enter)'
                    : 'Выключить умный поиск ИИ'
                  : 'Включить умный поиск по смыслу с ИИ'
              }
              className={`h-6 px-2 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                smartSearchMode
                  ? 'bg-[#0B72E7] text-white hover:bg-[#0960C5]'
                  : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] hover:bg-white/80 dark:hover:bg-[#353840]'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>{smartSearchMode && search.trim().length >= 2 ? 'Найти' : 'ИИ'}</span>
            </button>
          )}
        </div>

        {/* Raindrop-style search operators popover */}
        {searchFocused && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] rounded-lg bg-white dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#34373E] shadow-lg py-2 px-2 z-30">
            {aiConfigured && (
              <div className="pb-1.5 mb-1.5 border-b border-[#ECEEF2] dark:border-[#34373E]">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (smartSearchMode && search.trim().length >= 2) {
                      setSearchFocused(false);
                      onRunSmartSearch();
                    } else {
                      onToggleSmartSearch();
                    }
                  }}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] hover:bg-[#EDF4FE] dark:hover:bg-[#192B44] text-left transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#0B72E7] dark:text-[#58A6FF]">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {smartSearchMode
                        ? 'Умный поиск ИИ активен (нажмите Enter)'
                        : 'Переключить на умный поиск ИИ'}
                    </span>
                  </span>
                  <span className="text-[11px] text-[#8B929E]">
                    {smartSearchMode ? 'Выкл' : 'По смыслу'}
                  </span>
                </button>
              </div>
            )}

            {!smartSearchMode && (
              <>
                <div className="px-2 pb-1.5 text-[11px] font-medium text-[#8B929E]">
                  Операторы быстрого поиска
                </div>
                <div className="space-y-0.5">
                  {SEARCH_HINTS.map((hint) => (
                    <button
                      key={hint.token}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        appendSearchToken(hint.token);
                      }}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[12px] hover:bg-[#F4F5F7] dark:hover:bg-[#32353B] text-left transition-colors"
                    >
                      <span className="font-mono text-[#0B72E7] dark:text-[#58A6FF]">{hint.token}</span>
                      <span className="text-[#5F6672] dark:text-[#A1A7B3]">{hint.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {smartSearchMode && aiConfigured && (
              <div className="px-2 py-1 text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                Опишите своими словами, что ищете — например: «статья про бэкапы Docker» или «настройка HTTPS без проброса портов», и нажмите Enter.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Sort + Unified Raindrop View Menu + Primary Add CTA */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Sort Dropdown */}
        <div className="relative hidden md:block">
          <button
            type="button"
            onClick={() => setSortOpen((v) => !v)}
            onBlur={() => setTimeout(() => setSortOpen(false), 150)}
            className="h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[12.5px] font-medium text-[#5F6672] dark:text-[#C4C9D4] hover:bg-[#F3F4F6] dark:hover:bg-[#2B2D32] hover:text-[#181A1F] dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>{SORT_LABELS[sortMode]}</span>
          </button>

          {sortOpen && (
            <div className="absolute right-0 top-[calc(100%+4px)] w-48 rounded-lg bg-white dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#34373E] shadow-lg py-1 z-30">
              {(Object.keys(SORT_LABELS) as SortMode[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSortModeChange(key);
                    setSortOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[13px] transition-colors ${
                    sortMode === key
                      ? 'text-[#0B72E7] dark:text-[#58A6FF] bg-[#EDF4FE] dark:bg-[#192B44] font-medium'
                      : 'text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#F4F5F7] dark:hover:bg-[#32353B]'
                  }`}
                >
                  {SORT_LABELS[key]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Unified Raindrop-style View / Fields / Columns Menu (Desktop & Tablet) */}
        <div className="hidden sm:block">
          <ViewSettingsMenu
            viewMode={viewMode}
            displayFields={displayFields}
            columnCount={columnCount}
            onViewModeChange={onViewModeChange}
            onToggleField={onToggleDisplayField}
            onColumnCountChange={onColumnCountChange}
          />
        </div>

        {/* Primary Add CTA */}
        <button
          type="button"
          onClick={onOpenAddModal}
          className="h-9 px-3 sm:px-3.5 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] active:bg-[#0852A8] text-white text-[13px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" strokeWidth={2.2} />
          <span>Добавить</span>
        </button>
      </div>
    </header>
  );
}
