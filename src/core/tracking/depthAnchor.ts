/**
 * Absolute hand depth from apparent size (Module C).
 *
 * MediaPipe z-values are RELATIVE to the wrist, not absolute distances, so
 * we recover the hand's distance from the camera by how big it looks:
 *
 *   distance ≈ calibratedDistance × (calibratedPixelSpan / currentPixelSpan)
 *
 * where the span is a stable bone length measured across the palm. The
 * anchor (span at a known distance) is captured once per user during
 * calibration ("touch the bezel with your open hand").
 *
 * FORESHORTENING: a rotated palm looks narrower, which would read as
 * "further away". Mitigation: measure SEVERAL candidate palm spans and take
 * the maximum — whichever bone pair is most face-on to the camera dominates,
 * and at least one palm-crossing pair stays reasonably face-on through
 * natural pointing poses.
 *
 * ACCURACY BUDGET: ±5–10 cm of depth error is fine. Depth only positions
 * the ray ORIGIN, and origin error has very little leverage on where the
 * ray hits the screen — direction is what matters (see raySolver.ts).
 * Deliberately not over-engineered.
 */

import type { TrackedHand } from "../../types/landmarks";
import { LM } from "../../types/landmarks";
import type { Vec3 } from "../../types/geometry";
import { scale, v3 } from "../../types/geometry";
import type { Intrinsics } from "../calibration/intrinsics";
import { pixelToRayDirection } from "../calibration/intrinsics";
import type { HandSizeCalibration } from "../calibration/calibrationStore";

/** Palm-crossing landmark pairs used as span candidates (indices into the
 *  21-landmark skeleton). All are rigid bone-to-bone distances that don't
 *  change with finger curl. */
const SPAN_PAIRS: [number, number][] = [
  [LM.INDEX_MCP, LM.PINKY_MCP], // across the palm — primary
  [LM.WRIST, LM.MIDDLE_MCP], // palm length
  [LM.WRIST, LM.INDEX_MCP], // palm diagonal
];

/** Fallback anchor used when the user skipped hand-size calibration:
 *  an average adult palm (index→pinky MCP ≈ 8 cm) at 55 cm gives a usable
 *  starting point; the pointing math tolerates the error. */
const DEFAULT_SPAN_CM = 8;

/**
 * Measure the hand's apparent palm span in camera pixels.
 * Exported separately because the calibration hand-size step uses it too.
 */
export function measureSpanPx(hand: TrackedHand, frameWidth: number, frameHeight: number): number {
  let maxSpan = 0;
  for (const [a, b] of SPAN_PAIRS) {
    const la = hand.landmarks[a];
    const lb = hand.landmarks[b];
    // Landmarks are normalized [0..1]; convert to pixels (x and y scale
    // differently for non-square frames).
    const dx = (la.x - lb.x) * frameWidth;
    const dy = (la.y - lb.y) * frameHeight;
    const span = Math.hypot(dx, dy);
    if (span > maxSpan) maxSpan = span;
  }
  return maxSpan;
}

/**
 * Place one landmark of a hand in absolute camera space (cm).
 *
 * Steps:
 *  1. distance from apparent span (above)
 *  2. back-project the landmark's image position to a ray, walk out to the
 *     estimated distance
 *  3. layer MediaPipe's relative-z on top, scaled from normalized units to
 *     cm using the same apparent-size factor (relative-z shares the x scale)
 */
export function landmarkToCameraSpace(
  hand: TrackedHand,
  landmarkIndex: number,
  k: Intrinsics,
  handSize: HandSizeCalibration | null,
): Vec3 {
  const spanPx = measureSpanPx(hand, k.width, k.height);
  if (spanPx < 1) return v3(0, 0, 60); // degenerate skeleton; harmless default

  let distanceCm: number;
  let cmPerNormX: number; // conversion for relative-z below

  if (handSize) {
    // Rescale the calibrated span if the camera resolution changed since.
    const scaleFix = k.width / handSize.frameWidth;
    distanceCm = handSize.calibratedDistanceCm * ((handSize.calibratedSpanPx * scaleFix) / spanPx);
  } else {
    // No per-user anchor: assume an average palm using the pinhole relation
    // spanPx / fx = spanCm / distance.
    distanceCm = (DEFAULT_SPAN_CM * k.fx) / spanPx;
  }

  // How many cm one normalized-x unit spans at this distance — used to give
  // MediaPipe's relative z (which shares the x scale) physical units.
  cmPerNormX = (distanceCm * k.width) / k.fx;

  const lm = hand.landmarks[landmarkIndex];
  const dir = pixelToRayDirection(k, lm.x * k.width, lm.y * k.height);
  // dir is unit with dir.z = cos(angle); walking `distanceCm / dir.z` along
  // it puts the point at z ≈ distanceCm — we treat "distance" as z-depth,
  // consistent with how the span/pinhole relation was derived.
  const base = scale(dir, distanceCm / Math.max(dir.z, 0.2));

  // Relative depth refinement from the skeleton itself.
  base.z += lm.z * cmPerNormX;
  return base;
}
