import {
  Archive,
  BookOpen,
  Bookmark as BookmarkIcon,
  Briefcase,
  Calendar,
  Camera,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  Database,
  Dumbbell,
  FileText,
  Film,
  Flame,
  Folder,
  Gamepad2,
  Globe,
  GraduationCap,
  Headphones,
  Heart,
  Home,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  Lock,
  MapPin,
  Music,
  Newspaper,
  Palette,
  PlayCircle,
  Rocket,
  Server,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  StickyNote,
  Terminal,
  Type,
  Utensils,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { BookmarkType } from '../types';

export const COLLECTION_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  folder: { icon: Folder, label: 'Папка' },
  server: { icon: Server, label: 'Сервер' },
  cpu: { icon: Cpu, label: 'Железо' },
  layers: { icon: Layers, label: 'Слои' },
  palette: { icon: Palette, label: 'Дизайн' },
  type: { icon: Type, label: 'Шрифты' },
  code: { icon: Code, label: 'Код' },
  terminal: { icon: Terminal, label: 'Терминал' },
  database: { icon: Database, label: 'База данных' },
  'book-open': { icon: BookOpen, label: 'Чтение' },
  compass: { icon: Compass, label: 'Вдохновение' },
  globe: { icon: Globe, label: 'Веб' },
  bookmark: { icon: BookmarkIcon, label: 'Закладки' },
  star: { icon: Star, label: 'Важное' },
  camera: { icon: Camera, label: 'Фото' },
  film: { icon: Film, label: 'Видео' },
  music: { icon: Music, label: 'Музыка' },
  briefcase: { icon: Briefcase, label: 'Работа' },
  home: { icon: Home, label: 'Дом' },
  archive: { icon: Archive, label: 'Архив' },
  sparkles: { icon: Sparkles, label: 'ИИ и магия' },
  rocket: { icon: Rocket, label: 'Стартапы и запуск' },
  flame: { icon: Flame, label: 'Горячее' },
  heart: { icon: Heart, label: 'Любимое' },
  lightbulb: { icon: Lightbulb, label: 'Идеи' },
  'graduation-cap': { icon: GraduationCap, label: 'Обучение' },
  newspaper: { icon: Newspaper, label: 'Новости' },
  'shopping-bag': { icon: ShoppingBag, label: 'Покупки' },
  wallet: { icon: Wallet, label: 'Финансы' },
  shield: { icon: Shield, label: 'Безопасность' },
  wrench: { icon: Wrench, label: 'Инструменты' },
  'gamepad-2': { icon: Gamepad2, label: 'Игры' },
  headphones: { icon: Headphones, label: 'Подкасты' },
  'map-pin': { icon: MapPin, label: 'Путешествия' },
  utensils: { icon: Utensils, label: 'Рецепты и еда' },
  dumbbell: { icon: Dumbbell, label: 'Спорт' },
  coffee: { icon: Coffee, label: 'Отдых' },
  cloud: { icon: Cloud, label: 'Облако' },
  lock: { icon: Lock, label: 'Личное' },
  calendar: { icon: Calendar, label: 'Планы' },
};

export const COLLECTION_EMOJIS = [
  '📁', '🚀', '💡', '🔥', '⭐', '❤️', '🧠', '🤖', '💻', '🛠️',
  '🎨', '📸', '🎬', '🎧', '📚', '📝', '📰', '🌐', '☁️', '🔒',
  '💼', '💰', '🛒', '🏠', '✈️', '🗺️', '🍕', '☕', '🏋️', '🎮',
  '🧪', '📊', '📅', '🎯', '📌', '🔖', '⚡', '🌿', '🎵', '🧩',
];

export const COLLECTION_COLORS = [
  '#0B72E7',
  '#2563EB',
  '#0284C7',
  '#0D9488',
  '#16A34A',
  '#D97706',
  '#EA580C',
  '#DC2626',
  '#DB2777',
  '#7C3AED',
  '#64748B',
];

export function isEmojiCollectionIcon(name: string): boolean {
  const trimmed = (name || '').trim();
  if (!trimmed || COLLECTION_ICONS[trimmed]) return false;
  return !/^[a-z0-9_-]+$/i.test(trimmed);
}

export function extractFirstGrapheme(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const IntlWithSeg = Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
    ) => { segment: (s: string) => Iterable<{ segment: string }> };
  };
  if (typeof IntlWithSeg.Segmenter === 'function') {
    const segmenter = new IntlWithSeg.Segmenter(undefined, { granularity: 'grapheme' });
    for (const part of segmenter.segment(trimmed)) {
      return part.segment;
    }
  }
  return Array.from(trimmed)[0] || '';
}

export function getCollectionIcon(name: string): LucideIcon {
  return COLLECTION_ICONS[name]?.icon || Folder;
}

export function CollectionIconView({
  icon,
  color,
  className = 'w-4 h-4 shrink-0',
}: {
  icon: string;
  color?: string;
  className?: string;
}) {
  if (isEmojiCollectionIcon(icon)) {
    return (
      <span
        aria-hidden="true"
        className="w-4 h-4 shrink-0 inline-flex items-center justify-center text-[14px] leading-none select-none"
      >
        {icon}
      </span>
    );
  }
  const Icon = getCollectionIcon(icon);
  return <Icon className={className} style={color ? { color } : undefined} strokeWidth={1.85} />;
}

export function getBookmarkTypeMeta(type: BookmarkType): {
  label: string;
  icon: LucideIcon;
} {
  switch (type) {
    case 'article':
      return { label: 'Статья', icon: BookOpen };
    case 'video':
      return { label: 'Видео', icon: PlayCircle };
    case 'image':
      return { label: 'Изображение', icon: ImageIcon };
    case 'document':
      return { label: 'Документ', icon: FileText };
    case 'note':
      return { label: 'Заметка', icon: StickyNote };
    case 'todo':
      return { label: 'Задачи', icon: ListChecks };
    default:
      return { label: 'Ссылка', icon: Link2 };
  }
}

const CURRENT_YEAR = new Date().getFullYear();
const SAME_YEAR_DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});
const OTHER_YEAR_DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const SHORT_DATE_CACHE = new Map<string, string>();

export function formatShortDate(isoString: string): string {
  if (!isoString) return '';
  const cached = SHORT_DATE_CACHE.get(isoString);
  if (cached !== undefined) return cached;

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const formatted =
    date.getFullYear() === CURRENT_YEAR
      ? SAME_YEAR_DATE_FMT.format(date)
      : OTHER_YEAR_DATE_FMT.format(date);

  if (SHORT_DATE_CACHE.size > 4000) SHORT_DATE_CACHE.clear();
  SHORT_DATE_CACHE.set(isoString, formatted);
  return formatted;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

export function isSafeExternalHref(url: string): boolean {
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
