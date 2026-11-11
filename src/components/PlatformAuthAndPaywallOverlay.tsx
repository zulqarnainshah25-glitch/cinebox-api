import React, { useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Gift,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { AppUserRecord } from '../types/movie';
import {
  claimReferralCodeForUser,
  loginOrRegisterUser,
  requestPasswordResetEmail,
} from '../services/supabaseClient';
import {
  DetectedPlatform,
  REFERRALS_REQUIRED_FOR_UNLOCK,
  TrialAndReferralEvaluation,
  shareReferralLink,
} from '../services/platformTrialReferralService';
import { AppLanguageCode, getTranslation } from '../utils/i18n';

interface PlatformAuthAndPaywallOverlayProps {
  appName?: string;
  platform: DetectedPlatform;
  currentUser?: AppUserRecord | null;
  loggedInUser?: AppUserRecord | null;
  evaluation: TrialAndReferralEvaluation;
  pendingReferralCode?: string | null;
  initialReferralCode?: string | null;
  onUserAuthenticated?: (user: AppUserRecord) => void;
  onAuthSuccess?: (user: AppUserRecord, rewardMsg?: string) => void;
  onReferralUnlocked?: (updatedUser: AppUserRecord, rewardMsg: string) => void;
  onOpenAdminOverride?: () => void;
  onRefreshUsersAndSession?: () => Promise<void>;
  appLanguage?: AppLanguageCode;
}

export const PlatformAuthAndPaywallOverlay: React.FC<
  PlatformAuthAndPaywallOverlayProps
> = ({
  platform,
  currentUser,
  loggedInUser,
  evaluation,
  pendingReferralCode,
  initialReferralCode,
  onUserAuthenticated,
  onAuthSuccess,
  onReferralUnlocked,
  onRefreshUsersAndSession,
  appLanguage = 'en',
}) => {
  const activeUser = currentUser !== undefined ? currentUser : loggedInUser || null;
  const activeReferralCode =
    pendingReferralCode !== undefined ? pendingReferralCode : initialReferralCode || null;

  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [usernameInput, setUsernameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [referralCodeInput, setReferralCodeInput] = useState(
    activeReferralCode || ''
  );
  const [claimCodeInput, setClaimCodeInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

  const handleLoginOrSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setIsSubmitting(true);

    try {
      if (authMode === 'reset') {
        const resetRes = await requestPasswordResetEmail(emailInput);
        if (!resetRes.ok) {
          setFeedback({
            type: 'err',
            msg: resetRes.error || 'Could not send password reset email.',
          });
        } else {
          setFeedback({
            type: 'ok',
            msg: 'Password reset link sent! Please check your email inbox.',
          });
        }
        setIsSubmitting(false);
        return;
      }

      const res = await loginOrRegisterUser({
        username: authMode === 'signup' ? usernameInput : undefined,
        email: emailInput,
        password: passwordInput,
        mode: authMode,
        platform,
        referredByCode: referralCodeInput || activeReferralCode || null,
      });

      if (!res.ok || !res.user) {
        setFeedback({
          type: 'err',
          msg: res.error || 'Could not sign in. Please verify your email and password.',
        });
        setIsSubmitting(false);
        return;
      }

      const welcomeMsg =
        platform === 'Web'
          ? `Welcome ${res.user.username}! Direct Web access unlocked.`
          : `Welcome ${res.user.username}! Your 3-Day Free APK Trial is active.`;

      onUserAuthenticated?.(res.user);
      onAuthSuccess?.(res.user, welcomeMsg);
      await onRefreshUsersAndSession?.();
      setFeedback({
        type: 'ok',
        msg: welcomeMsg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShareReferral = async () => {
    const res = await shareReferralLink(evaluation.referralCode);
    if (res.copied || res.shared) {
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    }
  };

  const handleClaimReferralCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser) return;
    setFeedback(null);
    setIsSubmitting(true);

    try {
      const res = await claimReferralCodeForUser(activeUser.id, claimCodeInput);
      if (!res.ok) {
        setFeedback({
          type: 'err',
          msg: res.error || 'Failed to apply referral code.',
        });
        return;
      }

      const rewardMsg = res.referrerUnlockedThirtyDays
        ? 'Referral applied! Your friend just unlocked 30 Days of full APK access!'
        : 'Referral code linked to your authenticated account!';

      if (res.updatedUser) {
        onUserAuthenticated?.(res.updatedUser);
        onReferralUnlocked?.(res.updatedUser, rewardMsg);
      }
      await onRefreshUsersAndSession?.();
      setClaimCodeInput('');
      setFeedback({
        type: 'ok',
        msg: rewardMsg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* 1. APK 3-DAY TRIAL TOP BANNER (Hidden on Web) */}
      {platform === 'Android' && activeUser && evaluation.showTrialBanner && (
        <div
          data-testid="apk-trial-countdown-banner"
          className={`w-full px-3 sm:px-6 py-2 border-b text-xs flex flex-wrap items-center justify-between gap-2 ${
            evaluation.isReferralUnlocked
              ? 'bg-emerald-950/80 border-[#10d97b]/40 text-emerald-100'
              : evaluation.isTrialExpired
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-100'
              : 'bg-[#091e16] border-[#10d97b]/30 text-emerald-100'
          }`}
        >
          <div className="flex items-center gap-2 font-bold">
            <Clock className="w-3.5 h-3.5 text-[#10d97b] shrink-0" />
            <span data-testid="apk-trial-banner-text">
              {evaluation.trialBannerText}
            </span>
            {!evaluation.isReferralUnlocked && (
              <span className="hidden sm:inline text-[11px] text-slate-300 font-normal">
                • Refer 2 friends ({evaluation.successfulReferrals}/
                {REFERRALS_REQUIRED_FOR_UNLOCK}) for +30 Days Free Access
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-black/50 border border-[#10d97b]/30 font-mono text-[11px] text-[#10d97b]">
              {getTranslation(appLanguage, 'referralCodePrefix')} {evaluation.referralCode}
            </span>
            <button
              type="button"
              data-testid="apk-banner-share-referral-btn"
              onClick={handleShareReferral}
              className="px-2.5 py-1 rounded-lg bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-extrabold text-[11px] flex items-center gap-1 transition-colors"
            >
              {copiedShare ? (
                <Check className="w-3 h-3" />
              ) : (
                <Share2 className="w-3 h-3" />
              )}
              <span>
                {copiedShare
                  ? 'Link Copied!'
                  : getTranslation(appLanguage, 'shareLinkBtn')}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 2. APK PAYWALL OVERLAY WHEN 3-DAY TRIAL HAS EXPIRED AND < 2 REFERRALS */}
      {platform === 'Android' && currentUser && evaluation.isPaywallLocked && (
        <div
          data-testid="apk-referral-paywall-modal"
          className="fixed inset-0 z-[95] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-lg rounded-3xl bg-[#0e131d] border border-[#10d97b]/40 p-5 sm:p-6 shadow-2xl space-y-5 my-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-extrabold uppercase tracking-wider">
                    3-Day APK Trial Ended
                  </span>
                  <h2 className="text-lg sm:text-xl font-extrabold text-white mt-1">
                    Refer 2 Friends to Unlock 30 Days Free!
                  </h2>
                </div>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Your 3-day free Android APK trial has finished. Share your unique referral link with{' '}
              <span className="text-[#10d97b] font-bold">2 friends</span>. As soon as 2 authenticated friends register with your referral code, your app unlocks for{' '}
              <span className="text-white font-bold">30 Full Days</span> automatically!
            </p>

            {/* Progress Bar (X / 2 Referrals) */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-[#10d97b]" />
                  <span>Your Referral Progress</span>
                </span>
                <span
                  data-testid="paywall-referral-count"
                  className="font-mono font-extrabold text-[#10d97b]"
                >
                  {evaluation.successfulReferrals} / {REFERRALS_REQUIRED_FOR_UNLOCK} Friends Joined
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#10d97b] to-emerald-400 transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      (evaluation.successfulReferrals / REFERRALS_REQUIRED_FOR_UNLOCK) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="text-[11px] text-slate-400">
                {evaluation.referralsNeeded > 0
                  ? `Invite ${evaluation.referralsNeeded} more friend${
                      evaluation.referralsNeeded > 1 ? 's' : ''
                    } to unlock 30 days of unlimited HD streaming.`
                  : 'Unlocked! Refreshing your 30-day access...'}
              </div>
            </div>

            {/* Unique Referral Link & Share Button */}
            <div className="p-4 rounded-2xl bg-[#091914] border border-[#10d97b]/30 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-semibold">Your Unique Referral Code:</span>
                <span
                  data-testid="paywall-referral-code"
                  className="font-mono font-extrabold text-sm text-[#10d97b]"
                >
                  {evaluation.referralCode}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-black/60 border border-slate-800 font-mono text-[11px] text-slate-300 truncate">
                {evaluation.referralShareUrl}
              </div>

              <button
                type="button"
                data-testid="paywall-share-referral-btn"
                onClick={handleShareReferral}
                className="w-full py-3 rounded-xl bg-[#10d97b] hover:bg-[#0fc36d] text-slate-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#10d97b]/20 transition-all"
              >
                {copiedShare ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Referral Link Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4" />
                    <span>Share Referral Link (WhatsApp / System Share)</span>
                  </>
                )}
              </button>
            </div>

            {/* Claim a Friend's Referral Code on your own authenticated account */}
            {!currentUser.referred_by && (
              <form
                onSubmit={handleClaimReferralCode}
                className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2"
              >
                <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Gift className="w-3.5 h-3.5 text-[#10d97b]" />
                  <span>Have a Friend&apos;s Referral Code?</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={claimCodeInput}
                    onChange={(e) => setClaimCodeInput(e.target.value.toUpperCase())}
                    placeholder="CBX-XXXXXX"
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-[#10d97b]"
                  >
                    Apply Code
                  </button>
                </div>
              </form>
            )}

            {feedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-medium ${
                  feedback.type === 'ok'
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                }`}
              >
                {feedback.msg}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
