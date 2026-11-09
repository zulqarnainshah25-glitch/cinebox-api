import React from 'react';
import { Sparkles, X } from 'lucide-react';
import { AppConfigRecord } from '../types/movie';
import {
  DEFAULT_ADSTERRA_CONTAINER_ID,
  DEFAULT_ADSTERRA_SCRIPT_SRC,
  DEFAULT_ADSTERRA_ZONE_KEY,
} from '../utils/securityValidator';

interface PopupAdModalProps {
  config: AppConfigRecord;
  onClose: () => void;
}

/**
 * Real Adsterra App-Open Ad Modal:
 * - Removed the fake "CINEBOX APP-OPEN OFFER" placeholder SVG image.
 * - Renders the live Adsterra unit (`/adsterra-frame.html` with `container-83b5d9d90d154535d150a2bd3cf1f04e`).
 * - Disabled on Web Browser startup by default so it only opens when explicitly triggered or in native APK mode.
 */
export const PopupAdModal: React.FC<PopupAdModalProps> = ({ config, onClose }) => {
  const activeContainerId = config.adsterra_container_id || DEFAULT_ADSTERRA_CONTAINER_ID;
  const activeScriptSrc = config.adsterra_script_src || DEFAULT_ADSTERRA_SCRIPT_SRC;
  const activeZoneKey = config.adsterra_banner_key || DEFAULT_ADSTERRA_ZONE_KEY;

  return (
    <div
      data-testid="app-open-once-ad-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-label="Adsterra Live Ad Unit"
    >
      <div className="relative w-full max-w-lg rounded-3xl bg-[#131722] border border-slate-700/80 overflow-hidden shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#10d97b]" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Adsterra Live Sponsored Unit ({activeZoneKey.slice(0, 12)}…)
              </h3>
              <p className="text-[10px] font-mono text-slate-400">
                #{activeContainerId}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="close-app-open-ad-btn"
            onClick={onClose}
            aria-label="Close app open ad"
            className="px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1"
          >
            <X className="w-4 h-4" />
            <span>Close</span>
          </button>
        </div>

        {/* Real Adsterra Frame (No Fake Placeholder Graphic) */}
        <div className="w-full min-h-[180px] rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center p-3">
          <iframe
            title="Adsterra App Open Unit"
            src="/adsterra-frame.html?slot=app-open"
            className="w-full h-40 border-0 overflow-hidden bg-transparent"
          />
          <div className="text-[10px] font-mono text-slate-500 text-center mt-1 truncate max-w-full">
            Script: {activeScriptSrc}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#10d97b] text-slate-950 font-bold text-xs"
          >
            Continue to {config.app_name}
          </button>
        </div>
      </div>
    </div>
  );
};
