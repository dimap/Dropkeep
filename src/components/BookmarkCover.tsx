import { memo, useState } from 'react';
import type { BookmarkType } from '../types';
import { getBookmarkTypeMeta } from '../utils/icons';

interface BookmarkCoverProps {
  cover: string;
  title: string;
  domain: string;
  type: BookmarkType;
  className?: string;
  compact?: boolean;
  naturalAspect?: boolean;
}

export const BookmarkCover = memo(function BookmarkCover({
  cover,
  title,
  domain,
  type,
  className = '',
  compact = false,
  naturalAspect = false,
}: BookmarkCoverProps) {
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const { icon: TypeIcon, label } = getBookmarkTypeMeta(type);

  const hasValidCover =
    Boolean(cover) &&
    failedCover !== cover &&
    (cover.startsWith('/covers/') ||
      cover.startsWith('/api/covers/') ||
      cover.startsWith('http://') ||
      cover.startsWith('https://'));

  if (hasValidCover) {
    return (
      <div
        className={`relative overflow-hidden bg-[#F1F3F6] dark:bg-[#2B2D32] ${className}`}
      >
        <img
          src={cover}
          alt={title}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailedCover(cover)}
          className={`w-full ${naturalAspect ? 'h-auto block' : 'h-full object-cover'} transition-transform duration-200 ease-out group-hover:scale-[1.02]`}
        />
      </div>
    );
  }

  // Tasteful neutral architectural fallback when a bookmark has no og:image
  return (
    <div
      className={`relative overflow-hidden bg-[#F3F4F7] dark:bg-[#2A2C31] flex flex-col items-center justify-center select-none ${className}`}
    >
      <div
        className="absolute inset-0 opacity-[0.45] dark:opacity-[0.22]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: compact ? '12px 12px' : '18px 18px',
        }}
      />
      <div className="relative flex flex-col items-center justify-center gap-1.5 px-3 text-center">
        <div
          className={`rounded-lg bg-white/90 dark:bg-[#1E2024]/90 border border-[#E2E5EB] dark:border-[#383B42] flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] ${
            compact ? 'w-8 h-8' : 'w-10 h-10'
          }`}
        >
          <TypeIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={1.75} />
        </div>
        {!compact && (
          <span className="text-[11px] font-medium text-[#6B7280] dark:text-[#9CA3AF] truncate max-w-[160px]">
            {domain || label}
          </span>
        )}
      </div>
    </div>
  );
});
