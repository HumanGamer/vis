export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Space kept between the canvas edge and windows. */
const EDGE_MARGIN = 20;
/** Space kept between neighbouring windows. */
const WINDOW_GAP = 12;

function overlapArea(a: Rect, b: Rect) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function axisRange(areaSize: number, size: number) {
  const max = Math.max(0, areaSize - size - EDGE_MARGIN);
  return { min: Math.min(EDGE_MARGIN, max), max };
}

/** Extra random candidates, so free windows scatter instead of lining up. */
const RANDOM_CANDIDATES = 48;

/**
 * Choose where a new window goes: a random spot that overlaps no existing
 * window (keeping a small gap) when one exists, otherwise the spot with the
 * least overlap.
 *
 * Candidates are the canvas edges, positions flush against each existing window
 * (which guarantees a free spot is found whenever one exists) and random
 * positions (which keep the layout from settling into a grid).
 */
export function findOpenSpot(
  area: Size,
  size: Size,
  occupied: Rect[],
  random: () => number = Math.random,
): { x: number; y: number } {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const xRange = axisRange(area.width, width);
  const yRange = axisRange(area.height, height);
  const clampX = (x: number) => Math.round(Math.max(xRange.min, Math.min(x, xRange.max)));
  const clampY = (y: number) => Math.round(Math.max(yRange.min, Math.min(y, yRange.max)));

  const xs = new Set([xRange.min, xRange.max]);
  const ys = new Set([yRange.min, yRange.max]);
  for (const rect of occupied) {
    xs.add(clampX(rect.x + rect.width + WINDOW_GAP));
    xs.add(clampX(rect.x - width - WINDOW_GAP));
    xs.add(clampX(rect.x));
    ys.add(clampY(rect.y + rect.height + WINDOW_GAP));
    ys.add(clampY(rect.y - height - WINDOW_GAP));
    ys.add(clampY(rect.y));
  }
  const aligned: { x: number; y: number }[] = [];
  for (const y of ys) for (const x of xs) aligned.push({ x, y });
  const scattered: { x: number; y: number }[] = [];
  for (let i = 0; i < RANDOM_CANDIDATES; i++)
    scattered.push({
      x: clampX(xRange.min + random() * (xRange.max - xRange.min)),
      y: clampY(yRange.min + random() * (yRange.max - yRange.min)),
    });

  // Score against windows grown by the gap so neighbours do not touch.
  const padded = occupied.map((rect) => ({
    x: rect.x - WINDOW_GAP,
    y: rect.y - WINDOW_GAP,
    width: rect.width + WINDOW_GAP * 2,
    height: rect.height + WINDOW_GAP * 2,
  }));

  const score = (candidate: { x: number; y: number }) => {
    const rect = { ...candidate, width, height };
    let total = 0;
    for (const other of padded) total += overlapArea(rect, other);
    return total;
  };
  const pick = (spots: { x: number; y: number }[]) => spots[Math.floor(random() * spots.length)];

  // Prefer a free random spot; aligned spots only fill gaps random ones miss.
  // Among free random spots, lean towards snug ones (near windows or edges) so
  // large open areas stay available for later windows.
  const slack = (spot: { x: number; y: number }) => {
    let nearest = Math.min(
      spot.x - xRange.min,
      xRange.max - spot.x,
      spot.y - yRange.min,
      yRange.max - spot.y,
    );
    for (const other of padded) {
      const dx = Math.max(other.x - (spot.x + width), spot.x - (other.x + other.width), 0);
      const dy = Math.max(other.y - (spot.y + height), spot.y - (other.y + other.height), 0);
      nearest = Math.min(nearest, Math.max(dx, dy));
    }
    return nearest;
  };
  const freeScattered = scattered
    .filter((spot) => score(spot) === 0)
    .sort((a, b) => slack(a) - slack(b));
  if (freeScattered.length)
    return pick(freeScattered.slice(0, Math.max(1, Math.ceil(freeScattered.length / 3))));
  let best = aligned[0];
  let bestScore = Infinity;
  const freeAligned: { x: number; y: number }[] = [];
  for (const spot of [...aligned, ...scattered]) {
    const value = score(spot);
    if (value === 0) freeAligned.push(spot);
    else if (value < bestScore) {
      best = spot;
      bestScore = value;
    }
  }
  return freeAligned.length ? pick(freeAligned) : best;
}
