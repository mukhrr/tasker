import type { HelpWantedIssue } from '../shared/types';

// In-page "lightning" popup shown on the issues list page the moment a brand-new
// issue matching a watched label group appears. Rendered in a shadow root so
// GitHub's CSS can't touch it, and pinned at the highest z-index so nothing
// covers it.

const HOST_ID = 'tasker-issue-alert';
const AUTO_DISMISS_MS = 15000;
const MAX_CARDS = 5;

let audioCtx: AudioContext | null = null;

/** Best-effort attention chime (two quick notes). Silently no-ops if blocked. */
function playChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const now = audioCtx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      const start = now + i * 0.12;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(start);
      o.stop(start + 0.2);
    }
  } catch {
    /* autoplay blocked or unsupported — visual is enough */
  }
}

const STYLES = `
  .stack {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 380px;
    max-width: calc(100vw - 24px);
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .card {
    pointer-events: auto;
    position: relative;
    overflow: hidden;
    background: #0d1117;
    color: #e6edf3;
    border: 1px solid rgba(245, 166, 35, 0.5);
    border-radius: 12px;
    padding: 14px 14px 16px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
    cursor: pointer;
    animation: tk-slidein 0.32s cubic-bezier(0.16, 1, 0.3, 1), tk-glow 1.4s ease-in-out infinite;
  }
  .card:hover { border-color: rgba(245, 166, 35, 0.9); }
  .card.out { animation: tk-slideout 0.26s ease forwards; }
  .flash {
    position: absolute; inset: 0;
    background: radial-gradient(circle at 50% 100%, rgba(255, 211, 61, 0.5), transparent 70%);
    animation: tk-flash 0.6s ease-out 1 forwards;
    pointer-events: none;
  }
  .hd { display: flex; align-items: center; gap: 8px; }
  .bolt { font-size: 18px; animation: tk-bolt 1s steps(1) infinite; }
  .badge {
    font-size: 11px; font-weight: 800; letter-spacing: 0.08em;
    color: #1c1500; background: linear-gradient(90deg, #ffd33d, #f5a623);
    padding: 2px 8px; border-radius: 999px;
  }
  .x {
    margin-left: auto; background: transparent; border: 0; color: #8b949e;
    font-size: 20px; line-height: 1; cursor: pointer; padding: 0 2px;
  }
  .x:hover { color: #e6edf3; }
  .title {
    display: block; margin: 10px 0 8px; color: #e6edf3; text-decoration: none;
    font-size: 14px; font-weight: 600; line-height: 1.35;
  }
  .card:hover .title { color: #ffd33d; text-decoration: underline; }
  .chips { display: flex; gap: 6px; }
  .chip {
    font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px;
    border: 1px solid transparent;
  }
  .chip.bug { color: #ffb4a8; background: rgba(248, 81, 73, 0.16); border-color: rgba(248, 81, 73, 0.4); }
  .chip.daily { color: #ffd9a8; background: rgba(245, 166, 35, 0.16); border-color: rgba(245, 166, 35, 0.4); }
  .chip.help { color: #aef0c2; background: rgba(63, 185, 80, 0.16); border-color: rgba(63, 185, 80, 0.4); }
  .chip.external { color: #a8d4ff; background: rgba(47, 129, 247, 0.16); border-color: rgba(47, 129, 247, 0.4); }
  .chip.generic { color: #c9d1d9; background: rgba(139, 148, 158, 0.16); border-color: rgba(139, 148, 158, 0.4); }
  .hint { margin-top: 9px; font-size: 12px; color: #8b949e; }
  .bar {
    position: absolute; left: 0; bottom: 0; height: 3px; width: 100%;
    background: linear-gradient(90deg, #ffd33d, #f5a623);
    transform-origin: left; animation: tk-count linear forwards;
  }
  @keyframes tk-slidein { from { opacity: 0; transform: translateY(16px) scale(0.98); } to { opacity: 1; transform: none; } }
  @keyframes tk-slideout { to { opacity: 0; transform: translateY(10px); } }
  @keyframes tk-glow {
    0%, 100% { box-shadow: 0 8px 28px rgba(0,0,0,0.55), 0 0 0 0 rgba(245,166,35,0.0); }
    50% { box-shadow: 0 8px 28px rgba(0,0,0,0.55), 0 0 18px 2px rgba(245,166,35,0.45); }
  }
  @keyframes tk-flash { from { opacity: 1; } to { opacity: 0; } }
  @keyframes tk-bolt { 0%, 92%, 100% { opacity: 1; } 95% { opacity: 0.25; } }
  @keyframes tk-count { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) {
    .card, .flash, .bolt { animation: tk-slidein 0.2s ease both; }
    .bar { animation: tk-count linear forwards; }
  }
`;

