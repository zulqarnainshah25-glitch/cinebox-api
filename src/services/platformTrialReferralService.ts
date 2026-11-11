import { Capacitor } from '@capacitor/core';
import { AppUserRecord } from '../types/movie';

export const TRIAL_DURATION_DAYS = 3;
export const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;
export const REFERRALS_REQUIRED_FOR_UNLOCK = 2;
export const REFERRAL_REWARD_DAYS = 30;
export const REFERRAL_REWARD_MS = REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000;
export const SIMULATED_PLATFORM_STORAGE_KEY = 'cinebox_simulated_platform_v1';
export const PENDING_REFERRAL_CODE_STORAGE_KEY = 'cinebox_pending_referral_code_v1';

export type DetectedPlatform = 'Android' | 'Web';

/**
 * 1. Platform Detection Logic (Capacitor):
 * Uses `@capacitor/core`'s `Capacitor.isNativePlatform()`.
 * - Returns `'Android'` when `Capacitor.isNativePlatform()` is `true` (or when simulated via `?platform=apk`).
 * - Returns `'Web'` when `Capacitor.isNativePlatform()` is `false`.
 */
export function detectAppPlatform(options?: {
  forceNativeOverride?: boolean;
  locationSearch?: string;
}): DetectedPlatform {
  if (typeof options?.forceNativeOverride === 'boolean') {
    return options.forceNativeOverride ? 'Android' : 'Web';
  }

  // Allow URL query param or localStorage simulation for QA/browser verification of APK mode
  if (typeof window !== 'undefined') {
    try {
      const searchStr = options?.locationSearch ?? window.location.search;
      const params = new URLSearchParams(searchStr);
      const qPlatform = (params.get('platform') || '').toLowerCase();
      if (qPlatform === 'apk' || qPlatform === 'android') {
        return 'Android';
      }
      if (qPlatform === 'web') {
        return 'Web';
      }
      const storedSim = localStorage.getItem(SIMULATED_PLATFORM_STORAGE_KEY);
      if (storedSim === 'Android' || storedSim === 'Web') {
        return storedSim;
      }
    } catch {
      // ignore
    }
  }

  try {
    const isNative = Capacitor.isNativePlatform();
    return isNative ? 'Android' : 'Web';
  } catch {
    return 'Web';
  }
}

export function setSimulatedPlatformOverride(platform: DetectedPlatform | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!platform) {
      localStorage.removeItem(SIMULATED_PLATFORM_STORAGE_KEY);
    } else {
      localStorage.setItem(SIMULATED_PLATFORM_STORAGE_KEY, platform);
    }
  } catch {
    // ignore
  }
}

/**
 * Generates a deterministic, clean, collision-resistant unique referral code for a user.
 * Format: `CBX-XXXXXX` (uppercase alphanumeric).
 */
export function generateUniqueReferralCode(seedInput: string): string {
  const clean = (seedInput || 'user').trim().toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const combined = ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const codeBody = (combined + '9X7K2M').slice(0, 6);
  return `CBX-${codeBody}`;
}

/**
 * Sanitizes and validates a referral code (e.g. `CBX-7F9A2K`).
 */
