import { useEffect, useRef, useState } from 'react';
import {
  AlignJustify,
  Check,
  ChevronDown,
  Columns3,
  LayoutGrid,
  List,
} from 'lucide-react';
import type { DisplayFields, ViewMode } from '../types';

export const VIEW_MODES: Array<{ id: ViewMode; label: string; icon: typeof List }> = [
  { id: 'list', label: 'Список', icon: List },
  { id: 'grid', label: 'Карточки', icon: LayoutGrid },
  { id: 'headlines', label: 'Заголовки', icon: AlignJustify },
  { id: 'masonry', label: 'Плитка', icon: Columns3 },
];

const FIELD_ITEMS: Array<{ key: keyof DisplayFields; label: string }> = [
  { key: 'cover', label: 'Обложка' },
  { key: 'title', label: 'Название' },
  { key: 'note', label: 'Заметка' },
  { key: 'excerpt', label: 'Описание' },
  { key: 'highlights', label: 'Цитаты' },
  { key: 'tags', label: 'Теги' },
  { key: 'info', label: 'Информация о закладке' },
];

interface ViewSettingsMenuProps {
  viewMode: ViewMode;
  displayFields: DisplayFields;
  columnCount: number;
  align?: 'left' | 'right';
  compact?: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onToggleField: (field: keyof DisplayFields) => void;
  onColumnCountChange: (cols: number) => void;
}

export function ViewSettingsMenu({
  viewMode,
  displayFields,
  columnCount,
  align = 'right',
  compact = false,
  onViewModeChange,
  onToggleField,
  onColumnCountChange,
}: ViewSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeMode = VIEW_MODES.find((m) => m.id === viewMode) || VIEW_MODES[1];
  const ActiveIcon = activeMode.icon;
  const supportsColumns = viewMode === 'grid' || viewMode === 'masonry';

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Настройки вида отображения"
        className={`rounded-lg flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
          compact
            ? 'h-8 px-2.5 text-[12px] bg-[#F4F5F7] dark:bg-[#2A2C31] text-[#2C313A] dark:text-[#E5E7EB]'
            : 'h-9 px-2.5 text-[12.5px] text-[#5F6672] dark:text-[#C4C9D4] hover:bg-[#F3F4F6] dark:hover:bg-[#2B2D32] hover:text-[#181A1F] dark:hover:text-white'
        } ${open ? 'bg-[#F3F4F6] dark:bg-[#2B2D32] text-[#181A1F] dark:text-white' : ''}`}
      >
        <ActiveIcon className="w-4 h-4 shrink-0" strokeWidth={1.85} />
        <span>{activeMode.label}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
      </button>

      {open && (
        <div
          className={`absolute ${
            align === 'left' ? 'left-0' : 'right-0'
          } top-[calc(100%+6px)] w-[256px] rounded-xl bg-white dark:bg-[#25262A] border border-[#E6E8EC] dark:border-[#363840] shadow-xl py-2 z-40 select-none`}
        >
          {/* Section 1: 4 View Modes */}
          <div className="px-1.5 space-y-0.5">
            {VIEW_MODES.map((m) => {
              const Icon = m.icon;
              const isSelected = viewMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onViewModeChange(m.id)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ${
                    isSelected
                      ? 'bg-[#EDF4FE] dark:bg-[#192B44] text-[#0B72E7] dark:text-[#7BB4FA] font-medium'
                      : 'text-[#2C313A] dark:text-[#E2E5EC] hover:bg-[#F4F5F7] dark:hover:bg-[#303238]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" strokeWidth={1.85} />
                    <span>{m.label}</span>
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-[#ECEEF2] dark:border-[#34363E]" />

          {/* Section 2: Raindrop "Показать в ..." Checklist */}
          <div className="px-3.5 pb-1">
            <div className="text-[12px] font-medium text-[#8B929E] dark:text-[#8E94A0] mb-2">
              Показать в {activeMode.label}
            </div>
            <div className="space-y-1">
              {FIELD_ITEMS.map((item) => {
                const checked = displayFields[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => onToggleField(item.key)}
                    className="w-full flex items-center gap-2.5 py-1 text-left rounded-md hover:bg-[#F4F5F7] dark:hover:bg-[#303238] -mx-1.5 px-1.5 transition-colors"
                  >
                    <span
                      className={`w-4 h-4 rounded-[4px] flex items-center justify-center shrink-0 transition-colors ${
                        checked
                          ? 'bg-[#0B72E7] dark:bg-[#7BB4FA] text-white dark:text-[#181A1F]'
                          : 'border border-[#C5CCD6] dark:border-[#555965] bg-transparent'
                      }`}
                    >
                      {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    <span className="text-[13px] text-[#181A1F] dark:text-[#ECEEF2]">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Column Count at Bottom (Cards & Masonry only, clean buttons without slider) */}
          {supportsColumns && (
            <>
              <div className="my-2 border-t border-[#ECEEF2] dark:border-[#34363E]" />
              <div className="px-3.5 pt-0.5 pb-1">
                <div className="flex items-center justify-between text-[12px] text-[#8B929E] dark:text-[#8E94A0] mb-2">
                  <span>Столбцы</span>
                  <span className="tabular-nums">
                    {columnCount === 0 ? 'Авто' : columnCount}
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => {
                    const active = columnCount === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        title={n === 0 ? 'Автоматически' : `${n} столбц.`}
                        onClick={() => onColumnCountChange(n)}
                        className={`h-7 rounded-md text-[12px] font-medium tabular-nums transition-colors ${
                          active
                            ? 'bg-[#0B72E7] dark:bg-[#7BB4FA] text-white dark:text-[#181A1F]'
                            : 'bg-[#F3F4F6] dark:bg-[#31333B] text-[#2C313A] dark:text-[#D3D7DF] hover:bg-[#E5E7EB] dark:hover:bg-[#3D404A]'
                        }`}
                      >
                        {n === 0 ? 'А' : n}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
