import React, { useEffect, useRef, useState } from 'react';
import { FastForward, RotateCcw, RotateCw, Sun, Volume2 } from 'lucide-react';

export interface PlayerGesturesProps {
  enabled: boolean;
  isLocked: boolean;
  brightness: number;
  volume: number;
  playbackSpeed: number;
  onSeekOffset: (deltaSeconds: number) => void;
  onChangeBrightness: (nextBrightness: number) => void;
  onChangeVolume: (nextVolume: number) => void;
  onTemporarySpeedBoost: (active: boolean) => void;
  onCycleFitMode: () => void;
  onTogglePlay: () => void;
  onToggleFullscreen: () => void;
  onToggleMute: () => void;
  onToggleSubtitles: () => void;
  onWakeControls: (forceShow?: boolean) => void;
}

/**
 * Pure helper for unit testing desktop keyboard shortcut mapping.
 */
export function resolvePlayerKeyboardShortcut(
  key: string,
  targetTagName?: string
):
  | 'toggle-play'
  | 'seek-back-10'
  | 'seek-forward-10'
  | 'volume-up'
  | 'volume-down'
  | 'toggle-fullscreen'
  | 'toggle-mute'
  | 'toggle-subtitles'
  | null {
  const tag = (targetTagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return null;
  }

  switch (key) {
    case ' ':
    case 'Spacebar':
    case 'k':
    case 'K':
      return 'toggle-play';
    case 'ArrowLeft':
    case 'j':
    case 'J':
      return 'seek-back-10';
    case 'ArrowRight':
    case 'l':
    case 'L':
      return 'seek-forward-10';
    case 'ArrowUp':
      return 'volume-up';
    case 'ArrowDown':
      return 'volume-down';
    case 'f':
    case 'F':
      return 'toggle-fullscreen';
    case 'm':
    case 'M':
      return 'toggle-mute';
    case 'c':
    case 'C':
      return 'toggle-subtitles';
    default:
      return null;
  }
}

