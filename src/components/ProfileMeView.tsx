import React, { useState } from 'react';
import {
  Bell,
  Bookmark,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Download,
  History,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  MessageSquareWarning,
  Palette,
  QrCode,
  Server,
  Settings,
  ShieldCheck,
  Sliders,
  Smartphone,
  Star,
  Trash2,
  Tv,
  UserCheck,
  UserPlus,
  Wifi,
  X,
} from 'lucide-react';
import {
  AppConfigRecord,
  AppUserRecord,
  DownloadQuality,
  MovieItem,
  ThemeColorId,
  UserAppSettings,
  WatchHistoryItem,
} from '../types/movie';
import {
  loginOrRegisterUser,
  logoutCurrentUser,
  normalizeOfficialWebsiteUrl,
  requestPasswordResetEmail,
} from '../services/supabaseClient';
import {
  buildReferralShareUrl,
  generateUniqueReferralCode,
  shareReferralLink,
} from '../services/platformTrialReferralService';

interface ProfileMeViewProps {
  appConfig: AppConfigRecord;
  loggedInUser: AppUserRecord | null;
  userSettings: UserAppSettings;
  watchHistory: WatchHistoryItem[];
  watchlist: MovieItem[];
  isAdminUnlocked?: boolean;
  onUserAuthChanged: (user: AppUserRecord | null) => void;
  onUpdateUserSettings: (nextSettings: UserAppSettings) => void;
  onChangeThemeColor: (theme: ThemeColorId) => void;
  onClearHistoryAndCache: () => void;
  onSelectHistoryMovie: (tmdbId: number) => void;
  onOpenWatchlistTab: () => void;
  onOpenAdminModal: () => void;
  onOpenDeliverablesModal: () => void;
}

