import React from 'react';

interface CineBoxBrandLogoProps {
  appName?: string;
  size?: 'sm' | 'md' | 'lg';
  showWordmarkOnMobile?: boolean;
}

/**
 * Custom Branded CineBox Logo & Emblem:
 * - Features a 3D obsidian-emerald squircle icon with cinema film perforations,
 *   neon 'C' reel ring, and glowing play prism.
 * - Displays the stylized "CineBox" wordmark + "4K HD" micro-badge on mobile and desktop.
 */
export const CineBoxBrandLogo: React.FC<CineBoxBrandLogoProps> = ({
  appName = 'CineBox',
  size = 'md',
  showWordmarkOnMobile = true,
}) => {
  const iconDimensions =
    size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9 sm:w-10 sm:h-10';

  const isDefaultName = appName.trim().toLowerCase() === 'cinebox';

  return (
    <div
      data-testid="cinebox-custom-brand-logo"
      className="flex items-center gap-2 sm:gap-2.5 select-none"
    >
      {/* Custom SVG Cinema Emblem Icon */}
      <div
        className={`relative ${iconDimensions} rounded-xl overflow-hidden shadow-lg shadow-[#10d97b]/25 ring-1 ring-[#10d97b]/40 group-active:scale-95 transition-transform shrink-0 bg-[#050811]`}
      >
        <svg
          viewBox="0 0 512 512"
          className="w-full h-full block"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="cbHeaderBg"
              x1="0"
              y1="0"
              x2="512"
              y2="512"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#050811" />
              <stop offset="55%" stopColor="#0a121e" />
              <stop offset="100%" stopColor="#041f18" />
            </linearGradient>
            <linearGradient
              id="cbHeaderNeon"
              x1="80"
              y1="64"
              x2="432"
              y2="448"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="50%" stopColor="#10d97b" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
            <linearGradient
              id="cbHeaderPlay"
              x1="190"
              y1="160"
              x2="360"
              y2="352"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#34f59b" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>

          <rect width="512" height="512" rx="108" fill="url(#cbHeaderBg)" />

          {/* Film Strip Perforations */}
          <g fill="#10d97b" fillOpacity="0.28">
            <rect x="38" y="102" width="24" height="36" rx="7" />
            <rect x="38" y="170" width="24" height="36" rx="7" />
            <rect x="38" y="238" width="24" height="36" rx="7" />
            <rect x="38" y="306" width="24" height="36" rx="7" />
            <rect x="38" y="374" width="24" height="36" rx="7" />

            <rect x="450" y="102" width="24" height="36" rx="7" />
            <rect x="450" y="170" width="24" height="36" rx="7" />
            <rect x="450" y="238" width="24" height="36" rx="7" />
            <rect x="450" y="306" width="24" height="36" rx="7" />
            <rect x="450" y="374" width="24" height="36" rx="7" />
          </g>

          {/* Stylized 'C' Cinema Reel Ring */}
          <path
            d="M356 140C328 112 290 96 248 96C164.053 96 96 167.634 96 256C96 344.366 164.053 416 248 416C290 416 328 400 356 372"
            stroke="url(#cbHeaderNeon)"
            strokeWidth="38"
            strokeLinecap="round"
          />

          {/* Center 3D Play Prism */}
          <path
            d="M212 172C212 159.5 225.8 151.9 236.4 158.6L364.4 239.4C374.3 245.7 374.3 260.3 364.4 266.6L236.4 347.4C225.8 354.1 212 346.5 212 334V172Z"
            fill="url(#cbHeaderPlay)"
          />
          <path d="M238 212L312 253L238 294V212Z" fill="#04131a" fillOpacity="0.45" />
        </svg>
      </div>

      {/* Stylized Brand Wordmark */}
      <div
        className={`${
          showWordmarkOnMobile ? 'flex' : 'hidden sm:flex'
        } flex-col justify-center leading-none text-left`}
      >
        <div className="flex items-center gap-0.5 font-display font-black text-base sm:text-xl tracking-tight">
          {isDefaultName ? (
            <>
              <span className="text-white">Cine</span>
              <span className="bg-gradient-to-r from-[#10d97b] via-[#34f59b] to-[#06b6d4] bg-clip-text text-transparent">
                Box
              </span>
            </>
          ) : (
            <span className="text-white">{appName}</span>
          )}
        </div>
        <span className="text-[8px] sm:text-[9px] font-mono font-bold tracking-[0.16em] text-[#10d97b]/90 uppercase mt-0.5">
          Cinema HD
        </span>
      </div>
    </div>
  );
};