export const PlayerGestures: React.FC<PlayerGesturesProps> = ({
  enabled,
  isLocked,
  brightness,
  volume,
  onSeekOffset,
  onChangeBrightness,
  onChangeVolume,
  onTemporarySpeedBoost,
  onCycleFitMode,
  onTogglePlay,
  onToggleFullscreen,
  onToggleMute,
  onToggleSubtitles,
  onWakeControls,
}) => {
  const [gestureHud, setGestureHud] = useState<{
    type: 'seek-left' | 'seek-right' | 'brightness' | 'volume' | 'speed-2x';
    label: string;
  } | null>(null);

  const hudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'center' | 'right' }>({
    time: 0,
    side: 'center',
  });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressActiveRef = useRef<boolean>(false);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    side: 'left' | 'right';
    initialBrightness: number;
    initialVolume: number;
    pinchDistance: number | null;
  } | null>(null);

  const showTransientHud = (
    type: 'seek-left' | 'seek-right' | 'brightness' | 'volume' | 'speed-2x',
    label: string,
    durationMs = 900
  ) => {
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    setGestureHud({ type, label });
    if (durationMs > 0) {
      hudTimeoutRef.current = setTimeout(() => {
        setGestureHud(null);
      }, durationMs);
    }
  };

  // Desktop keyboard shortcuts (Space, Arrows, F, M, C)
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLocked) return;
      const target = e.target as HTMLElement | null;
      const action = resolvePlayerKeyboardShortcut(e.key, target?.tagName);
      if (!action) return;

      e.preventDefault();
      onWakeControls(true);

      switch (action) {
        case 'toggle-play':
          onTogglePlay();
          break;
        case 'seek-back-10':
          onSeekOffset(-10);
          showTransientHud('seek-left', '-10s');
          break;
        case 'seek-forward-10':
          onSeekOffset(10);
          showTransientHud('seek-right', '+10s');
          break;
        case 'volume-up': {
          const nextVol = Math.min(100, volume + 5);
          onChangeVolume(nextVol);
          showTransientHud('volume', `Volume ${nextVol}%`);
          break;
        }
        case 'volume-down': {
          const nextVol = Math.max(0, volume - 5);
          onChangeVolume(nextVol);
          showTransientHud('volume', `Volume ${nextVol}%`);
          break;
        }
        case 'toggle-fullscreen':
          onToggleFullscreen();
          break;
        case 'toggle-mute':
          onToggleMute();
          break;
        case 'toggle-subtitles':
          onToggleSubtitles();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    isLocked,
    volume,
    onTogglePlay,
    onSeekOffset,
    onChangeVolume,
    onToggleFullscreen,
    onToggleMute,
    onToggleSubtitles,
    onWakeControls,
  ]);

  useEffect(() => {
    return () => {
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  if (!enabled) return null;

  const getRelativeSide = (
    clientX: number,
    rect: DOMRect
  ): 'left' | 'center' | 'right' => {
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    if (ratio < 0.36) return 'left';
    if (ratio > 0.64) return 'right';
    return 'center';
  };

  const handlePointerStart = (
    clientX: number,
    clientY: number,
    rect: DOMRect,
    touches?: React.TouchList
  ) => {
    if (isLocked) {
      onWakeControls(true);
      return;
    }

    let pinchDistance: number | null = null;
    if (touches && touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      pinchDistance = Math.hypot(dx, dy);
    }

    const side = clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    touchStartRef.current = {
      x: clientX,
      y: clientY,
      side,
      initialBrightness: brightness,
      initialVolume: volume,
      pinchDistance,
    };

    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    isLongPressActiveRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      onTemporarySpeedBoost(true);
      showTransientHud('speed-2x', '2x Speed Active', 0);
    }, 450);
  };

  const handlePointerMove = (
    clientX: number,
    clientY: number,
    touches?: React.TouchList
  ) => {
    if (isLocked || !touchStartRef.current) return;

    // 2-finger pinch to cycle fitMode (contain / cover / fill)
    if (
      touches &&
      touches.length === 2 &&
      touchStartRef.current.pinchDistance !== null
    ) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - touchStartRef.current.pinchDistance) > 42) {
        touchStartRef.current.pinchDistance = dist;
        onCycleFitMode();
      }
      return;
    }

    const deltaY = touchStartRef.current.y - clientY;
    const deltaX = Math.abs(clientX - touchStartRef.current.x);

    if (Math.abs(deltaY) > 14 && Math.abs(deltaY) > deltaX) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      if (touchStartRef.current.side === 'left') {
        const nextB = Math.max(
          50,
          Math.min(130, Math.round(touchStartRef.current.initialBrightness + deltaY * 0.35))
        );
        onChangeBrightness(nextB);
        showTransientHud('brightness', `Brightness ${nextB}%`);
      } else {
        const nextV = Math.max(
          0,
          Math.min(100, Math.round(touchStartRef.current.initialVolume + deltaY * 0.45))
        );
        onChangeVolume(nextV);
        showTransientHud('volume', `Volume ${nextV}%`);
      }
    }
  };

  const handlePointerEnd = (clientX: number, rect: DOMRect) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isLongPressActiveRef.current) {
      isLongPressActiveRef.current = false;
      onTemporarySpeedBoost(false);
      setGestureHud(null);
      touchStartRef.current = null;
      return;
    }

    if (isLocked) {
      onWakeControls(true);
      touchStartRef.current = null;
      return;
    }

    const now = Date.now();
    const side = getRelativeSide(clientX, rect);
    const prev = lastTapRef.current;

    if (now - prev.time < 320 && prev.side === side && side !== 'center') {
      if (side === 'left') {
        onSeekOffset(-10);
        showTransientHud('seek-left', '-10s');
      } else if (side === 'right') {
        onSeekOffset(10);
        showTransientHud('seek-right', '+10s');
      }
      lastTapRef.current = { time: 0, side: 'center' };
    } else {
      lastTapRef.current = { time: now, side };
      onWakeControls(false);
    }

    touchStartRef.current = null;
  };

  return (
    <div
      data-testid="player-gestures-surface"
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (!t) return;
        const rect = e.currentTarget.getBoundingClientRect();
        handlePointerStart(t.clientX, t.clientY, rect, e.touches);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (!t) return;
        handlePointerMove(t.clientX, t.clientY, e.touches);
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0];
        const rect = e.currentTarget.getBoundingClientRect();
        handlePointerEnd(t ? t.clientX : rect.left + rect.width / 2, rect);
      }}
      onDoubleClick={(e) => {
        if (isLocked) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const side = getRelativeSide(e.clientX, rect);
        if (side === 'left') {
          onSeekOffset(-10);
          showTransientHud('seek-left', '-10s');
        } else if (side === 'right') {
          onSeekOffset(10);
          showTransientHud('seek-right', '+10s');
        } else {
          onCycleFitMode();
        }
      }}
      className="absolute inset-0 z-20 select-none"
    >
      {gestureHud && (
        <div
          data-testid="player-gesture-hud"
          className="pointer-events-none absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-1.5 rounded-full bg-black/85 border border-[#10d97b]/60 text-xs font-extrabold text-white shadow-2xl flex items-center gap-2"
        >
          {gestureHud.type === 'seek-left' && <RotateCcw className="w-4 h-4 text-[#10d97b]" />}
          {gestureHud.type === 'seek-right' && <RotateCw className="w-4 h-4 text-[#10d97b]" />}
          {gestureHud.type === 'brightness' && <Sun className="w-4 h-4 text-amber-400" />}
          {gestureHud.type === 'volume' && <Volume2 className="w-4 h-4 text-[#10d97b]" />}
          {gestureHud.type === 'speed-2x' && <FastForward className="w-4 h-4 text-[#10d97b]" />}
          <span>{gestureHud.label}</span>
        </div>
      )}
    </div>
  );
};
