import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react';
import type { CardColor, TodoItem, TodoPriority } from '../types';
import {
  CARD_COLOR_OPTIONS,
  createTodoItem,
  getTodoSummary,
  TODO_PRIORITY_META,
  TODO_PRIORITY_ORDER,
} from '../utils/notes';

interface CardColorPickerProps {
  value: CardColor;
  onChange: (color: CardColor) => void;
  label?: string;
}

export function CardColorPicker({
  value,
  onChange,
  label = 'Цвет фона',
}: CardColorPickerProps) {
  return (
    <div>
      {label && (
        <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1.5">
          {label}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {CARD_COLOR_OPTIONS.map((opt) => {
          const isSelected = value === opt.id;
          return (
            <button
              key={opt.id || 'default'}
              type="button"
              onClick={() => onChange(opt.id)}
              title={opt.label}
              aria-label={`Цвет фона: ${opt.label}`}
              aria-pressed={isSelected}
              style={{
                backgroundColor: opt.swatch,
                borderColor: isSelected ? '#0B72E7' : opt.swatchBorder,
              }}
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform cursor-pointer ${
                isSelected ? 'scale-110 ring-2 ring-[#0B72E7]/25' : 'hover:scale-105'
              }`}
            >
              {isSelected && (
                <Check
                  className={`w-3.5 h-3.5 stroke-[2.6] ${
                    opt.id === '' ? 'text-[#0B72E7]' : 'text-[#181A1F]'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface TodoItemsEditorProps {
  items: TodoItem[];
  onChange: (items: TodoItem[]) => void;
  compact?: boolean;
}

export function TodoItemsEditor({ items, onChange, compact = false }: TodoItemsEditorProps) {
  const [draftText, setDraftText] = useState('');
  const [draftPriority, setDraftPriority] = useState<TodoPriority>('medium');

  const summary = getTodoSummary(items);

  const handleAdd = () => {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    onChange([...items, createTodoItem(trimmed, draftPriority, 0)]);
    setDraftText('');
  };

  const updateItem = (id: string, patch: Partial<TodoItem>) => {
    onChange(
      items.map((item) => {
        if (item.id !== id) return item;
        const nextProgress =
          patch.progress !== undefined
            ? Math.max(0, Math.min(100, Math.round(patch.progress)))
            : item.progress;
        return { ...item, ...patch, progress: nextProgress };
      })
    );
  };

  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const copy = [...items];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    onChange(copy);
  };

  return (
    <div className="space-y-3">
      {/* Overall progress summary */}
      {summary.total > 0 && (
        <div className="p-2.5 rounded-lg bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E6E8EC] dark:border-[#32353B] space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium text-[#2C313A] dark:text-[#E5E7EB]">
              Выполнено {summary.completed} из {summary.total}
            </span>
            <span className="font-semibold tabular-nums text-[#0B72E7] dark:text-[#58A6FF]">
              {summary.avgProgress}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#E2E6EC] dark:bg-[#353840] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-200 ${
                summary.avgProgress >= 100
                  ? 'bg-[#16A34A]'
                  : 'bg-[#0B72E7] dark:bg-[#58A6FF]'
              }`}
              style={{ width: `${summary.avgProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Existing Tasks */}
      {items.length > 0 && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-0.5">
          {items.map((item, idx) => {
            const done = item.progress >= 100;
            const prioMeta = TODO_PRIORITY_META[item.priority] || TODO_PRIORITY_META.medium;
            return (
              <div
                key={item.id}
                className="p-2.5 rounded-lg bg-[#F8F9FB] dark:bg-[#25272C] border border-[#E6E8EC] dark:border-[#32353B] space-y-2"
              >
                {/* Row 1: Checkbox + Text + Reorder + Delete */}
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => updateItem(item.id, { progress: done ? 0 : 100 })}
                    title={done ? 'Снять отметку выполнения' : 'Отметить выполненной (100%)'}
                    aria-label={done ? 'Снять отметку выполнения' : 'Отметить выполненной'}
                    className={`mt-0.5 w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      done
                        ? 'bg-[#16A34A] border-[#16A34A] text-white'
                        : item.progress > 0
                          ? 'bg-[#EDF4FE] dark:bg-[#192B44] border-[#0B72E7] text-[#0B72E7] dark:text-[#58A6FF]'
                          : 'bg-white dark:bg-[#1E2024] border-[#CBD5E1] dark:border-[#4B505C] hover:border-[#0B72E7]'
                    }`}
                  >
                    {done ? (
                      <Check className="w-3 h-3 stroke-[2.8]" />
                    ) : item.progress > 0 ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    ) : null}
                  </button>

                  <input
                    type="text"
                    value={item.text}
                    onChange={(e) => updateItem(item.id, { text: e.target.value })}
                    placeholder="Текст задачи..."
                    className={`flex-1 min-w-0 bg-transparent text-[13px] leading-snug focus:outline-none ${
                      done
                        ? 'line-through text-[#8B929E] dark:text-[#747B88]'
                        : 'text-[#181A1F] dark:text-[#F1F3F5]'
                    }`}
                  />

                  <div className="flex items-center gap-0.5 shrink-0">
                    {items.length > 1 && (
                      <>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveItem(idx, -1)}
                          title="Выше"
                          aria-label="Переместить задачу выше"
                          className="w-6 h-6 rounded flex items-center justify-center text-[#8B929E] hover:text-[#181A1F] dark:hover:text-white hover:bg-[#ECEEF2] dark:hover:bg-[#32353B] disabled:opacity-30"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === items.length - 1}
                          onClick={() => moveItem(idx, 1)}
                          title="Ниже"
                          aria-label="Переместить задачу ниже"
                          className="w-6 h-6 rounded flex items-center justify-center text-[#8B929E] hover:text-[#181A1F] dark:hover:text-white hover:bg-[#ECEEF2] dark:hover:bg-[#32353B] disabled:opacity-30"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      title="Удалить задачу"
                      aria-label="Удалить задачу"
                      className="w-6 h-6 rounded flex items-center justify-center text-[#8B929E] hover:text-red-600 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Row 2: Priority + Per-task progress slider & numeric % */}
                <div className={`flex flex-wrap items-center gap-2 ${compact ? 'pl-6' : 'pl-6'}`}>
                  {/* Priority Selector */}
                  <div className="inline-flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${prioMeta.dotClass}`} />
                    <select
                      aria-label="Приоритет задачи"
                      value={item.priority}
                      onChange={(e) =>
                        updateItem(item.id, { priority: e.target.value as TodoPriority })
                      }
                      className="h-6 pl-1.5 pr-5 rounded text-[11.5px] font-medium bg-white dark:bg-[#1E2024] border border-[#DCE1E8] dark:border-[#3A3D46] text-[#2C313A] dark:text-[#D3D7DF] focus:border-[#0B72E7] focus:outline-none cursor-pointer"
                    >
                      {TODO_PRIORITY_ORDER.map((p) => (
                        <option key={p} value={p}>
                          {TODO_PRIORITY_META[p].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Per-task progress slider */}
                  <div className="flex-1 min-w-[110px] flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={item.progress}
                      aria-label={`Прогресс задачи ${item.text}`}
                      onChange={(e) =>
                        updateItem(item.id, { progress: Number(e.target.value) })
                      }
                      className="flex-1 h-1.5 accent-[#0B72E7] cursor-pointer"
                    />
                    <div className="inline-flex items-center gap-0.5 shrink-0">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={item.progress}
                        aria-label="Процент выполнения"
                        onChange={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value);
                          if (!Number.isNaN(val)) updateItem(item.id, { progress: val });
                        }}
                        className="w-11 h-6 px-1 text-right tabular-nums text-[11.5px] font-medium rounded bg-white dark:bg-[#1E2024] border border-[#DCE1E8] dark:border-[#3A3D46] text-[#181A1F] dark:text-[#F1F3F5] focus:border-[#0B72E7] focus:outline-none"
                      />
                      <span className="text-[11px] text-[#7A828F]">%</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new task row */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="Добавить задачу и нажать Enter..."
          className="flex-1 min-w-0 h-9 px-3 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:bg-white dark:focus:bg-[#202124] focus:outline-none"
        />
        <select
          aria-label="Приоритет новой задачи"
          value={draftPriority}
          onChange={(e) => setDraftPriority(e.target.value as TodoPriority)}
          className="h-9 px-2 rounded-lg text-[12px] font-medium bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] text-[#2C313A] dark:text-[#D3D7DF] focus:border-[#0B72E7] focus:outline-none shrink-0"
        >
          {TODO_PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {TODO_PRIORITY_META[p].shortLabel}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!draftText.trim()}
          title="Добавить задачу"
          aria-label="Добавить задачу"
          className="h-9 w-9 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-45 text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
