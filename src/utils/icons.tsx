import {
  Archive,
  BookOpen,
  Bookmark as BookmarkIcon,
  Briefcase,
  Camera,
  Code,
  Compass,
  Cpu,
  Database,
  FileText,
  Film,
  Folder,
  Globe,
  Home,
  Image as ImageIcon,
  Layers,
  Link2,
  Music,
  Palette,
  PlayCircle,
  Server,
  Star,
  Terminal,
  Type,
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
};

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

export function getCollectionIcon(name: string): LucideIcon {
  return COLLECTION_ICONS[name]?.icon || Folder;
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
