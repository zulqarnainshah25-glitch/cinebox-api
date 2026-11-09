import React, { useState } from 'react';
import {
  Check,
  Copy,
  Gift,
  Lock,
  LogIn,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import { AppUserRecord } from '../types/movie';
import {
  creditReferralCodeOwner,
  loginOrRegisterUser,
} from '../services/supabaseClient';
import {
  DetectedPlatform,
  REFERRALS_REQUIRED_FOR_UNLOCK,
  shareReferralLink,
  TrialAndReferralEvaluation,
} from '../services/platformTrialReferralService';
import { CineBoxBrandLogo } from './CineBoxBrandLogo';

interface PlatformAuthAndPaywallOverlayProps {
  appName: string;
  platform: DetectedPlatform;
  loggedInUser: AppUserRecord | null;
  evaluation: TrialAndReferralEvaluation;
  initialReferralCode?: string | null;
  onAuthSuccess: (user: AppUserRecord, rewardMsg?: string) => void;
  onReferralUnlocked: (updatedUser: AppUserRecord, rewardMsg: string) => void;
  onOpenAdminOverride: () => void;
}

export const PlatformAuthAndPaywallOverlay: React.FC<
  PlatformAuthAndPaywallOverlayProps
> = ({
  appName,
  platform,
  loggedInUser,
  evaluation,
  initialReferralCode,
  onAuthSuccess,
  onReferralUnlocked,
  onOpenAdminOverride,
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [referralCodeInput, setReferralCodeInput] = useState<string>(
    initialReferralCode || ''
  );
  const [authError, setAuthError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Paywall Referral Share & Friend Verification State
  const [copiedShareUrl, setCopiedShareUrl] = useState<boolean>(false);
  const [shareStatusMsg, setShareStatusMsg] = useState<string>('');
  const [friendEmail, setFriendEmail] = useState<string>('');
  const [isCreditingReferral, setIsCreditingReferral] = useState<boolean>(false);

  const handleLoginOrSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsSubmitting(true);
    try {
      const res = await loginOrRegisterUser({
        email,
        password,
        username: authMode === 'register' ? username : undefined,
        mode: authMode,
        referredByCode: referralCodeInput.trim() || initialReferralCode || null,
        platformOverride: platform,
      });

      if (!res.ok || !res.user) {
        setAuthError(res.error || 'Authentication failed. Please check your details.');
        return;
      }

      onAuthSuccess(res.user, res.referralRewardMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShareReferral = async () => {
    const res = await shareReferralLink(evaluation.referralCode);
    if (res.shared) {
      setShareStatusMsg('Referral link shared successfully!');
    } else if (res.copied) {
      setCopiedShareUrl(true);
      setShareStatusMsg('Referral link copied to clipboard!');
      setTimeout(() => setCopiedShareUrl(false), 2500);
    } else {
      setShareStatusMsg(`Share link: ${res.shareUrl}`);
    }
  };

  const handleRecordReferredFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanFriendEmail = friendEmail.trim().toLowerCase();
    if (!cleanFriendEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanFriendEmail)) {
      setShareStatusMsg('Please enter a valid email address for the referred friend.');
      return;
    }

    setIsCreditingReferral(true);
    setShareStatusMsg('');
    try {
      // Register the referred friend with `referred_by = evaluation.referralCode`
      const friendSignup = await loginOrRegisterUser({
        email: cleanFriendEmail,
        password: 'friend1234',
        username: cleanFriendEmail.split('@')[0],
        mode: 'register',
        referredByCode: evaluation.referralCode,
        platformOverride: 'Android',
      });

      if (!friendSignup.ok) {
        setShareStatusMsg(friendSignup.error || 'Could not verify referral.');
        return;
      }

      // Restore the base user's session if loginOrRegisterUser switched active user
      if (loggedInUser) {
        const creditRes =
          friendSignup.referrerUpdated && friendSignup.referrerUpdated.id === loggedInUser.id
            ? {
                ok: true,
                referrer: friendSignup.referrerUpdated,
                message:
                  friendSignup.referralRewardMessage ||
                  'Referral credited successfully!',
              }
            : await creditReferralCodeOwner(evaluation.referralCode, cleanFriendEmail);

        if (creditRes.ok && creditRes.referrer) {
          try {
            localStorage.setItem(
              'cinebox_logged_in_user_v1',
              JSON.stringify(creditRes.referrer)
            );
            localStorage.setItem('cinebox_current_user_id_v1', creditRes.referrer.id);
          } catch {
            // ignore
          }
          setFriendEmail('');
          setShareStatusMsg(creditRes.message || 'Referral credited!');
          onReferralUnlocked(
            creditRes.referrer,
            creditRes.message || 'Referral credited!'
          );
        }
      }
    } finally {
      setIsCreditingReferral(false);
    }
  };

  // =========================================================================
  // CASE 1: APK 3-DAY TRIAL EXPIRED -> LOCK APP & SHOW ONLY REFERRAL SCREEN
  // =========================================================================
  if (platform === 'Android' && loggedInUser && evaluation.isPaywallLocked) {
    const progressPercent = Math.min(
      100,
      Math.round(
        (evaluation.successfulReferrals / REFERRALS_REQUIRED_FOR_UNLOCK) * 100
      )
    );

    return (
      <div
        data-testid="apk-referral-paywall-screen"
        className="fixed inset-0 z-50 bg-[#080a0f] text-slate-100 overflow-y-auto flex items-center justify-center p-4"
      >
        <div className="w-full max-w-lg rounded-3xl bg-[#121621] border border-emerald-500/35 p-6 sm:p-7 shadow-2xl space-y-5">
          <div className="flex items-center justify-between">
            <CineBoxBrandLogo appName={appName} size="md" />
            <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-[11px] font-bold text-amber-300 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              <span>3-Day APK Trial Ended</span>
            </span>
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white">
              Unlock 30 Days Free Access via Referrals
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Your 3-day Android APK free trial has ended. Invite{' '}
              <strong className="text-[#10d97b]">2 friends</strong> using your unique referral link to immediately unlock{' '}
              <strong className="text-white">30 Days of Unlimited Full HD Streaming &amp; Downloads</strong>!
            </p>
          </div>

          {/* Progress Counter Card */}
          <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#10d97b]" />
                <span>Successful Referrals</span>
              </span>
              <span
                data-testid="paywall-referral-count"
                className="font-mono font-extrabold text-[#10d97b] text-sm"
              >
                {evaluation.successfulReferrals} / {REFERRALS_REQUIRED_FOR_UNLOCK} Completed
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#10d97b] to-emerald-400 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <p className="text-[11px] text-slate-400">
              {evaluation.referralsNeeded > 0
                ? `${evaluation.referralsNeeded} more referral(s) needed to unlock 30 days of full access.`
                : '2 referrals completed! Unlocking your account...'}
            </p>
          </div>

          {/* Unique Referral Code & Share Link */}
          <div className="p-4 rounded-2xl bg-[#0d1f18] border border-[#10d97b]/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider font-bold text-emerald-300">
                Your Unique Referral Code
              </span>
              <span
                data-testid="user-referral-code-badge"
                className="px-2.5 py-0.5 rounded-lg bg-slate-950 border border-[#10d97b]/50 font-mono text-xs font-extrabold text-[#10d97b]"
              >
                {evaluation.referralCode}
              </span>
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 text-xs font-mono text-slate-200">
              <span
                data-testid="user-referral-share-url"
                className="truncate flex-1"
              >
                {evaluation.referralShareUrl}
              </span>
              <button
                type="button"
                data-testid="copy-referral-link-btn"
                onClick={handleShareReferral}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[#10d97b] text-[11px] font-sans font-bold flex items-center gap-1 shrink-0"
              >
                {copiedShareUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <button
              type="button"
              data-testid="share-referral-link-btn"
              onClick={handleShareReferral}
              className="w-full py-3 px-4 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-98 min-h-[44px]"
            >
              <Share2 className="w-4 h-4" />
              <span>Share Referral Link with Friends</span>
            </button>
          </div>

          {/* Instant Referral Verification Form (When a friend joins via your referral code) */}
          <form
            onSubmit={handleRecordReferredFriend}
            data-testid="verify-friend-referral-form"
            className="p-4 rounded-2xl bg-slate-950/75 border border-slate-800/90 space-y-2.5"
          >
            <label
              htmlFor="referred-friend-email-input"
              className="block text-xs font-bold text-slate-200"
            >
              Friend Joined via Your Link? Enter Their Email to Verify Instant Credit:
            </label>
            <div className="flex items-center gap-2">
              <input
                id="referred-friend-email-input"
                type="email"
                data-testid="referred-friend-email-input"
                value={friendEmail}
                onChange={(e) => setFriendEmail(e.target.value)}
                placeholder="friend@example.com"
                className="flex-1 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#10d97b]"
              />
              <button
                type="submit"
                data-testid="credit-referral-submit-btn"
                disabled={isCreditingReferral}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shrink-0 min-h-[40px]"
              >
                {isCreditingReferral ? 'Verifying...' : '+1 Credit'}
              </button>
            </div>
          </form>

          {shareStatusMsg && (
            <div
              role="status"
              data-testid="referral-status-message"
              className="p-3 rounded-xl bg-emerald-950/90 border border-[#10d97b]/40 text-xs text-emerald-100 font-semibold flex items-center gap-2"
            >
              <Gift className="w-4 h-4 text-[#10d97b] shrink-0" />
              <span>{shareStatusMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
            <span>Account ID: {loggedInUser.id}</span>
            <button
              type="button"
              onClick={onOpenAdminOverride}
              className="text-slate-400 hover:text-[#10d97b] underline"
            >
              Admin Console
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CASE 2: DIRECT LOGIN / SIGNUP SCREEN
  // - For Web ('Web'): Direct Login/Signup with NO trial timer, NO referral paywall
  // - For Android ('Android'): Signup/Login to activate the 3-Day APK Trial
  // =========================================================================
  if (!loggedInUser && evaluation.requiresWebDirectLogin) {
    return (
      <div
        data-testid="web-direct-login-screen"
        className="fixed inset-0 z-50 bg-[#080a0f]/95 backdrop-blur-md text-slate-100 overflow-y-auto flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-3xl bg-[#131722] border border-slate-800 p-6 sm:p-7 shadow-2xl space-y-5">
          <div className="flex items-center justify-between">
            <CineBoxBrandLogo appName={appName} size="md" />
            <span
              data-testid="detected-platform-badge"
              className="px-2.5 py-1 rounded-full bg-[#10d97b]/15 border border-[#10d97b]/40 text-[11px] font-bold text-[#10d97b] flex items-center gap-1"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>{platform === 'Android' ? 'Android APK' : 'Web Direct Access'}</span>
            </span>
          </div>

          <div className="space-y-1">
            <h1 className="text-xl font-extrabold text-white">
              {platform === 'Web'
                ? 'Sign In to Stream Full HD Movies & Dramas'
                : 'Sign Up on Android APK — Start Your 3-Day Free Trial'}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              {platform === 'Web'
                ? 'Web Browser users enjoy direct instant access with zero trial timers or paywalls.'
                : 'Register your Android APK account to start your 3-Day Free Trial and get your unique referral code.'}
            </p>
          </div>

          {/* Login / Signup Mode Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              data-testid="auth-mode-login-tab"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
              }}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                authMode === 'login'
                  ? 'bg-[#10d97b] text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Direct Login</span>
            </button>
            <button
              type="button"
              data-testid="auth-mode-register-tab"
              onClick={() => {
                setAuthMode('register');
                setAuthError('');
              }}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                authMode === 'register'
                  ? 'bg-[#10d97b] text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>

          <form onSubmit={handleLoginOrSignup} className="space-y-3.5">
            {authMode === 'register' && (
              <div>
                <label
                  htmlFor="platform-auth-username"
                  className="block text-xs font-semibold text-slate-300 mb-1"
                >
                  Full Name / Username
                </label>
                <input
                  id="platform-auth-username"
                  type="text"
                  data-testid="platform-auth-username-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g., Ali Khan"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#10d97b]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="platform-auth-email"
                className="block text-xs font-semibold text-slate-300 mb-1"
              >
                Email Address
              </label>
              <input
                id="platform-auth-email"
                type="email"
                required
                data-testid="platform-auth-email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#10d97b]"
              />
            </div>

            <div>
              <label
                htmlFor="platform-auth-password"
                className="block text-xs font-semibold text-slate-300 mb-1"
              >
                Password
              </label>
              <input
                id="platform-auth-password"
                type="password"
                required
                data-testid="platform-auth-password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 4 characters"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#10d97b]"
              />
            </div>

            <div>
              <label
                htmlFor="platform-auth-referral"
                className="block text-xs font-semibold text-slate-400 mb-1"
              >
                Referral Code (Optional — if invited by a friend)
              </label>
              <input
                id="platform-auth-referral"
                type="text"
                data-testid="platform-auth-referral-input"
                value={referralCodeInput}
                onChange={(e) => setReferralCodeInput(e.target.value.toUpperCase())}
                placeholder="e.g., CBX-7F9A2K"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-[#10d97b] focus:outline-none focus:border-[#10d97b]"
              />
            </div>

            {authError && (
              <div
                role="alert"
                data-testid="platform-auth-error"
                className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/40 text-xs text-rose-200"
              >
                {authError}
              </div>
            )}

            <button
              type="submit"
              data-testid="platform-auth-submit-btn"
              disabled={isSubmitting}
              className="w-full py-3 px-4 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-colors min-h-[44px]"
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {isSubmitting
                  ? 'Signing in...'
                  : platform === 'Web'
                  ? authMode === 'login'
                    ? 'Login & Watch Movies Directly'
                    : 'Sign Up & Watch Movies Directly'
                  : 'Start 3-Day Free APK Trial'}
              </span>
            </button>
          </form>

          <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-[#10d97b]" />
              <span>Synced with Supabase app_users</span>
            </span>
            <button
              type="button"
              onClick={onOpenAdminOverride}
              className="text-slate-400 hover:text-[#10d97b] underline"
            >
              Admin Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
