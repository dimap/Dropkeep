import type { CardColor, TodoItem, TodoPriority } from '../types';

export interface CardColorOption {
  id: CardColor;
  label: string;
  swatch: string;
  swatchBorder: string;
  cardClass: string;
  listClass: string;
  subtleSurfaceClass: string;
}

export const CARD_COLOR_OPTIONS: CardColorOption[] = [
  {
    id: '',
    label: 'По умолчанию',
    swatch: '#FFFFFF',
    swatchBorder: '#CBD5E1',
    cardClass:
      'bg-white dark:bg-[#26282C] border-[#E6E8EC] dark:border-[#30333A] hover:border-[#C8CFD9] dark:hover:border-[#434752]',
    listClass: 'hover:bg-[#F7F8FA] dark:hover:bg-[#26282C]',
    subtleSurfaceClass: 'bg-[#F4F5F7] dark:bg-[#2E3138]',
  },
  {
    id: 'amber',
    label: 'Янтарный',
    swatch: '#F8D46A',
    swatchBorder: '#E2B43C',
    cardClass:
      'bg-[#FEF9E7] dark:bg-[#2E2818] border-[#F0DC9B] dark:border-[#534521] hover:border-[#E2C56A] dark:hover:border-[#6D5A2B]',
    listClass: 'bg-[#FEF9E7]/75 dark:bg-[#2E2818]/75 hover:bg-[#FDF3D1] dark:hover:bg-[#38301C]',
    subtleSurfaceClass: 'bg-[#F7EBC1]/70 dark:bg-[#3B331D]',
  },
  {
    id: 'sage',
    label: 'Шалфей',
    swatch: '#78C798',
    swatchBorder: '#4CA873',
    cardClass:
      'bg-[#EFF9F2] dark:bg-[#192B22] border-[#C4E4CE] dark:border-[#2C4E3C] hover:border-[#9AD3AD] dark:hover:border-[#3B6850]',
    listClass: 'bg-[#EFF9F2]/75 dark:bg-[#192B22]/75 hover:bg-[#E1F3E7] dark:hover:bg-[#20362B]',
    subtleSurfaceClass: 'bg-[#D7EEDF]/70 dark:bg-[#233B2E]',
  },
  {
    id: 'sky',
    label: 'Небесный',
    swatch: '#72B0FA',
    swatchBorder: '#3E8AE8',
    cardClass:
      'bg-[#EFF6FF] dark:bg-[#192638] border-[#C5DCFA] dark:border-[#2B4468] hover:border-[#99C3F7] dark:hover:border-[#3B5E8E]',
    listClass: 'bg-[#EFF6FF]/75 dark:bg-[#192638]/75 hover:bg-[#E1EEFE] dark:hover:bg-[#203148]',
    subtleSurfaceClass: 'bg-[#D8E9FE]/70 dark:bg-[#22354E]',
  },
  {
    id: 'lavender',
    label: 'Лаванда',
    swatch: '#AE94F9',
    swatchBorder: '#8565E8',
    cardClass:
      'bg-[#F5F2FF] dark:bg-[#251F38] border-[#DBD2FC] dark:border-[#433669] hover:border-[#C2B1FA] dark:hover:border-[#5A488C]',
    listClass: 'bg-[#F5F2FF]/75 dark:bg-[#251F38]/75 hover:bg-[#EBE5FF] dark:hover:bg-[#2E2646]',
    subtleSurfaceClass: 'bg-[#E5DDFE]/70 dark:bg-[#322A4C]',
  },
  {
    id: 'rose',
    label: 'Розовый',
    swatch: '#F489A8',
    swatchBorder: '#DC5B82',
    cardClass:
      'bg-[#FDF2F5] dark:bg-[#331E25] border-[#F6CED9] dark:border-[#5B323F] hover:border-[#EDA9BC] dark:hover:border-[#784253]',
    listClass: 'bg-[#FDF2F5]/75 dark:bg-[#331E25]/75 hover:bg-[#FBE4EB] dark:hover:bg-[#3E242D]',
    subtleSurfaceClass: 'bg-[#F9DBE4]/70 dark:bg-[#442832]',
  },
  {
    id: 'sand',
    label: 'Песочный',
    swatch: '#E0B082',
    swatchBorder: '#C48B57',
    cardClass:
      'bg-[#FBF5EE] dark:bg-[#2D251E] border-[#EAD6C1] dark:border-[#514133] hover:border-[#DAB998] dark:hover:border-[#6A5543]',
    listClass: 'bg-[#FBF5EE]/75 dark:bg-[#2D251E]/75 hover:bg-[#F5EADF] dark:hover:bg-[#372D24]',
    subtleSurfaceClass: 'bg-[#F0E1D0]/70 dark:bg-[#3C3127]',
  },
  {
    id: 'slate',
    label: 'Графит',
    swatch: '#9AA8BC',
    swatchBorder: '#74849C',
    cardClass:
      'bg-[#F3F5F8] dark:bg-[#22262E] border-[#D7DDE6] dark:border-[#3B4250] hover:border-[#BBC5D3] dark:hover:border-[#4E576A]',
    listClass: 'bg-[#F3F5F8]/80 dark:bg-[#22262E]/80 hover:bg-[#E9EDF3] dark:hover:bg-[#2A2F3A]',
    subtleSurfaceClass: 'bg-[#E3E8F0]/75 dark:bg-[#2F3542]',
  },
];

