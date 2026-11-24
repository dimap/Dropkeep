import { useId } from 'react';

interface DropkeepLogoProps {
  className?: string;
}

export function DropkeepLogo({ className = 'w-7 h-7' }: DropkeepLogoProps) {
  const uid = useId().replace(/:/g, '');
  const gradId = `dk-drop-${uid}`;

  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradId} x1="32" y1="5" x2="32" y2="59" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#268BFF" />
          <stop offset="100%" stopColor="#0B72E7" />
        </linearGradient>
      </defs>
      <path
        d="M32 5C32 5 11.5 26.8 11.5 38.5C11.5 49.82 20.68 59 32 59C43.32 59 52.5 49.82 52.5 38.5C52.5 26.8 32 5 32 5Z"
        fill={`url(#${gradId})`}
      />
      <path
        d="M24.5 31.2C24.5 29.71 25.71 28.5 27.2 28.5H36.8C38.29 28.5 39.5 29.71 39.5 31.2V48.4C39.5 49.28 38.48 49.76 37.8 49.2L32 44.35L26.2 49.2C25.52 49.76 24.5 49.28 24.5 48.4V31.2Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