function ensureHost(): { host: HTMLElement; stack: HTMLElement } {
  let host = document.getElementById(HOST_ID);
  if (host && host.shadowRoot) {
    const stack = host.shadowRoot.querySelector('.stack') as HTMLElement;
    return { host, stack };
  }
  host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    zIndex: '2147483647',
  });
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const stack = document.createElement('div');
  stack.className = 'stack';
  shadow.append(style, stack);
  return { host, stack };
}

// issue.labels holds the matched watched-group names (e.g. "Bug + Daily").
// Flatten them into individual, de-duplicated label chips for display.
function chipLabels(labels: string[]): string[] {
  const seen = new Map<string, string>();
  for (const group of labels) {
    for (const part of group.split('+')) {
      const label = part.trim();
      if (label) seen.set(label.toLowerCase(), label);
    }
  }
  return seen.size > 0 ? Array.from(seen.values()) : ['New'];
}

function chipClass(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('bug')) return 'chip bug';
  if (l.includes('daily')) return 'chip daily';
  if (l.includes('help')) return 'chip help';
  if (l.includes('external')) return 'chip external';
  return 'chip generic';
}

function buildCard(issue: HelpWantedIssue, onGone: () => void): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const flash = document.createElement('div');
  flash.className = 'flash';

  const hd = document.createElement('div');
  hd.className = 'hd';
  const bolt = document.createElement('span');
  bolt.className = 'bolt';
  bolt.textContent = '⚡';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'NEW BOUNTY';
  const close = document.createElement('button');
  close.className = 'x';
  close.textContent = '×';
  close.title = 'Dismiss';
  hd.append(bolt, badge, close);

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `#${issue.number} · ${issue.title}`;

  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const label of chipLabels(issue.labels)) {
    const chip = document.createElement('span');
    chip.className = chipClass(label);
    chip.textContent = label;
    chips.append(chip);
  }

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Open it and arm your proposal before someone grabs it.';

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.style.animationDuration = `${AUTO_DISMISS_MS}ms`;

  card.append(flash, hd, title, chips, hint, bar);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;
  const dismiss = (): void => {
    if (closing) return;
    closing = true;
    if (timer) clearTimeout(timer);
    card.classList.add('out');
    setTimeout(() => {
      card.remove();
      onGone();
    }, 280);
  };
  // Clicking anywhere on the card opens the issue (new tab, keeps the list) and
  // dismisses. The X closes only — stopPropagation keeps it from opening the issue.
  card.addEventListener('click', () => {
    window.open(issue.url, '_blank', 'noopener');
    dismiss();
  });
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });
  // Pause the auto-dismiss while hovered so it can be read.
  card.addEventListener('mouseenter', () => {
    if (timer) clearTimeout(timer);
    bar.style.animationPlayState = 'paused';
  });
  card.addEventListener('mouseleave', () => {
    if (closing) return;
    bar.style.animationPlayState = 'running';
    timer = setTimeout(dismiss, AUTO_DISMISS_MS);
  });
  timer = setTimeout(dismiss, AUTO_DISMISS_MS);

  return card;
}

/** Show a lightning popup for each brand-new Bug + Daily issue (capped). */
export function showNewBugDailyAlert(
  issues: HelpWantedIssue[],
  opts: { sound?: boolean } = {},
): void {
  if (issues.length === 0) return;
  const { host, stack } = ensureHost();
  const onGone = (): void => {
    if (stack.childElementCount === 0) host.remove();
  };
  for (const issue of issues.slice(0, MAX_CARDS)) {
    stack.appendChild(buildCard(issue, onGone));
  }
  if (opts.sound !== false) playChime();
}