export function getCardColorOption(color?: CardColor | string): CardColorOption {
  return CARD_COLOR_OPTIONS.find((c) => c.id === color) || CARD_COLOR_OPTIONS[0];
}

export interface TodoPriorityMeta {
  id: TodoPriority;
  label: string;
  shortLabel: string;
  dotClass: string;
  badgeClass: string;
  barClass: string;
}

export const TODO_PRIORITY_ORDER: TodoPriority[] = ['low', 'medium', 'high', 'urgent'];

export const TODO_PRIORITY_META: Record<TodoPriority, TodoPriorityMeta> = {
  low: {
    id: 'low',
    label: 'Низкий',
    shortLabel: 'Низкий',
    dotClass: 'bg-[#94A3B8]',
    badgeClass:
      'bg-[#EEF1F5] dark:bg-[#2F333C] text-[#5F6672] dark:text-[#A1A7B3] border-[#DCE1E8] dark:border-[#404552]',
    barClass: 'bg-[#94A3B8]',
  },
  medium: {
    id: 'medium',
    label: 'Средний',
    shortLabel: 'Средний',
    dotClass: 'bg-[#0B72E7] dark:bg-[#58A6FF]',
    badgeClass:
      'bg-[#EBF4FF] dark:bg-[#1A2D47] text-[#0B72E7] dark:text-[#60A5FA] border-[#C7DFFA] dark:border-[#2B4B75]',
    barClass: 'bg-[#0B72E7] dark:bg-[#58A6FF]',
  },
  high: {
    id: 'high',
    label: 'Высокий',
    shortLabel: 'Высокий',
    dotClass: 'bg-[#D97706] dark:bg-[#F59E0B]',
    badgeClass:
      'bg-[#FEF3C7] dark:bg-[#3E2C12] text-[#B45309] dark:text-[#FBBF24] border-[#FDE68A] dark:border-[#6B4A1B]',
    barClass: 'bg-[#D97706] dark:bg-[#F59E0B]',
  },
  urgent: {
    id: 'urgent',
    label: 'Срочный',
    shortLabel: 'Срочный',
    dotClass: 'bg-[#DC2626] dark:bg-[#F87171]',
    badgeClass:
      'bg-[#FEE2E2] dark:bg-[#3F1C20] text-[#B91C1C] dark:text-[#FCA5A5] border-[#FECACA] dark:border-[#6E2A31]',
    barClass: 'bg-[#DC2626] dark:bg-[#F87171]',
  },
};

export function createTodoItem(
  text: string,
  priority: TodoPriority = 'medium',
  progress = 0
): TodoItem {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `todo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  return {
    id,
    text: text.trim(),
    priority,
    progress: clamped,
  };
}

export function getTodoSummary(items: TodoItem[]): {
  total: number;
  completed: number;
  avgProgress: number;
} {
  if (!items || items.length === 0) {
    return { total: 0, completed: 0, avgProgress: 0 };
  }
  let completed = 0;
  let sum = 0;
  for (const item of items) {
    const p = Math.max(0, Math.min(100, Math.round(item.progress || 0)));
    if (p >= 100) completed += 1;
    sum += p;
  }
  return {
    total: items.length,
    completed,
    avgProgress: Math.round(sum / items.length),
  };
}

export function formatTodoItemsForAi(items: TodoItem[]): string {
  if (!items || items.length === 0) return '';
  return items
    .map((item) => {
      const priorityLabel = TODO_PRIORITY_META[item.priority]?.label || item.priority;
      return `- [${item.progress}% | ${priorityLabel}] ${item.text}`;
    })
    .join('\n');
}
