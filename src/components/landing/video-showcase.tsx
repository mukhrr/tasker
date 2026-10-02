'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Pause,
  Play,
  VolumeX,
} from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { useReveal } from './hooks';

const VIDEOS = {
  desktop: {
    src: '/videos/tasker-desktop.mp4',
    poster: '/videos/tasker-desktop-poster.jpg',
  },
  mobile: {
    src: '/videos/tasker-mobile.mp4',
    poster: '/videos/tasker-mobile-poster.jpg',
  },
};

// Start times match both cuts; they were read off the edit, so update them if the videos change.
const CHAPTERS = [
  { title: 'Bounties everywhere', start: 0 },
  { title: 'Reads the thread', start: 3 },
  { title: 'Whole lifecycle', start: 8 },
  { title: 'Every repo, one table', start: 14 },
  { title: 'Paid vs pending', start: 18 },
  { title: 'Right on GitHub', start: 20 },
  { title: 'Your own model', start: 24 },
];
const FALLBACK_DURATION = 30.5;

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

function chapterEnd(i: number, duration: number) {
  return CHAPTERS[i + 1]?.start ?? duration;
}

function chapterProgress(i: number, time: number, duration: number) {
  const { start } = CHAPTERS[i];
  const p = (time - start) / (chapterEnd(i, duration) - start);
  return Math.min(1, Math.max(0, p));
}

function activeChapter(time: number) {
  let i = 0;
  while (i + 1 < CHAPTERS.length && CHAPTERS[i + 1].start <= time) i++;
  return i;
}

export function VideoShowcase() {
  const [ref, visible] = useReveal();
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(FALLBACK_DURATION);

  const video = isDesktop ? VIDEOS.desktop : VIDEOS.mobile;

  // Autoplay through play() rather than the attribute, so a blocked autoplay shows the play overlay instead of a frozen poster.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reducedMotion) return;
    v.play().catch(() => setBlocked(true));
  }, [video.src, reducedMotion, mounted]);

  // timeupdate fires about 4 times a second, too coarse for the progress bars.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      if (videoRef.current) setTime(videoRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const play = () => videoRef.current?.play().catch(() => setBlocked(true));

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) play();
    else v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.paused) play();
  };

  const seek = (i: number) => {
    const v = videoRef.current;
    if (!v) return;
    const target = CHAPTERS[(i + CHAPTERS.length) % CHAPTERS.length];
    v.currentTime = target.start;
    setTime(target.start);
    play();
  };

  const fullscreen = () => {
    const v = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.();
  };

  const current = activeChapter(time);
  const idle = !started && (reducedMotion || blocked);

  return (
    <div ref={ref} className="mx-auto mt-16 max-w-5xl sm:mt-20">
      <div
        className={cn(
          'mx-auto max-w-[360px] transition-all duration-700 sm:max-w-none',
          visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
        )}
        style={{ transitionDelay: visible ? '200ms' : '0ms' }}
      >
        <div className="relative aspect-[9/16] overflow-hidden rounded-[22px] bg-[#fbfbf9] shadow-[0_30px_100px_-30px_rgba(124,58,237,0.4)] ring-1 ring-border sm:aspect-video sm:rounded-2xl dark:ring-white/[0.07]">
          {mounted && (
            <video
              key={video.src}
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              src={video.src}
              poster={video.poster}
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="Tasker product tour"
              onClick={isDesktop ? togglePlay : undefined}
              onPlay={() => {
                setPlaying(true);
                setStarted(true);
              }}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            />
          )}

          {mounted && idle && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-neutral-950/40">
              <button
                type="button"
                onClick={play}
                aria-label="Play the 30 second tour"
                className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white text-violet-600 shadow-[0_20px_50px_rgba(0,0,0,0.35)] transition-transform hover:scale-105 sm:h-24 sm:w-24"
              >
                <span className="absolute inset-0 rounded-full border-2 border-white motion-safe:animate-[ring_1.8s_ease-out_infinite]" />
                <Play className="ml-1 h-8 w-8 fill-current" />
              </button>
              <div className="flex flex-col items-center gap-1 rounded-xl bg-neutral-900/80 px-5 py-3 text-center backdrop-blur-md">
                <span className="text-base font-bold text-white">
                  Watch the 30 second tour
                </span>
                <span className="font-mono text-xs text-neutral-300">
                  {CHAPTERS.length} chapters · sound optional
                </span>
              </div>
            </div>
          )}

          {mounted && !idle && isDesktop && (
            <DesktopOverlay
              current={current}
              time={time}
              duration={duration}
              playing={playing}
              muted={muted}
              onTogglePlay={togglePlay}
              onToggleMute={toggleMute}
              onFullscreen={fullscreen}
            />
          )}

          {mounted && !idle && !isDesktop && (
            <MobileOverlay
              current={current}
              time={time}
              duration={duration}
              playing={playing}
              muted={muted}
              onTogglePlay={togglePlay}
              onToggleMute={toggleMute}
              onSeek={seek}
            />
          )}
        </div>

        <div className="mt-4 hidden gap-1.5 sm:flex">
          {CHAPTERS.map((c, i) => (
            <button
              key={c.title}
              type="button"
              onClick={() => seek(i)}
              aria-label={`Jump to ${c.title}, ${clock(c.start)}`}
              aria-current={i === current ? 'step' : undefined}
              className="group flex min-w-[8.5rem] flex-col gap-2.5 text-left"
              style={{ flex: `${chapterEnd(i, duration) - c.start} 1 0` }}
            >
              <span className="block h-1 w-full overflow-hidden rounded-full bg-border transition-colors group-hover:bg-muted-foreground/40">
                <span
                  className="block h-full origin-left rounded-full bg-violet-500 dark:bg-violet-400"
                  style={{
                    transform: `scaleX(${chapterProgress(i, time, duration)})`,
                  }}
                />
              </span>
              <span className="flex flex-col gap-0.5 pr-2">
                <span
                  className={cn(
                    'font-mono text-[11px]',
                    i === current
                      ? 'text-violet-600 dark:text-violet-400'
                      : 'text-muted-foreground'
                  )}
                >
                  {pad(i + 1)} · {clock(c.start)}
                </span>
                <span
                  className={cn(
                    'truncate text-[13px] font-semibold transition-colors',
                    i === current
                      ? 'text-foreground'
                      : 'text-muted-foreground group-hover:text-foreground'
                  )}
                >
                  {c.title}
                </span>
              </span>
            </button>
          ))}
        </div>

        <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground sm:hidden">
          <ChevronLeft className="h-3.5 w-3.5" />
          Tap the sides to skip chapters
          <ChevronRight className="h-3.5 w-3.5" />
        </p>
      </div>
    </div>
  );
}