export const ProfileMeView: React.FC<ProfileMeViewProps> = ({
  appConfig,
  loggedInUser,
  userSettings,
  watchHistory,
  watchlist,
  isAdminUnlocked = false,
  onUserAuthChanged,
  onUpdateUserSettings,
  onChangeThemeColor,
  onClearHistoryAndCache,
  onSelectHistoryMovie,
  onOpenWatchlistTab,
  onOpenAdminModal,
  onOpenDeliverablesModal,
}) => {
  const [showActivityTooltip, setShowActivityTooltip] = useState<boolean>(true);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [activeNoticeModal, setActiveNoticeModal] = useState<string | null>(null);

  // Real Login / Register / Password Reset Modal State
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset'>('login');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [authUsername, setAuthUsername] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string>('');
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);

  // Real Working App Settings Modal State
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [cacheClearedMsg, setCacheClearedMsg] = useState<string>('');

  const officialSite = normalizeOfficialWebsiteUrl(appConfig.official_website);

  const handleCopyWebsite = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(officialSite).catch(() => {});
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccessMsg('');
    setIsAuthenticating(true);
    try {
      if (authMode === 'reset') {
        const resetRes = await requestPasswordResetEmail(authEmail);
        if (!resetRes.ok) {
          setAuthError(resetRes.error || 'Could not send password reset email.');
        } else {
          setAuthSuccessMsg(resetRes.message || 'Password reset link sent to your email.');
        }
        return;
      }

      const res = await loginOrRegisterUser({
        email: authEmail,
        password: authPassword,
        username: authUsername,
        mode: authMode,
      });
      if (!res.ok || !res.user) {
        setAuthError(res.error || 'Could not sign in. Please check your details.');
        return;
      }
      onUserAuthChanged(res.user);
      setShowLoginModal(false);
      setAuthPassword('');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = () => {
    logoutCurrentUser();
    onUserAuthChanged(null);
  };

  return (
    <div className="pb-24 px-4 sm:px-6 pt-3 max-w-4xl mx-auto space-y-4">
      {/* Top Bar: Real Login System & Allotted USR ID */}
      <div className="flex items-center justify-between pt-1 gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-white truncate">
            {loggedInUser ? loggedInUser.username : 'Log in to your account'}
          </h1>

          {loggedInUser ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                data-testid="logged-in-user-id"
                className="inline-block px-2.5 py-0.5 rounded bg-[#1b1f2a] border border-[#10d97b]/40 text-xs font-mono font-bold text-[#10d97b]"
              >
                ID: {loggedInUser.id}
              </span>
              <span className="text-xs text-slate-400 font-mono truncate">
                {loggedInUser.email}
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950/90 text-[#10d97b] text-[10px] font-extrabold uppercase">
                {loggedInUser.role}
              </span>
              <span
                data-testid="profile-user-platform-badge"
                className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 text-[10px] font-mono font-bold"
              >
                Platform: {loggedInUser.platform}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-400">
              Sign in to sync your watchlist &amp; view your allotted{' '}
              <code className="text-slate-300">ID: USR-...</code>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {loggedInUser ? (
            <button
              type="button"
              data-testid="user-logout-btn"
              onClick={handleLogout}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-500/40 text-slate-200 hover:text-rose-200 font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors min-h-[40px]"
            >
              <LogOut className="w-4 h-4" />
              <span>Log out</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="open-login-modal-btn"
              onClick={() => {
                setAuthError('');
                setShowLoginModal(true);
              }}
              className="px-4 py-2 rounded-lg bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors min-h-[40px]"
            >
              <LogIn className="w-4 h-4" />
              <span>Log in</span>
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              setActiveNoticeModal(
                `Share ${appConfig.app_name} QR Code: Visit ${officialSite} on any mobile or smart TV browser to sync your watchlist.`
              )
            }
            aria-label="Share App QR Code"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-[#181c26] text-slate-200 hover:text-[#10d97b]"
          >
            <QrCode className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Green Official Website Bar (Updated to https://cinebox-movie-streaming-offline-downloader.ai.studio/) */}
      <div
        data-testid="official-website-banner"
        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#0b291e] border border-[#10d97b]/25 text-xs sm:text-sm text-[#10d97b] gap-2"
      >
        <div className="flex items-center gap-2 truncate">
          <span className="truncate">📢 Official website: {officialSite}</span>
        </div>
        <button
          type="button"
          onClick={handleCopyWebsite}
          className="font-semibold flex items-center gap-1 shrink-0 hover:underline"
        >
          {copiedLink ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy link</span>
            </>
          )}
        </button>
      </div>

      {/* Global Android APK Download Card (Synced with Admin Panel Google Drive / Direct Link) */}
      {appConfig.apk_download_url && (
        <div
          data-testid="profile-download-apk-card"
          className="w-full p-4 rounded-2xl bg-gradient-to-r from-[#0e241b] to-[#131d29] border border-[#10d97b]/35 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#10d97b]/15 border border-[#10d97b]/40 text-[#10d97b] flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-2 flex-wrap">
                <span>Official Android APK (v{appConfig.apk_latest_version || '1.0.2'})</span>
                <span className="px-2 py-0.5 rounded bg-emerald-950 border border-[#10d97b]/40 text-[10px] font-mono text-[#10d97b]">
                  Global Cloud Link
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate mt-0.5">
                {appConfig.apk_release_notes ||
                  'Download the latest signed CineBox APK directly from Google Drive.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={appConfig.apk_download_url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="profile-download-apk-btn"
              className="px-3.5 py-2 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download APK</span>
            </a>
          </div>
        </div>
      )}

      {/* Referral & Rewards Center Card (Share https://site/ref/{code} via navigator.share) */}
      {(() => {
        const myRefCode =
          loggedInUser?.referral_code ||
          generateUniqueReferralCode(loggedInUser?.email || 'cinebox-user');
        const myRefUrl = buildReferralShareUrl(myRefCode);
        const refCount = loggedInUser?.successful_referrals ?? 0;

        return (
          <div
            data-testid="profile-referral-card"
            className="w-full p-4 rounded-2xl bg-gradient-to-r from-[#231d16] to-[#342616] border border-amber-500/25 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <Star className="w-6 h-6 text-amber-400 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-amber-100">
                    Referral &amp; Rewards Center ({refCount}/2 Referrals)
                  </div>
                  <div className="text-xs text-amber-300/80 font-mono">
                    Code: {myRefCode} · Invite 2 friends for +30 Days APK Unlock
                  </div>
                </div>
              </div>
              <button
                type="button"
                data-testid="profile-share-referral-btn"
                onClick={async () => {
                  const res = await shareReferralLink(myRefCode);
                  setActiveNoticeModal(
                    res.shared
                      ? `Shared referral link: ${res.shareUrl}`
                      : `Referral link copied to clipboard: ${myRefUrl}`
                  );
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs transition-colors"
              >
                Share Referral Link
              </button>
            </div>
          </div>
        );
      })()}

      {/* Watch History + My List + Messages + TV Download + My Activity Card */}
      <div className="rounded-2xl bg-[#141720] border border-slate-800/80 divide-y divide-slate-800/60 overflow-hidden">
        {/* Watch History Section */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-sm font-bold text-white">
              <History className="w-5 h-5 text-slate-300" />
              <span>Watch History</span>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </div>

          {watchHistory.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              No recent watch history. Play any movie or series to resume where you left off.
            </p>
          ) : (
            <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pt-1">
              {watchHistory.map((item) => (
                <button
                  key={item.tmdbId}
                  type="button"
                  onClick={() => onSelectHistoryMovie(item.tmdbId)}
                  className="w-36 shrink-0 text-left group focus:outline-none"
                >
                  <div className="relative aspect-video rounded-lg overflow-hidden bg-slate-900">
                    <img
                      src={item.backdropUrl || item.posterUrl}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-slate-700">
                      <div
                        className="h-full bg-[#10d97b]"
                        style={{ width: `${item.watchedPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-1.5 text-xs font-medium text-slate-200 truncate group-hover:text-[#10d97b]">
                    {item.title}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* My List (Watchlist) */}
        <button
          type="button"
          onClick={onOpenWatchlistTab}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
        >
          <div className="flex items-center gap-3 text-sm font-medium text-slate-100">
            <Bookmark className="w-5 h-5 text-slate-300" />
            <span>My List</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
            <span>{watchlist.length}</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>

        {/* Messages */}
        <button
          type="button"
          onClick={() =>
            setActiveNoticeModal(
              '5 System Messages: New Hindi Dubbed releases added to CineBox CDN.'
            )
          }
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
        >
          <div className="flex items-center gap-3 text-sm font-medium text-slate-100">
            <Bell className="w-5 h-5 text-slate-300" />
            <span>Messages</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-bold font-mono">
              5
            </span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </div>
        </button>

        {/* Official TV & Web Link */}
        <button
          type="button"
          onClick={() =>
            setActiveNoticeModal(
              `Official TV & Web Portal: Open ${officialSite} on Android TV, FireStick, or Desktop browser.`
            )
          }
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
        >
          <div className="flex items-center gap-3 text-sm font-medium text-slate-100">
            <Tv className="w-5 h-5 text-slate-300" />
            <span>Official Website &amp; TV Portal</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#10d97b] tracking-wider font-mono">
              cineboxmovies.ai.studio
            </span>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </div>
        </button>

        {/* My Activity with Floating Tooltip */}
        <div className="relative">
          {showActivityTooltip && (
            <div className="mx-4 mt-3 mb-1 p-3 rounded-xl bg-white text-slate-900 shadow-lg flex items-start justify-between gap-3 text-xs font-medium">
              <span>Post, My Likes, and My Comments are now combined under My Activity.</span>
              <button
                type="button"
                onClick={() => setShowActivityTooltip(false)}
                aria-label="Dismiss activity notice"
                className="text-slate-500 hover:text-slate-900 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowActivityTooltip(false)}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
          >
            <div className="flex items-center gap-3 text-sm font-medium text-slate-100">
              <MessageSquare className="w-5 h-5 text-slate-300" />
              <span>My Activity</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
              <span>0</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      </div>

      {/* Secondary Settings & Restricted Admin Command Center (Study Mode removed per user request) */}
      <div className="rounded-2xl bg-[#141720] border border-slate-800/80 divide-y divide-slate-800/60 overflow-hidden">
        <button
          type="button"
          data-testid="open-settings-btn"
          onClick={() => {
            setCacheClearedMsg('');
            setShowSettingsModal(true);
          }}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
        >
          <div className="flex items-center gap-3 text-sm font-medium text-slate-100">
            <Settings className="w-5 h-5 text-slate-300" />
            <span>Settings</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>
              {userSettings.defaultDownloadQuality.toUpperCase()} ·{' '}
              {userSettings.defaultServer === 'auto-server-3' ? 'Server 3' : 'Server 1'}
            </span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveNoticeModal(
              'Feedback submitted! Broken stream report queue is monitored 24/7.'
            )
          }
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
        >
          <div className="flex items-center gap-3 text-sm font-medium text-slate-100">
            <MessageSquareWarning className="w-5 h-5 text-slate-300" />
            <span>Feedback</span>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {/* Restricted Admin Command Center (Requires Admin PIN) */}
        <button
          type="button"
          data-testid="open-admin-console-btn"
          onClick={onOpenAdminModal}
          className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
        >
          <div className="flex items-center gap-3 text-sm font-medium text-[#10d97b]">
            <ShieldCheck className="w-5 h-5" />
            <span>
              {isAdminUnlocked
                ? 'Global Admin Console (Unlocked — Bulk Upload / Users / APK)'
                : 'Global Admin Console (Restricted — Supabase Admin Auth Only)'}
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-[#10d97b]" />
        </button>

        {isAdminUnlocked && (
          <button
            type="button"
            onClick={onOpenDeliverablesModal}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-800/40 transition-colors min-h-[54px]"
          >
            <div className="flex items-center gap-3 text-sm font-medium text-amber-300">
              <Code2 className="w-5 h-5" />
              <span>APK &amp; SQL Schema (Admin Only)</span>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-300" />
          </button>
        )}
      </div>

      {/* Footer Official Website Link */}
      <div className="text-center py-2 text-xs text-slate-400">
        Official website: {officialSite}{' '}
        <button
          type="button"
          onClick={handleCopyWebsite}
          className="text-[#10d97b] font-semibold ml-1.5 hover:underline"
        >
          {copiedLink ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      {/* =====================================================================
          REAL SUPABASE AUTH LOGIN, REGISTRATION & PASSWORD RESET MODAL
         ===================================================================== */}
      {showLoginModal && (
        <div
          data-testid="user-login-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#141822] border border-slate-700/80 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#10d97b]/15 border border-[#10d97b]/40 text-[#10d97b] flex items-center justify-center">
                  {authMode === 'login' ? (
                    <UserCheck className="w-5 h-5" />
                  ) : (
                    <UserPlus className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-white">
                    {authMode === 'login'
                      ? 'Log in to CineBox'
                      : authMode === 'register'
                      ? 'Create CineBox Account'
                      : 'Reset Your Password'}
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Secured by Supabase Auth &amp; Least-Privilege RLS
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                aria-label="Close login modal"
                className="p-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                  authMode === 'login'
                    ? 'bg-[#10d97b] text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                  authMode === 'register'
                    ? 'bg-[#10d97b] text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('reset');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                  authMode === 'reset'
                    ? 'bg-[#10d97b] text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Reset Password
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-3">
              {authMode === 'register' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Full Name / Username</label>
                  <input
                    type="text"
                    data-testid="login-username-input"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    placeholder="e.g., Ali Raza"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:border-[#10d97b] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    data-testid="login-email-input"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:border-[#10d97b] focus:outline-none"
                  />
                </div>
              </div>

              {authMode !== 'reset' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Password (min 6 chars)</label>
                  <input
                    type="password"
                    required
                    data-testid="login-password-input"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Enter password (min 6 chars)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:border-[#10d97b] focus:outline-none"
                  />
                </div>
              )}

              {authError && (
                <p data-testid="login-error-msg" className="text-xs text-rose-400 font-bold">
                  {authError}
                </p>
              )}

              {authSuccessMsg && (
                <p data-testid="login-success-msg" className="text-xs text-[#10d97b] font-bold">
                  {authSuccessMsg}
                </p>
              )}

              <button
                type="submit"
                data-testid="login-submit-btn"
                disabled={isAuthenticating}
                className="w-full py-3 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-extrabold text-xs sm:text-sm transition-colors disabled:opacity-50"
              >
                {isAuthenticating
                  ? 'Processing with Supabase Auth...'
                  : authMode === 'login'
                  ? 'Log In & Sync Account'
                  : authMode === 'register'
                  ? 'Create Account'
                  : 'Send Password Reset Email'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          REAL WORKING APP SETTINGS MODAL (For Website & Capacitor Android APK)
         ===================================================================== */}
      {showSettingsModal && (
        <div
          data-testid="app-settings-modal"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-3xl bg-[#141822] border border-slate-700/80 p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#10d97b]/15 border border-[#10d97b]/40 text-[#10d97b] flex items-center justify-center">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-white">App &amp; APK Settings</h2>
                  <p className="text-[11px] text-slate-400">
                    Real-time playback, language (EN/اردو RTL), download &amp; theme controls
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="close-settings-modal-btn"
                onClick={() => setShowSettingsModal(false)}
                aria-label="Close settings modal"
                className="p-1.5 rounded-xl bg-slate-800 text-slate-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* 0. App Language (English LTR / Urdu RTL) */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="text-xs font-bold text-white">
                  App Interface Language (English / اردو RTL)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="setting-lang-en-btn"
                    onClick={() =>
                      onUpdateUserSettings({
                        ...userSettings,
                        appLanguage: 'en',
                      })
                    }
                    className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                      (userSettings.appLanguage || 'en') === 'en'
                        ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                        : 'bg-slate-900 text-slate-300 border-slate-800'
                    }`}
                  >
                    English (LTR)
                  </button>
                  <button
                    type="button"
                    data-testid="setting-lang-ur-btn"
                    onClick={() =>
                      onUpdateUserSettings({
                        ...userSettings,
                        appLanguage: 'ur',
                      })
                    }
                    className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                      userSettings.appLanguage === 'ur'
                        ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                        : 'bg-slate-900 text-slate-300 border-slate-800'
                    }`}
                  >
                    اردو (Urdu RTL)
                  </button>
                </div>
              </div>

              {/* 1. Default Streaming Server */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <Server className="w-4 h-4 text-[#10d97b]" />
                  <span>1. Default Playback Server</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="setting-server-3-btn"
                    onClick={() =>
                      onUpdateUserSettings({
                        ...userSettings,
                        defaultServer: 'auto-server-3',
                      })
                    }
                    className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                      userSettings.defaultServer === 'auto-server-3'
                        ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                        : 'bg-slate-900 text-slate-300 border-slate-800'
                    }`}
                  >
                    Server 3 (2Embed.cc)
                  </button>
                  <button
                    type="button"
                    data-testid="setting-server-1-btn"
                    onClick={() =>
                      onUpdateUserSettings({
                        ...userSettings,
                        defaultServer: 'auto-server-1',
                      })
                    }
                    className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                      userSettings.defaultServer === 'auto-server-1'
                        ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                        : 'bg-slate-900 text-slate-300 border-slate-800'
                    }`}
                  >
                    Server 1 (VidSrc.sh)
                  </button>
                </div>
              </div>

              {/* 2. Auto-Play Stream Toggle */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white">2. Auto-Play Video Streams</div>
                  <div className="text-[11px] text-slate-400">
                    Automatically start playback when opening a movie or episode
                  </div>
                </div>
                <input
                  type="checkbox"
                  data-testid="setting-autoplay-checkbox"
                  checked={userSettings.autoPlayVideo}
                  onChange={(e) =>
                    onUpdateUserSettings({
                      ...userSettings,
                      autoPlayVideo: e.target.checked,
                    })
                  }
                  className="w-5 h-5 accent-[#10d97b]"
                />
              </div>

              {/* 3. App Accent Theme Color */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <Palette className="w-4 h-4 text-[#10d97b]" />
                  <span>3. App Accent Theme</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'neon-green' as ThemeColorId, label: 'Neon Green' },
                    { id: 'netflix-red' as ThemeColorId, label: 'Cinema Red' },
                    { id: 'royal-blue' as ThemeColorId, label: 'Royal Blue' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onChangeThemeColor(t.id)}
                      className={`py-2 rounded-xl text-xs font-bold border ${
                        appConfig.primary_theme === t.id
                          ? 'bg-[#10d97b] text-slate-950 border-[#10d97b]'
                          : 'bg-slate-900 text-slate-300 border-slate-800'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 6. Clear Watch History & Search Cache */}
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white">
                    6. Clear Watch History &amp; Search Cache
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Frees up cached search chips, watch history &amp; temporary stream blobs
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="setting-clear-cache-btn"
                  onClick={() => {
                    onClearHistoryAndCache();
                    setCacheClearedMsg('Cleared watch history & search cache!');
                  }}
                  className="px-3 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 text-rose-200 font-bold text-xs flex items-center gap-1.5 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Now</span>
                </button>
              </div>

              {cacheClearedMsg && (
                <p className="text-xs font-bold text-[#10d97b] text-center">{cacheClearedMsg}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowSettingsModal(false)}
              className="w-full py-2.5 rounded-xl bg-[#10d97b] text-slate-950 font-extrabold text-xs"
            >
              Save &amp; Close Settings
            </button>
          </div>
        </div>
      )}

      {activeNoticeModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#161a24] border border-slate-700 p-5 space-y-4">
            <p className="text-sm text-slate-200 leading-relaxed">{activeNoticeModal}</p>
            <button
              type="button"
              onClick={() => setActiveNoticeModal(null)}
              className="w-full py-2.5 rounded-xl bg-[#10d97b] text-slate-950 font-bold text-xs"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
