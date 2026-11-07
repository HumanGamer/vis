import { onBeforeUnmount, onMounted, watch, type Ref, type WatchSource } from 'vue';

/** Constant speed of each move, in pixels per second (no easing). */
const SPEED_PX_PER_S = 350;
const MIN_TRAVEL_MS = 250;
const MAX_TRAVEL_MS = 5000;
const HOLD_TOP_MS = 1000;
const HOLD_BOTTOM_MS = 800;
/** Pause at the far right before going back. */
const HOLD_RIGHT_MS = 600;
/** Pause after returning left, before moving on. */
const HOLD_LEFT_MS = 300;
/** Pause after each page step down. */
const HOLD_PAGE_MS = 500;
/** How long content that fits (or reduced motion) counts as one full pass. */
const STILL_PASS_MS = 4000;
/** Share of the viewport moved per page step, leaving some overlap. */
const PAGE_FRACTION = 0.8;
/** Breathing room kept to the right of the longest visible line. */
const RIGHT_PADDING_PX = 16;
/** Breathing room kept left of the least-indented visible code at the left rest. */
const LEFT_PADDING_PX = 12;

type Axis = 'x' | 'y';
type Step =
  | { kind: 'hold'; ms: number }
  | { kind: 'pass' }
  | { kind: 'glide'; axis: Axis; target: (node: HTMLElement) => number };
type Active =
  | { kind: 'hold'; until: number }
  | { kind: 'glide'; axis: Axis; from: number; to: number; start: number; travel: number };

/**
 * Scroll a container whose content does not fit, at a constant speed.
 *
 * - Too tall only: go to the bottom, hold, come back to the top.
 * - Too wide: at each stop, go right far enough to reveal the longest line
 *   currently in view, then back left; if also too tall, then move down about
 *   a page and repeat, returning to the top after the bottom.
 *
 * `onPass` fires each time the whole content has been shown once (back at the
 * top, after one sideways pass when only too wide, or after a few seconds when
 * it fits or the user prefers reduced motion, in which case nothing moves).
 * Restarts from the top when `resetKey` changes. The container is expected to
 * have `overflow: hidden`: it is only ever scrolled automatically.
 */