type OverlayProps = {
  current: number;
  time: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
};

function ChapterChip({ current }: { current: number }) {
  return (
    <span className="flex items-center gap-2 text-[13px] font-semibold text-white">
      <span className="rounded-full bg-violet-600 px-1.5 py-0.5 font-mono text-[11px] font-medium">
        {pad(current + 1)} / {pad(CHAPTERS.length)}
      </span>
      <span className="truncate">{CHAPTERS[current].title}</span>
    </span>
  );
}

function SoundBars({ muted }: { muted: boolean }) {
  return (
    <span className="flex h-3.5 items-end gap-0.5" aria-hidden>
      {[0.9, 0.7, 1.1, 0.8].map((speed, i) => (
        <span
          key={i}
          className={cn(
            'h-full w-[3px] origin-bottom rounded-full',
            muted
              ? 'scale-y-[0.3] bg-neutral-400'
              : 'bg-violet-400 motion-safe:animate-[eq_var(--eq)_ease-in-out_infinite]'
          )}
          style={
            {
              '--eq': `${speed}s`,
              animationDelay: `${i * 0.1}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

function DesktopOverlay({
  current,
  time,
  duration,
  playing,
  muted,
  onTogglePlay,
  onToggleMute,
  onFullscreen,
}: OverlayProps & { onFullscreen: () => void }) {
  return (
    <>
      <div className="pointer-events-none absolute left-5 top-5 rounded-full bg-neutral-900/80 py-2 pl-2.5 pr-3.5 backdrop-blur-md">
        <ChapterChip current={current} />
      </div>

      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-neutral-900/85 p-1.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-md">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-900 transition-transform hover:scale-105"
        >
          {playing ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </button>
        <span className="px-3 font-mono text-[13px] tabular-nums">
          {clock(time)}{' '}
          <span className="text-neutral-400">/ {clock(duration)}</span>
        </span>
        <span className="h-5 w-px bg-white/15" />
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Turn sound on' : 'Mute'}
          className="flex h-11 items-center gap-2.5 rounded-full pl-3.5 pr-4 text-[13px] font-semibold transition-colors hover:bg-white/10"
        >
          <SoundBars muted={muted} />
          {muted ? 'Sound off' : 'Sound on'}
        </button>
        <button
          type="button"
          onClick={onFullscreen}
          aria-label="Fullscreen"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10"
        >
          <Maximize className="h-[18px] w-[18px]" />
        </button>
      </div>
    </>
  );
}

function MobileOverlay({
  current,
  time,
  duration,
  playing,
  muted,
  onTogglePlay,
  onToggleMute,
  onSeek,
}: OverlayProps & { onSeek: (i: number) => void }) {
  return (
    <>
      <button
        type="button"
        onClick={() => onSeek(current - 1)}
        aria-label="Previous chapter"
        className="absolute bottom-24 left-0 top-24 w-[30%]"
      />
      <button
        type="button"
        onClick={() => onSeek(current + 1)}
        aria-label="Next chapter"
        className="absolute bottom-24 right-0 top-24 w-[30%]"
      />

      <div className="absolute inset-x-0 top-0 flex flex-col gap-2.5 bg-neutral-950/55 px-3 pb-3 pt-3">
        <div className="flex gap-1">
          {CHAPTERS.map((c, i) => (
            <span
              key={c.title}
              className="h-[3px] overflow-hidden rounded-full bg-white/30"
              style={{ flex: `${chapterEnd(i, duration) - c.start} 1 0` }}
            >
              <span
                className="block h-full origin-left bg-white"
                style={{
                  transform: `scaleX(${chapterProgress(i, time, duration)})`,
                }}
              />
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <ChapterChip current={current} />
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            className="-my-2.5 -mr-2 flex h-11 w-11 items-center justify-center text-white"
          >
            {playing ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleMute}
        aria-label={muted ? 'Turn sound on' : 'Mute'}
        className="absolute bottom-3 right-3 flex h-11 items-center gap-2 rounded-full bg-neutral-900/85 px-3.5 text-[13px] font-semibold text-white backdrop-blur-md"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <SoundBars muted={false} />}
        {muted ? 'Tap for sound' : 'Sound on'}
      </button>
    </>
  );
}
