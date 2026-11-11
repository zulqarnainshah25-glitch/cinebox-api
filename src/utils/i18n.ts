/**
 * CineBox Bilingual i18n Layer (English + Urdu with automatic RTL support)
 */

export type AppLanguageCode = 'en' | 'ur';

export interface I18nDictionary {
  // Bottom Navigation
  navHome: string;
  navSearch: string;
  navDownloads: string;
  navWatchlist: string;
  navMe: string;

  // Categories
  catTrending: string;
  catHollywood: string;
  catBollywood: string;
  catSeries: string;
  catKorean: string;
  catPakDramas: string;
  catAnime: string;

  // Header & Search
  searchPlaceholder: string;
  searchButton: string;
  downloadApkShort: string;
  adminBadge: string;
  languageToggleLabel: string;

  // Trial & Referral Banner
  trialEndsInPrefix: string;
  shareLinkBtn: string;
  referralCodePrefix: string;

  // Auth & Paywall Overlay
  signInTitle: string;
  signUpTitle: string;
  resetPasswordTitle: string;
  emailLabel: string;
  passwordLabel: string;
  usernameLabel: string;
  referralCodeOptionalLabel: string;
  signInBtn: string;
  signUpBtn: string;
  sendResetLinkBtn: string;
  forgotPasswordLink: string;
  backToSignInLink: string;
  signOutBtn: string;

  // Admin Supabase Auth Login
  adminSignInHeading: string;
  adminSignInSubtitle: string;
  adminMagicLinkBtn: string;
  adminRoleRequiredError: string;
  adminSignedOutNotice: string;

  // Profile / Me View
  watchHistoryTitle: string;
  myListTitle: string;
  officialApkHeading: string;
  referralCenterHeading: string;
  appLanguageSetting: string;
}

