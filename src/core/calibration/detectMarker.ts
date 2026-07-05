/**
 * Calibration marker detection via difference imaging.
 *
 * Strategy: instead of detecting all four corner fiducials simultaneously
 * (fragile under glare, reflections, and scene clutter), the calibration
 * controller shows markers ONE AT A TIME and we detect each as the brightest
 * *change* against a baseline frame captured with the screen fully black:
 *
 *   diff(p) = luminance(markerFrame, p) − luminance(baselineFrame, p)
 *
 * Anything static in the scene — lamps, windows, glare — cancels out; the
 * only large positive-difference blob is the marker itself. This also means
 * marker color/contrast adaptation is unnecessary: white-on-black difference
 * is maximal by construction.
 *
 * The centroid is intensity-weighted over pixels above an adaptive threshold,
 * giving sub-pixel corner estimates.
 */

import type { Vec2 } from "../../types/geometry";

export interface MarkerDetection {
  /** Intensity-weighted centroid in camera-image pixels. */
  center: Vec2;
  /** Number of pixels above threshold — a plausibility signal. */
  areaPx: number;
  /** Peak difference value (0–255); low peaks mean the marker is barely
   *  visible (camera not pointed at the screen, or screen too dim). */
  peak: number;
}

/** Rec. 601 luma; cheap and adequate for blob detection. */
function luminanceAt(d: Uint8ClampedArray, idx: number): number {
  return 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
}

/**
 * Detect the single bright-difference blob between `markerFrame` and
 * `baseline`. Returns null when no plausible marker is found (peak too low
 * or blob too small), which the controller surfaces as "corner not detected".
 *
 * Both frames must be the same dimensions (same camera, no restart between).
 */
export function detectMarkerDiff(
  baseline: ImageData,
  markerFrame: ImageData,
  opts: { minPeak?: number; minAreaPx?: number } = {},
): MarkerDetection | null {
  const minPeak = opts.minPeak ?? 40; // marker must beat baseline by ~16% of range
  const minAreaPx = opts.minAreaPx ?? 12;

  if (baseline.width !== markerFrame.width || baseline.height !== markerFrame.height) {
    throw new Error("detectMarkerDiff: frame dimensions differ between baseline and marker frame");
  }

  const w = markerFrame.width;
  const h = markerFrame.height;
  const bd = baseline.data;
  const md = markerFrame.data;

  // Pass 1: find the peak positive difference.
  let peak = 0;
  const diff = new Float32Array(w * h);
  for (let i = 0, px = 0; px < w * h; px++, i += 4) {
    const d = luminanceAt(md, i) - luminanceAt(bd, i);
    diff[px] = d;
    if (d > peak) peak = d;
  }
  if (peak < minPeak) return null;

  // Pass 2: intensity-weighted centroid over pixels above half-peak.
  // Half-peak (rather than a fixed value) adapts to exposure automatically.
  const threshold = peak * 0.5;
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  let area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = diff[y * w + x];
      if (d < threshold) continue;
      sumX += x * d;
      sumY += y * d;
      sumW += d;
      area++;
    }
  }
  if (area < minAreaPx || sumW === 0) return null;

  return { center: { x: sumX / sumW, y: sumY / sumW }, areaPx: area, peak };
}
