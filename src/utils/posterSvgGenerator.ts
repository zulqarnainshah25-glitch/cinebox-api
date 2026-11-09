/**
 * High-contrast, resilient SVG Poster & Backdrop Artwork Generator.
 * Ensures zero broken images in offline mode or hermetic sandboxes while
 * providing cinema-grade poster typography and atmospheric lighting.
 */

function escapeXml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function createPosterDataUri(
  title: string,
  subtitle: string,
  primaryHex: string = '#10d97b',
  secondaryHex: string = '#0ea5e9',
  bgHex: string = '#090d16',
  year: string = '2026',
  accentTag: string = 'ORIGINAL'
): string {
  const cleanTitle = title.replace(/\[.*?\]/g, '').trim();
  const words = cleanTitle.split(/\s+/);
  const line1 = escapeXml(words.slice(0, 2).join(' ').toUpperCase());
  const line2 = escapeXml(words.slice(2, 5).join(' ').toUpperCase());
  const safeSub = escapeXml(subtitle.toUpperCase());
  const safeTag = escapeXml(accentTag.toUpperCase());
  const safeYear = escapeXml(year);

  const line1FontSize = line1.length > 13 ? 40 : line1.length > 10 ? 48 : 56;
  const line2FontSize = line2.length > 13 ? 38 : line2.length > 10 ? 44 : 50;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgHex}" />
        <stop offset="50%" stop-color="#111827" />
        <stop offset="100%" stop-color="#05070b" />
      </linearGradient>
      <radialGradient id="glow1" cx="70%" cy="28%" r="55%">
        <stop offset="0%" stop-color="${primaryHex}" stop-opacity="0.52" />
        <stop offset="60%" stop-color="${secondaryHex}" stop-opacity="0.18" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="glow2" cx="25%" cy="75%" r="50%">
        <stop offset="0%" stop-color="${secondaryHex}" stop-opacity="0.38" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="scrim" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#000000" stop-opacity="0.45" />
        <stop offset="40%" stop-color="#000000" stop-opacity="0.05" />
        <stop offset="75%" stop-color="#05070b" stop-opacity="0.78" />
        <stop offset="100%" stop-color="#05070b" stop-opacity="0.98" />
      </linearGradient>
    </defs>
    <rect width="600" height="900" fill="url(#bgGrad)" />
    <circle cx="420" cy="260" r="320" fill="url(#glow1)" />
    <circle cx="160" cy="650" r="280" fill="url(#glow2)" />
    <!-- Dramatic architectural / cinema silhouette shapes -->
    <path d="M80 650 L210 290 L330 650 Z" fill="${primaryHex}" fill-opacity="0.12" />
    <path d="M240 650 L390 220 L540 650 Z" fill="${secondaryHex}" fill-opacity="0.15" />
    <circle cx="310" cy="340" r="95" fill="none" stroke="${primaryHex}" stroke-width="2.5" stroke-opacity="0.35" />
    <circle cx="310" cy="340" r="135" fill="none" stroke="${secondaryHex}" stroke-width="1" stroke-opacity="0.2" stroke-dasharray="10 8" />
    <!-- Film grain lines -->
    <line x1="50" y1="120" x2="550" y2="120" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1" />
    <line x1="50" y1="780" x2="550" y2="780" stroke="${primaryHex}" stroke-opacity="0.3" stroke-width="1.5" />
    <rect width="600" height="900" fill="url(#scrim)" />
    <!-- Top studio header -->
    <text x="50" y="95" fill="${primaryHex}" font-family="Outfit, sans-serif" font-size="20" font-weight="700" letter-spacing="5">${safeTag}</text>
    <text x="550" y="95" fill="#94a3b8" font-family="Outfit, sans-serif" font-size="20" font-weight="600" text-anchor="end">${safeYear}</text>
    <!-- Main Poster Title -->
    <text x="50" y="${line2 ? '645' : '695'}" fill="#ffffff" font-family="Outfit, sans-serif" font-size="${line1FontSize}" font-weight="800" letter-spacing="1">${line1}</text>
    ${line2 ? `<text x="50" y="708" fill="${primaryHex}" font-family="Outfit, sans-serif" font-size="${line2FontSize}" font-weight="800" letter-spacing="1">${line2}</text>` : ''}
    <text x="50" y="758" fill="#cbd5e1" font-family="Plus Jakarta Sans, sans-serif" font-size="21" font-weight="600" letter-spacing="2.5">${safeSub}</text>
    <text x="50" y="830" fill="#64748b" font-family="Plus Jakarta Sans, sans-serif" font-size="18" font-weight="600" letter-spacing="4">DOLBY ATMOS · 4K UHD · HINDI DUBBED</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createBackdropDataUri(
  title: string,
  tagline: string,
  primaryHex: string = '#facc15',
  secondaryHex: string = '#10d97b',
  bgHex: string = '#071318'
): string {
  const cleanTitle = title.replace(/\[.*?\]/g, '').trim();
  const words = cleanTitle.split(/\s+/);
  const line1 = escapeXml(words.slice(0, 2).join(' ').toUpperCase());
  const line2 = escapeXml(words.slice(2, 5).join(' ').toUpperCase());
  const safeTagline = escapeXml(tagline);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgHex}" />
        <stop offset="55%" stop-color="#0f172a" />
        <stop offset="100%" stop-color="#05070b" />
      </linearGradient>
      <radialGradient id="spot" cx="72%" cy="38%" r="50%">
        <stop offset="0%" stop-color="${secondaryHex}" stop-opacity="0.45" />
        <stop offset="55%" stop-color="${primaryHex}" stop-opacity="0.16" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="fade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0b0d12" stop-opacity="0.55" />
        <stop offset="35%" stop-color="#0b0d12" stop-opacity="0.1" />
        <stop offset="80%" stop-color="#0b0d12" stop-opacity="0.82" />
        <stop offset="100%" stop-color="#0b0d12" stop-opacity="0.98" />
      </linearGradient>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)" />
    <circle cx="920" cy="270" r="420" fill="url(#spot)" />
    <!-- Neon city / cyber grid silhouettes -->
    <g stroke="${secondaryHex}" stroke-opacity="0.18" stroke-width="2">
      <rect x="760" y="130" width="110" height="390" fill="#0f172a" fill-opacity="0.6" />
      <rect x="890" y="90" width="140" height="430" fill="#1e293b" fill-opacity="0.6" />
      <rect x="1050" y="170" width="120" height="350" fill="#0f172a" fill-opacity="0.6" />
    </g>
    <circle cx="940" cy="280" r="130" fill="${primaryHex}" fill-opacity="0.14" />
    <rect width="1280" height="720" fill="url(#fade)" />
    <!-- Pixel / Bold Graphic Hero Title (matching DEAD-END JOB style in screenshot 4) -->
    <text x="72" y="290" fill="${primaryHex}" font-family="Outfit, sans-serif" font-size="108" font-weight="900" letter-spacing="2">${line1}</text>
    ${line2 ? `<text x="72" y="395" fill="${primaryHex}" font-family="Outfit, sans-serif" font-size="104" font-weight="900" letter-spacing="2">${line2}</text>` : ''}
    <text x="76" y="${line2 ? '450' : '360'}" fill="#e2e8f0" font-family="Plus Jakarta Sans, sans-serif" font-size="26" font-weight="600" letter-spacing="1.5">${safeTagline}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