export const TRANSLATIONS: Record<AppLanguageCode, I18nDictionary> = {
  en: {
    navHome: 'Home',
    navSearch: 'Search',
    navDownloads: 'Downloads',
    navWatchlist: 'Watchlist',
    navMe: 'Me',

    catTrending: 'Trending',
    catHollywood: 'Hollywood',
    catBollywood: 'Bollywood (Hindi)',
    catSeries: 'Web Series',
    catKorean: 'K-Drama (Hindi)',
    catPakDramas: 'Pakistani Dramas',
    catAnime: 'Anime',

    searchPlaceholder: 'Search movies, series, Hindi dubbed...',
    searchButton: 'Search',
    downloadApkShort: 'APK',
    adminBadge: 'Admin',
    languageToggleLabel: 'اردو',

    trialEndsInPrefix: 'Trial Ends in:',
    shareLinkBtn: 'Share Link',
    referralCodePrefix: 'Code:',

    signInTitle: 'Sign In to CineBox',
    signUpTitle: 'Create CineBox Account',
    resetPasswordTitle: 'Reset Your Password',
    emailLabel: 'Email Address',
    passwordLabel: 'Password (min 6 chars)',
    usernameLabel: 'Display Name',
    referralCodeOptionalLabel: 'Referral Code (Optional)',
    signInBtn: 'Sign In',
    signUpBtn: 'Create Account',
    sendResetLinkBtn: 'Send Password Reset Email',
    forgotPasswordLink: 'Forgot password?',
    backToSignInLink: 'Back to Sign In',
    signOutBtn: 'Log out',

    adminSignInHeading: 'Supabase Admin Authentication',
    adminSignInSubtitle:
      'Sign in with your Supabase Admin account (requires JWT claim app_metadata.role = "admin").',
    adminMagicLinkBtn: 'Send Admin Magic Link',
    adminRoleRequiredError:
      'Access denied: Authenticated user does not have app_metadata.role = "admin".',
    adminSignedOutNotice: 'Signed out of Admin session.',

    watchHistoryTitle: 'Watch History',
    myListTitle: 'My List',
    officialApkHeading: 'Official Android APK',
    referralCenterHeading: 'Referral & Rewards Center',
    appLanguageSetting: 'App Language (English / اردو)',
  },
  ur: {
    navHome: 'ہوم',
    navSearch: 'تلاش',
    navDownloads: 'ڈاؤن لوڈز',
    navWatchlist: 'میری لسٹ',
    navMe: 'پروفائل',

    catTrending: 'ٹرینڈنگ',
    catHollywood: 'ہالی ووڈ',
    catBollywood: 'بالی ووڈ (ہندی)',
    catSeries: 'ویب سیریز',
    catKorean: 'کورین ڈرامہ',
    catPakDramas: 'پاکستانی ڈرامے',
    catAnime: 'اینیمی',

    searchPlaceholder: 'فلمیں، ویب سیریز یا ڈرامے تلاش کریں...',
    searchButton: 'تلاش کریں',
    downloadApkShort: 'اے پی کے',
    adminBadge: 'ایڈمن',
    languageToggleLabel: 'EN',

    trialEndsInPrefix: 'ٹرائل ختم ہونے میں باقی:',
    shareLinkBtn: 'لنک شیئر کریں',
    referralCodePrefix: 'کوڈ:',

    signInTitle: 'سائن ان کریں (CineBox)',
    signUpTitle: 'نیا اکاؤنٹ بنائیں',
    resetPasswordTitle: 'پاس ورڈ ری سیٹ کریں',
    emailLabel: 'ای میل ایڈریس',
    passwordLabel: 'پاس ورڈ (کم از کم 6 حروف)',
    usernameLabel: 'آپ کا نام',
    referralCodeOptionalLabel: 'ریفرل کوڈ (اختیاری)',
    signInBtn: 'سائن ان کریں',
    signUpBtn: 'اکاؤنٹ بنائیں',
    sendResetLinkBtn: 'ری سیٹ لنک بھیجیں',
    forgotPasswordLink: 'پاس ورڈ بھول گئے؟',
    backToSignInLink: 'واپس سائن ان پر جائیں',
    signOutBtn: 'لاگ آؤٹ',

    adminSignInHeading: 'ایڈمن سیکیور لاگ ان (Supabase Auth)',
    adminSignInSubtitle:
      'اپنے ایڈمن ای میل اور پاس ورڈ سے لاگ ان کریں (app_metadata.role = "admin" لازمی ہے)۔',
    adminMagicLinkBtn: 'ایڈمن میجک لنک بھیجیں',
    adminRoleRequiredError:
      'رسائی مسترد: اس اکاؤنٹ کے پاس app_metadata.role = "admin" کا اختیار نہیں ہے۔',
    adminSignedOutNotice: 'ایڈمن سیشن سے لاگ آؤٹ کر دیا گیا۔',

    watchHistoryTitle: 'دیکھی گئی فلمیں',
    myListTitle: 'میری واچ لسٹ',
    officialApkHeading: 'آفیشل اینڈرائیڈ اے پی کے',
    referralCenterHeading: 'ریفرل اور انعامات سینٹر',
    appLanguageSetting: 'ایپ کی زبان (English / اردو)',
  },
};

export function getTranslation(
  lang: AppLanguageCode | undefined,
  key: keyof I18nDictionary
): string {
  const safeLang: AppLanguageCode = lang === 'ur' ? 'ur' : 'en';
  return TRANSLATIONS[safeLang][key] || TRANSLATIONS.en[key];
}

export function isRtlLanguage(lang: AppLanguageCode | undefined): boolean {
  return lang === 'ur';
}

export function getLanguageDirection(lang: AppLanguageCode | undefined): 'ltr' | 'rtl' {
  return lang === 'ur' ? 'rtl' : 'ltr';
}

export function applyDocumentLanguageDirection(lang: AppLanguageCode | undefined): {
  lang: AppLanguageCode;
  dir: 'ltr' | 'rtl';
} {
  const safeLang: AppLanguageCode = lang === 'ur' ? 'ur' : 'en';
  const dir: 'ltr' | 'rtl' = safeLang === 'ur' ? 'rtl' : 'ltr';
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('lang', safeLang);
    document.documentElement.setAttribute('dir', dir);
  }
  return { lang: safeLang, dir };
}
