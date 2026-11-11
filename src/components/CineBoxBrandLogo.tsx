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
export const CINEBOX_APP_ICON_PATH =
  '/assets/aistudio/WhatsApp_Image_2026-11-11_at_3.05.49_PM-removebg-preview_30d0dc3d.png';

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
      {/* Official CineBox App Icon PNG */}
      <div
        className={`relative ${iconDimensions} rounded-xl overflow-hidden shadow-lg shadow-[#10d97b]/25 ring-1 ring-[#10d97b]/40 group-active:scale-95 transition-transform shrink-0 bg-[#050811] flex items-center justify-center`}
      >
        <img
          src={CINEBOX_APP_ICON_PATH}
          alt={`${appName} App Icon`}
          data-testid="cinebox-app-icon-img"
          className="w-full h-full object-contain scale-115 block"
        />
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