export function useAutoScroll(
  el: Ref<HTMLElement | undefined>,
  resetKey: WatchSource,
  options: { lineSelector?: string; onPass?: () => void } = {},
) {
  const lineSelector = options.lineSelector ?? '.line';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const range = document.createRange();
  let frame: number | undefined;
  let queue: Step[] = [{ kind: 'hold', ms: HOLD_TOP_MS }];
  let active: Active | undefined;
  /**
   * Until this time, keep snapping to the left rest: new content renders
   * asynchronously (and the old one may still be fading out), so the rest is
   * re-measured every frame during the initial hold.
   */
  let snapHomeUntil = performance.now() + HOLD_TOP_MS;

  const maxX = (node: HTMLElement) => Math.max(0, node.scrollWidth - node.clientWidth);
  const maxY = (node: HTMLElement) => Math.max(0, node.scrollHeight - node.clientHeight);

  /** Content-space x of the first non-blank character in a line, if any. */
  function textStart(line: Element) {
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const index = text.textContent?.search(/\S/) ?? -1;
      if (index < 0) continue;
      range.setStart(text, index);
      range.setEnd(text, index + 1);
      return range.getBoundingClientRect().left;
    }
    return undefined;
  }

  /**
   * The left resting scroll position: just left of the least-indented code in
   * view (after the sticky line-number gutter), so deep indentation does not
   * leave a wide empty gap.
   */
  function homeX(node: HTMLElement) {
    const box = node.getBoundingClientRect();
    let gutter = 0;
    let left = Infinity;
    for (const line of node.querySelectorAll(lineSelector)) {
      const rect = line.getBoundingClientRect();
      if (rect.bottom <= box.top || rect.top >= box.bottom) continue;
      const start = textStart(line);
      if (start !== undefined) left = Math.min(left, start - box.left + node.scrollLeft);
      const numbers = line.parentElement?.querySelector('.code-gutters, .code-gutter.span-2');
      if (numbers) gutter = Math.max(gutter, numbers.getBoundingClientRect().width);
    }
    if (left === Infinity) return 0;
    return Math.min(maxX(node), Math.max(0, left - gutter - LEFT_PADDING_PX));
  }

  /** How far right to scroll so the longest line currently in view is fully shown. */
  function visibleLineEnd(node: HTMLElement) {
    const box = node.getBoundingClientRect();
    let right = 0;
    for (const line of node.querySelectorAll(lineSelector)) {
      const rect = line.getBoundingClientRect();
      if (rect.bottom <= box.top || rect.top >= box.bottom) continue;
      range.selectNodeContents(line);
      right = Math.max(right, range.getBoundingClientRect().right - box.left + node.scrollLeft);
    }
    return Math.min(maxX(node), Math.max(homeX(node), right - node.clientWidth + RIGHT_PADDING_PX));
  }

  /** The next round of moves, decided from where the container is now. */
  function plan(node: HTMLElement): Step[] {
    if (reducedMotion.matches) return [{ kind: 'hold', ms: STILL_PASS_MS }, { kind: 'pass' }];
    const wide = maxX(node) > 2;
    const tall = maxY(node) > 2;
    const steps: Step[] = [];
    if (wide)
      steps.push(
        // Settle on this stop's left rest first (indentation may have changed).
        { kind: 'glide', axis: 'x', target: homeX },
        { kind: 'glide', axis: 'x', target: visibleLineEnd },
        { kind: 'hold', ms: HOLD_RIGHT_MS },
        { kind: 'glide', axis: 'x', target: homeX },
        { kind: 'hold', ms: HOLD_LEFT_MS },
      );
    if (!tall) {
      steps.push({ kind: 'hold', ms: wide ? HOLD_TOP_MS : STILL_PASS_MS }, { kind: 'pass' });
      return steps;
    }
    if (node.scrollTop >= maxY(node) - 2)
      steps.push(
        { kind: 'glide', axis: 'y', target: () => 0 },
        { kind: 'pass' },
        { kind: 'hold', ms: HOLD_TOP_MS },
      );
    else if (wide)
      steps.push(
        {
          kind: 'glide',
          axis: 'y',
          target: (n) => Math.min(maxY(n), n.scrollTop + n.clientHeight * PAGE_FRACTION),
        },
        { kind: 'hold', ms: HOLD_PAGE_MS },
      );
    else
      steps.push({ kind: 'glide', axis: 'y', target: maxY }, { kind: 'hold', ms: HOLD_BOTTOM_MS });
    return steps;
  }

  function begin(step: Step, node: HTMLElement, now: number): Active | undefined {
    if (step.kind === 'pass') {
      options.onPass?.();
      return undefined;
    }
    if (step.kind === 'hold') return { kind: 'hold', until: now + step.ms };
    const from = step.axis === 'x' ? node.scrollLeft : node.scrollTop;
    const to = step.target(node);
    if (Math.abs(to - from) < 2) return undefined;
    const travel = Math.min(
      MAX_TRAVEL_MS,
      Math.max(MIN_TRAVEL_MS, (Math.abs(to - from) / SPEED_PX_PER_S) * 1000),
    );
    return { kind: 'glide', axis: step.axis, from, to, start: now, travel };
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    const node = el.value;
    if (!node) return;
    if (now < snapHomeUntil) node.scrollLeft = homeX(node);
    if (!active) {
      if (!queue.length) queue = plan(node);
      // Skip moves that turn out to be no-ops (e.g. nothing to reveal), along
      // with the pause that would have followed them.
      while (!active && queue.length) {
        const step = queue.shift()!;
        active = begin(step, node, now);
        if (!active && step.kind === 'glide' && queue[0]?.kind === 'hold') queue.shift();
      }
      if (!active) return;
    }
    if (active.kind === 'hold') {
      if (now >= active.until) active = undefined;
      return;
    }
    const t = Math.min(1, (now - active.start) / active.travel);
    const value = active.from + (active.to - active.from) * t;
    if (active.axis === 'x') node.scrollLeft = value;
    else node.scrollTop = value;
    if (t >= 1) active = undefined;
  }

  function pauseFor(ms: number) {
    active = undefined;
    queue = [{ kind: 'hold', ms }];
  }
  watch(resetKey, () => {
    pauseFor(HOLD_TOP_MS);
    snapHomeUntil = performance.now() + HOLD_TOP_MS;
    if (el.value) {
      el.value.scrollTop = 0;
      el.value.scrollLeft = 0;
    }
  });

  onMounted(() => {
    frame = requestAnimationFrame(tick);
  });
  onBeforeUnmount(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
}
