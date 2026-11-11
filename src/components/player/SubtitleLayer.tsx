import React, { useEffect, useMemo, useState } from 'react';
import { SubtitleTrackOption } from '../../types/movie';
import {
  convertSrtToVtt,
  findActiveSubtitleCue,
  isRtlSubtitleLanguage,
  ParsedSubtitleCue,
  parseSubtitleCues,
  SubtitleBgOpacityOption,
  SubtitleFontSizeOption,
} from '../../utils/subtitleParser';
import { buildCorsProxyHeaders, buildProxiedUrl } from '../../services/movieBoxDirectApi';

export interface SubtitleLayerProps {
  subtitlesEnabled: boolean;
  subtitleTracks: SubtitleTrackOption[];
  selectedSubtitleLang: string;
  currentTime: number;
  subtitleDelayMs: number;
  subtitleSize: SubtitleFontSizeOption;
  subtitleBgOpacity: SubtitleBgOpacityOption;
  customSubtitleText?: string | null;
}

const bgOpacityClassMap: Record<SubtitleBgOpacityOption, string> = {
  0: 'bg-transparent',
  50: 'bg-black/50',
  75: 'bg-black/75',
  100: 'bg-black',
};

const fontSizeClassMap: Record<SubtitleFontSizeOption, string> = {
  sm: 'text-xs sm:text-sm',
  normal: 'text-sm sm:text-base',
  large: 'text-base sm:text-xl',
  xl: 'text-lg sm:text-2xl',
};

export const SubtitleLayer: React.FC<SubtitleLayerProps> = ({
  subtitlesEnabled,
  subtitleTracks,
  selectedSubtitleLang,
  currentTime,
  subtitleDelayMs,
  subtitleSize,
  subtitleBgOpacity,
  customSubtitleText,
}) => {
  const [loadedCues, setLoadedCues] = useState<ParsedSubtitleCue[]>([]);
  const [blobVttUrl, setBlobVttUrl] = useState<string | null>(null);

  const activeTrack = useMemo(() => {
    if (!subtitleTracks || subtitleTracks.length === 0) return null;
    const target = selectedSubtitleLang.toLowerCase();
    return (
      subtitleTracks.find(
        (t) =>
          t.lang.toLowerCase() === target ||
          t.label.toLowerCase() === target ||
          t.label.toLowerCase().includes(target)
      ) || subtitleTracks[0]
    );
  }, [subtitleTracks, selectedSubtitleLang]);

  useEffect(() => {
    if (customSubtitleText && customSubtitleText.trim()) {
      const cues = parseSubtitleCues(customSubtitleText);
      setLoadedCues(cues);
      try {
        const vtt = convertSrtToVtt(customSubtitleText);
        const blob = new Blob([vtt], { type: 'text/vtt' });
        const objUrl = URL.createObjectURL(blob);
        setBlobVttUrl(objUrl);
        return () => URL.revokeObjectURL(objUrl);
      } catch {
        setBlobVttUrl(null);
      }
      return;
    }

    if (!activeTrack?.url) {
      setLoadedCues([]);
      setBlobVttUrl(null);
      return;
    }

    let cancelled = false;
    let createdBlobUrl: string | null = null;

    const loadSubtitleFile = async () => {
      try {
        let rawText = '';
        try {
          const directRes = await fetch(activeTrack.url);
          if (directRes.ok) {
            rawText = await directRes.text();
          }
        } catch {
          // Try CORS proxy fallback for external .srt/.vtt hosts
          const proxied = buildProxiedUrl(activeTrack.url);
          const headers = buildCorsProxyHeaders(proxied);
          const proxyRes = await fetch(proxied, { headers });
          if (proxyRes.ok) {
            rawText = await proxyRes.text();
          }
        }

        if (cancelled) return;
        const parsed = parseSubtitleCues(rawText);
        setLoadedCues(parsed);

        if (rawText.trim()) {
          try {
            const vtt = convertSrtToVtt(rawText);
            const blob = new Blob([vtt], { type: 'text/vtt' });
            createdBlobUrl = URL.createObjectURL(blob);
            setBlobVttUrl(createdBlobUrl);
          } catch {
            setBlobVttUrl(null);
          }
        }
      } catch {
        if (!cancelled) {
          setLoadedCues([]);
          setBlobVttUrl(null);
        }
      }
    };

    void loadSubtitleFile();

    return () => {
      cancelled = true;
      if (createdBlobUrl) {
        try {
          URL.revokeObjectURL(createdBlobUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [activeTrack?.url, customSubtitleText]);

  const activeCue = useMemo(
    () => findActiveSubtitleCue(loadedCues, currentTime, subtitleDelayMs),
    [loadedCues, currentTime, subtitleDelayMs]
  );

  if (!subtitlesEnabled || !activeCue) {
    return null;
  }

  const isRtl = isRtlSubtitleLanguage(
    activeTrack?.lang || selectedSubtitleLang,
    activeCue.text
  );

  return (
    <div
      data-testid="real-subtitle-overlay"
      data-vtt-blob-ready={blobVttUrl ? 'true' : 'false'}
      dir={isRtl ? 'rtl' : 'ltr'}
      className="pointer-events-none absolute bottom-16 sm:bottom-20 inset-x-0 z-30 flex flex-col items-center justify-center px-4 text-center"
    >
      <span
        data-testid="real-subtitle-cue-text"
        className={`px-3 py-1 rounded-lg text-white font-semibold tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)] whitespace-pre-line ${
          bgOpacityClassMap[subtitleBgOpacity] || 'bg-black/75'
        } ${fontSizeClassMap[subtitleSize] || 'text-sm sm:text-base'} ${
          isRtl ? 'font-urdu-subtitle text-right' : ''
        }`}
      >
        {activeCue.text}
      </span>
    </div>
  );
};
