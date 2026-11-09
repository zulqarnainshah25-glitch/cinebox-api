import React, { useEffect, useState } from 'react';
import { Film, RefreshCw } from 'lucide-react';
import { AppConfigRecord } from '../types/movie';
import {
  DEFAULT_ADSTERRA_ZONE_KEY,
  getResponsiveAdSlotDimensions,
} from '../utils/securityValidator';

interface NonIntrusiveBannerAdProps {
  config: AppConfigRecord;
  placement?: 'home-top' | 'home-native' | 'player-bottom';
}

/**
 * Movie-Thumbnail Styled Adsterra Banner & Native Banner Component:
 * 1. Renders Adsterra ads styled like native CineBox Movie Thumbnail Cards (3-column grid on mobile,
 *    4-column grid on desktop) with HD & Play badges so users naturally engage with them like movies.
 * 2. Strictly bounded width (`max-width: 100%`) so the container never overflows mobile screens.
 * 3. Hides Adsterra's internal "Ad was closed" placeholder overlay so real ad thumbnails & titles show cleanly.
 * 4. Silently hides if ad-blocker blocks the script (`adStatus === 'blocked'` returns `null`).
 */
export const NonIntrusiveBannerAd: React.FC<NonIntrusiveBannerAdProps> = ({
  config,
  placement = 'home-top',
}) => {
  const [frameKey, setFrameKey] = useState<number>(0);

  const activeZoneKey = config.adsterra_banner_key || DEFAULT_ADSTERRA_ZONE_KEY;
  const dims = getResponsiveAdSlotDimensions(placement);

  useEffect(() => {
    if (!config.is_ads_enabled) return;

    const handleFrameMessage = (event: MessageEvent) => {
      if (
        event.data &&
        event.data.type === 'ADSTERRA_MOVIE_CARD_CLICK' &&
        event.data.slot === placement
      ) {
        const directUrl = (config.direct_ad_link || config.popup_ad_link || '').trim();
        if (directUrl && directUrl.startsWith('https://')) {
          const anchor = document.createElement('a');
          anchor.href = directUrl;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
        }
      }
    };
    window.addEventListener('message', handleFrameMessage);
    return () => window.removeEventListener('message', handleFrameMessage);
  }, [config.is_ads_enabled, config.direct_ad_link, config.popup_ad_link, placement]);

  if (!config.is_ads_enabled) {
    return null;
  }

  return (
    <section
      data-testid={`non-intrusive-banner-ad-${placement}`}
      aria-label={dims.slotLabel}
      className={dims.containerClassName}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Film className="w-4 h-4 text-[#10d97b] shrink-0" />
          <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight truncate">
            {dims.slotLabel}
          </h3>
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-mono text-[#10d97b] uppercase">
            Hot
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setFrameKey((k) => k + 1);
          }}
          title="Refresh featured picks"
          aria-label="Reload ad"
          className="text-xs text-slate-400 hover:text-[#10d97b] flex items-center gap-1 transition-colors shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Movie-Thumbnail Styled Adsterra Container (Clickable, 3-col mobile / 4-col desktop) */}
      <div
        data-testid={`adsterra-iframe-slot-${placement}`}
        className={dims.iframeWrapperClassName}
      >
        <iframe
          key={frameKey}
          title={`${dims.slotLabel} (${activeZoneKey})`}
          src={`/adsterra-frame.html?slot=${placement}&zone=${encodeURIComponent(activeZoneKey)}`}
          scrolling="no"
          loading="lazy"
          className={dims.iframeClassName}
        />
      </div>
    </section>
  );
};
