import { memo, useState } from 'react';
import type { BookmarkType, FallbackCoverStyle } from '../types';
import { getBookmarkTypeMeta } from '../utils/icons';

interface BookmarkCoverProps {
  cover: string;
  title: string;
  domain: string;
  type: BookmarkType;
  fallbackStyle?: FallbackCoverStyle;
  className?: string;
  compact?: boolean;
  naturalAspect?: boolean;
}

const SOFT_TINTS = [
  'bg-gradient-to-br from-[#EEF3FA] to-[#E5ECF7] dark:from-[#232A35] dark:to-[#1E242E] text-[#4C6588] dark:text-[#93AFCF]',
  'bg-gradient-to-br from-[#EDF5F1] to-[#E3EFE9] dark:from-[#212D28] dark:to-[#1C2622] text-[#476F5D] dark:text-[#8EBAA5]',
  'bg-gradient-to-br from-[#F6F1EA] to-[#EFE7DB] dark:from-[#2E2922] dark:to-[#27221C] text-[#7D6648] dark:text-[#C5AE90]',
  'bg-gradient-to-br from-[#F2EFFA] to-[#EAE5F6] dark:from-[#292534] dark:to-[#23202D] text-[#66588A] dark:text-[#AFA2D1]',
  'bg-gradient-to-br from-[#ECF4F7] to-[#E2EEF3] dark:from-[#212B30] dark:to-[#1C2429] text-[#476A7A] dark:text-[#8FB4C6]',
  'bg-gradient-to-br from-[#F7EFF2] to-[#F0E4E9] dark:from-[#30242A] dark:to-[#291F24] text-[#845769] dark:text-[#C79BAE]',
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export const BookmarkCover = memo(function BookmarkCover({
  cover,
  title,
  domain,
  type,
  fallbackStyle = 'minimal',
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

  const labelText = domain || label;
  const monogram = (domain || title || label).replace(/^www\./i, '').charAt(0).toUpperCase() || 'D';

  if (fallbackStyle === 'soft-tint') {
    const tintClass = SOFT_TINTS[hashString(domain || title || type) % SOFT_TINTS.length];
    return (
      <div
        className={`relative overflow-hidden flex flex-col items-center justify-center select-none ${tintClass} ${className}`}
      >
        <div className="relative flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <div
            className={`rounded-xl bg-white/75 dark:bg-black/20 backdrop-blur-[2px] border border-white/60 dark:border-white/10 flex items-center justify-center ${
              compact ? 'w-8 h-8' : 'w-10 h-10'
            }`}
          >
            <TypeIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={1.75} />
          </div>
          {!compact && (
            <span className="text-[11px] font-medium opacity-85 truncate max-w-[160px]">
              {labelText}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (fallbackStyle === 'monochrome') {
    return (
      <div
        className={`relative overflow-hidden bg-[#EBEEF2] dark:bg-[#24262B] flex flex-col items-center justify-center select-none ${className}`}
      >
        <div className="relative flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <div
            className={`rounded-full border border-[#D4D9E2] dark:border-[#3A3E47] bg-[#F7F8FA] dark:bg-[#1C1E22] flex items-center justify-center font-semibold text-[#4B5563] dark:text-[#B4BAC6] ${
              compact ? 'w-8 h-8 text-[13px]' : 'w-11 h-11 text-[16px]'
            }`}
          >
            {monogram}
          </div>
          {!compact && (
            <span className="text-[11px] font-medium text-[#6B7280] dark:text-[#9CA3AF] truncate max-w-[160px]">
              {labelText}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (fallbackStyle === 'paper') {
    return (
      <div
        className={`relative overflow-hidden bg-[#F5EFE2] dark:bg-[#2B2721] flex flex-col items-center justify-center select-none ${className}`}
      >
        <div className="relative flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <div
            className={`rounded-lg bg-[#FBF8F1] dark:bg-[#221F1A] border border-[#E5DAC5] dark:border-[#3D372E] flex items-center justify-center text-[#7A6B54] dark:text-[#C5B69C] ${
              compact ? 'w-8 h-8' : 'w-10 h-10'
            }`}
          >
            <TypeIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={1.7} />
          </div>
          {!compact && (
            <span className="text-[11px] font-medium text-[#7A6B54] dark:text-[#B6A78E] truncate max-w-[160px]">
              {labelText}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (fallbackStyle === 'dots') {
    return (
      <div
        className={`relative overflow-hidden bg-[#F4F5F7] dark:bg-[#27292E] flex flex-col items-center justify-center select-none ${className}`}
      >
        <div
          className="absolute inset-0 text-[#9CA3AF] opacity-[0.22] dark:opacity-[0.14]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
            backgroundSize: compact ? '14px 14px' : '20px 20px',
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
              {labelText}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Default: 'minimal' — calm, smooth matte surface without eye-straining patterns
  return (
    <div
      className={`relative overflow-hidden bg-[#F2F4F7] dark:bg-[#26282E] flex flex-col items-center justify-center select-none ${className}`}
    >
      <div className="relative flex flex-col items-center justify-center gap-1.5 px-3 text-center">
        <div
          className={`rounded-lg bg-white/85 dark:bg-[#1E2025] border border-[#E4E7ED] dark:border-[#343740] flex items-center justify-center text-[#646D7A] dark:text-[#9DA4B0] ${
            compact ? 'w-8 h-8' : 'w-10 h-10'
          }`}
        >
          <TypeIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={1.7} />
        </div>
        {!compact && (
          <span className="text-[11px] font-medium text-[#707885] dark:text-[#949CA8] truncate max-w-[160px]">
            {labelText}
          </span>
        )}
      </div>
    </div>
  );
});
