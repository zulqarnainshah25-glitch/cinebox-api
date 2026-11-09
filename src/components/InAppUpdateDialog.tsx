import React from 'react';
import { Download, ShieldCheck, Sparkles, X } from 'lucide-react';
import { InAppUpdateCheckResult } from '../services/inAppUpdateService';

interface InAppUpdateDialogProps {
  updateInfo: InAppUpdateCheckResult;
  onDismiss: () => void;
}

export const InAppUpdateDialog: React.FC<InAppUpdateDialogProps> = ({
  updateInfo,
  onDismiss,
}) => {
  if (!updateInfo.updateAvailable || !updateInfo.apkUrl) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="in-app-update-title"
      data-testid="in-app-update-dialog"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-[#131722] border border-[#10d97b]/40 p-6 shadow-2xl space-y-4">
        <button
          type="button"
          data-testid="dismiss-update-dialog-btn"
          onClick={onDismiss}
          aria-label="Dismiss update notification"
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#10d97b]/15 border border-[#10d97b]/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-[#10d97b]" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/90 border border-[#10d97b]/30 text-[10px] font-mono font-bold text-[#10d97b]">
              v{updateInfo.currentVersion} → v{updateInfo.remoteVersion}
            </span>
            <h2
              id="in-app-update-title"
              className="text-lg font-extrabold text-white mt-0.5"
            >
              New Update Available!
            </h2>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {updateInfo.releaseNotes ||
            'A newer version of CineBox APK is ready with faster streaming, bug fixes, and signature-safe installation over your existing app.'}
        </p>

        <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800/80 flex items-center gap-2 text-[11px] text-slate-300">
          <ShieldCheck className="w-4 h-4 text-[#10d97b] shrink-0" />
          <span>
            {updateInfo.isGoogleDriveLink
              ? 'Google Drive Verified APK: Official global download link updated by Admin. Installs over your current app without losing data.'
              : 'Signature-Safe Release APK: Installs directly over your current app without losing downloads or watchlist.'}
          </span>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-colors min-h-[42px]"
          >
            Later
          </button>

          <a
            href={updateInfo.apkUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="update-now-btn"
            download={`CineBox-v${updateInfo.remoteVersion}.apk`}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-lg transition-colors min-h-[42px]"
          >
            <Download className="w-4 h-4" />
            <span>{updateInfo.isGoogleDriveLink ? 'Download APK (Google Drive)' : 'Update Now'}</span>
          </a>
        </div>
      </div>
    </div>
  );
};