export function sanitizeReferralCode(rawCode: string | null | undefined): string | null {
  if (!rawCode || typeof rawCode !== 'string') return null;
  const cleaned = rawCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (!/^CBX-[A-Z0-9]{4,12}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export const normalizeReferralCode = sanitizeReferralCode;

export function buildInitialTrialAndReferralFields(params: {
  email: string;
  referredByCode?: string | null;
  nowMs?: number;
}): {
  trial_start_date: string;
  trial_end_date: string;
  referral_code: string;
  referred_by: string | null;
} {
  const now = params.nowMs ?? Date.now();
  return {
    trial_start_date: new Date(now).toISOString(),
    trial_end_date: new Date(now + TRIAL_DURATION_MS).toISOString(),
    referral_code: generateUniqueReferralCode(params.email),
    referred_by: sanitizeReferralCode(params.referredByCode),
  };
}

/**
 * Extracts a referral code from either `/ref/{code}` path or `?ref={code}` query string.
 */
export function extractReferralCodeFromLocation(
  pathname: string = '',
  search: string = ''
): string | null {
  const pathMatch = (pathname || '').match(/\/ref\/([a-zA-Z0-9-]{4,20})/i);
  if (pathMatch && pathMatch[1]) {
    const valid = sanitizeReferralCode(pathMatch[1]);
    if (valid) return valid;
  }
  try {
    const params = new URLSearchParams(search || '');
    const fromQuery = params.get('ref') || params.get('referral');
    if (fromQuery) {
      return sanitizeReferralCode(fromQuery);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Builds the shareable referral URL: `https://aapki-site.com/ref/{code}`
 */
export function buildReferralShareUrl(referralCode: string, baseOrigin?: string): string {
  const safeCode = sanitizeReferralCode(referralCode) || generateUniqueReferralCode(referralCode);
  const rawOrigin =
    baseOrigin ||
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://cineboxmovies.ai.studio');
  const normalizedOrigin = rawOrigin.replace(/\/+$/, '');
  return `${normalizedOrigin}/ref/${safeCode}`;
}

/**
 * Shares the referral link using `navigator.share` when available on Android/mobile browsers,
 * or copies to clipboard as a reliable fallback.
 */
export async function shareReferralLink(
  referralCode: string,
  baseOrigin?: string
): Promise<{ shared: boolean; copied: boolean; shareUrl: string }> {
  const shareUrl = buildReferralShareUrl(referralCode, baseOrigin);
  const shareData = {
    title: 'CineBox HD — Watch Movies & Pakistani Dramas Free',
    text: `Join CineBox HD using my referral code (${referralCode}) to stream full HD movies & dramas!`,
    url: shareUrl,
  };

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(shareData);
      return { shared: true, copied: false, shareUrl };
    } catch {
      // User cancelled or WebView blocked navigator.share -> fallback to clipboard
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      return { shared: false, copied: true, shareUrl };
    } catch {
      // ignore
    }
  }

  return { shared: false, copied: false, shareUrl };
}

export interface TrialAndReferralEvaluation {
  platform: DetectedPlatform;
  requiresWebDirectLogin: boolean;
  showTrialBanner: boolean;
  trialBannerText: string;
  isTrialExpired: boolean;
  isReferralUnlocked: boolean;
  isPaywallLocked: boolean;
  daysRemaining: number;
  hoursRemaining: number;
  successfulReferrals: number;
  referralsNeeded: number;
  referralCode: string;
  referralShareUrl: string;
  accessExpiryDate: string | null;
}

/**
 * Evaluates the complete platform-specific access, 3-day APK trial countdown,
 * and 2-referral 30-day unlock state for a user at `nowMs`.
 */
export function evaluatePlatformTrialAndReferralState(params: {
  platform: DetectedPlatform;
  user: AppUserRecord | null;
  nowMs?: number;
  baseOrigin?: string;
}): TrialAndReferralEvaluation {
  const nowMs = params.nowMs ?? Date.now();
  const { platform, user, baseOrigin } = params;

  const referralCode =
    sanitizeReferralCode(user?.referral_code) ||
    generateUniqueReferralCode(user?.email || user?.id || 'cinebox-guest');
  const referralShareUrl = buildReferralShareUrl(referralCode, baseOrigin);
  const successfulReferrals = Math.max(0, Math.floor(Number(user?.successful_referrals) || 0));
  const referralsNeeded = Math.max(0, REFERRALS_REQUIRED_FOR_UNLOCK - successfulReferrals);

  // 1. WEB PLATFORM: Direct Login only — NO trial timer, NO referral screen, NO paywall
  if (platform === 'Web') {
    return {
      platform: 'Web',
      requiresWebDirectLogin: !user,
      showTrialBanner: false,
      trialBannerText: '',
      isTrialExpired: false,
      isReferralUnlocked: true,
      isPaywallLocked: false,
      daysRemaining: 0,
      hoursRemaining: 0,
      successfulReferrals,
      referralsNeeded: 0,
      referralCode,
      referralShareUrl,
      accessExpiryDate: user?.access_expiry_date || null,
    };
  }

  // 2. ANDROID APK PLATFORM:
  // If user is not logged in / registered yet on APK, require registration to start 3-day trial
  if (!user) {
    return {
      platform: 'Android',
      requiresWebDirectLogin: true,
      showTrialBanner: false,
      trialBannerText: 'Register on APK to start your 3-Day Free Trial',
      isTrialExpired: false,
      isReferralUnlocked: false,
      isPaywallLocked: false,
      daysRemaining: TRIAL_DURATION_DAYS,
      hoursRemaining: 0,
      successfulReferrals: 0,
      referralsNeeded: REFERRALS_REQUIRED_FOR_UNLOCK,
      referralCode,
      referralShareUrl,
      accessExpiryDate: null,
    };
  }

  // Check if user has unlocked 30-day access via >= 2 successful referrals
  const expiryMs = user.access_expiry_date ? Date.parse(user.access_expiry_date) : NaN;
  const hasActiveReferralUnlock =
    successfulReferrals >= REFERRALS_REQUIRED_FOR_UNLOCK &&
    Number.isFinite(expiryMs) &&
    expiryMs > nowMs;

  if (hasActiveReferralUnlock) {
    const remainingUnlockMs = Math.max(0, expiryMs - nowMs);
    const unlockDays = Math.floor(remainingUnlockMs / (24 * 60 * 60 * 1000));
    const unlockHours = Math.floor(
      (remainingUnlockMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)
    );
    return {
      platform: 'Android',
      requiresWebDirectLogin: false,
      showTrialBanner: true,
      trialBannerText: `Referral VIP Active: ${unlockDays} Days ${unlockHours} Hours Remaining`,
      isTrialExpired: false,
      isReferralUnlocked: true,
      isPaywallLocked: false,
      daysRemaining: unlockDays,
      hoursRemaining: unlockHours,
      successfulReferrals,
      referralsNeeded: 0,
      referralCode,
      referralShareUrl,
      accessExpiryDate: user.access_expiry_date || null,
    };
  }

  // Compute 3-day trial window
  const startMs = user.trial_start_date ? Date.parse(user.trial_start_date) : nowMs;
  const endMs = user.trial_end_date
    ? Date.parse(user.trial_end_date)
    : (Number.isFinite(startMs) ? startMs : nowMs) + TRIAL_DURATION_MS;

  const remainingMs = endMs - nowMs;
  if (remainingMs <= 0) {
    // Trial has expired and user does not have active referral unlock -> Lock app with Paywall!
    return {
      platform: 'Android',
      requiresWebDirectLogin: false,
      showTrialBanner: true,
      trialBannerText: 'Trial Ends in: 0 Days 0 Hours (Expired)',
      isTrialExpired: true,
      isReferralUnlocked: false,
      isPaywallLocked: true,
      daysRemaining: 0,
      hoursRemaining: 0,
      successfulReferrals,
      referralsNeeded,
      referralCode,
      referralShareUrl,
      accessExpiryDate: user.access_expiry_date || null,
    };
  }

  const daysRemaining = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hoursRemaining = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  return {
    platform: 'Android',
    requiresWebDirectLogin: false,
    showTrialBanner: true,
    trialBannerText: `Trial Ends in: ${daysRemaining} Days ${hoursRemaining} Hours`,
    isTrialExpired: false,
    isReferralUnlocked: false,
    isPaywallLocked: false,
    daysRemaining,
    hoursRemaining,
    successfulReferrals,
    referralsNeeded,
    referralCode,
    referralShareUrl,
    accessExpiryDate: user.access_expiry_date || null,
  };
}

/**
 * Pure state transition function for applying a referral when a new user signs up with `referredByCode`.
 * - Increments `successful_referrals` by +1 on the matching base user.
 * - As soon as `successful_referrals >= 2`, sets `access_expiry_date = current_date + 30 days`
 *   and unlocks the base user's app!
 */
export function applyReferralRewardToReferrer(
  referrerUser: AppUserRecord,
  newUserEmail: string,
  nowMs: number = Date.now()
): {
  updatedReferrer: AppUserRecord;
  unlockedThirtyDays: boolean;
  rewardMessage: string;
} {
  if (referrerUser.email.trim().toLowerCase() === newUserEmail.trim().toLowerCase()) {
    return {
      updatedReferrer: referrerUser,
      unlockedThirtyDays: false,
      rewardMessage: 'Self-referral is not permitted.',
    };
  }

  const prevCount = Math.max(0, Math.floor(Number(referrerUser.successful_referrals) || 0));
  const nextCount = prevCount + 1;
  const unlockedThirtyDays = nextCount >= REFERRALS_REQUIRED_FOR_UNLOCK;

  const nextExpiryIso = unlockedThirtyDays
    ? new Date(nowMs + REFERRAL_REWARD_MS).toISOString()
    : referrerUser.access_expiry_date || null;

  const updatedReferrer: AppUserRecord = {
    ...referrerUser,
    successful_referrals: nextCount,
    access_expiry_date: nextExpiryIso,
    role: unlockedThirtyDays && referrerUser.role === 'user' ? 'vip' : referrerUser.role,
    vip_until: unlockedThirtyDays
      ? nextExpiryIso!.slice(0, 10)
      : referrerUser.vip_until,
    updated_at: new Date(nowMs).toISOString(),
  };

  const rewardMessage = unlockedThirtyDays
    ? `Congratulations! ${nextCount} referrals completed — App unlocked for 30 days until ${nextExpiryIso!.slice(0, 10)}!`
    : `Referral credited (${nextCount}/${REFERRALS_REQUIRED_FOR_UNLOCK})! Invite ${
        REFERRALS_REQUIRED_FOR_UNLOCK - nextCount
      } more friend to unlock 30 days of full access.`;

  return {
    updatedReferrer,
    unlockedThirtyDays,
    rewardMessage,
  };
}
