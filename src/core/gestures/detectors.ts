/**
 * Raw per-frame gesture pose classifiers (Module G).
 *
 * These answer "what shape is the hand in THIS frame?" — they are stateless
 * and deliberately strict. All temporal logic (hysteresis, debouncing,
 * hold timers) lives in gestureEngine.ts.
 *
 * EVERY threshold scales with the hand's apparent size (palm span in
 * normalized units): absolute distances are meaningless as the hand moves
 * closer to or further from the camera.
 */

import type { TrackedHand } from "../../types/landmarks";
import { LM } from "../../types/landmarks";
import { settings } from "../../config/settings";

/** Distance between two landmarks in normalized image units. */
function lmDist(hand: TrackedHand, a: number, b: number): number {
  const la = hand.landmarks[a];
  const lb = hand.landmarks[b];
  return Math.hypot(la.x - lb.x, la.y - lb.y);
}

/** The scale reference: palm span (index MCP ↔ pinky MCP). Rigid — does not
 *  change with finger curl, unlike anything involving fingertips. */
export function palmSpan(hand: TrackedHand): number {
  return lmDist(hand, LM.INDEX_MCP, LM.PINKY_MCP);
}

/** Palm center approximation: centroid of wrist + index/pinky MCPs. */
function palmCenter(hand: TrackedHand): { x: number; y: number } {
  const pts = [LM.WRIST, LM.INDEX_MCP, LM.PINKY_MCP].map((i) => hand.landmarks[i]);
  return {
    x: (pts[0].x + pts[1].x + pts[2].x) / 3,
    y: (pts[0].y + pts[1].y + pts[2].y) / 3,
  };
}

/**
 * Pinch: thumb tip ↔ index tip proximity, WITH hysteresis baked into the
 * interface — the caller passes whether the pinch is currently closed, and
 * the applicable threshold differs (open must be clearly wider than close)
 * so a borderline pinch doesn't machine-gun click events.
 */
export function isPinched(hand: TrackedHand, currentlyClosed: boolean): boolean {
  const span = palmSpan(hand);
  if (span < 1e-6) return currentlyClosed; // degenerate skeleton: hold state
  const d = lmDist(hand, LM.THUMB_TIP, LM.INDEX_TIP) / span;
  return currentlyClosed
    ? d < settings.gestures.pinchOpenRatio // stays closed until clearly open
    : d < settings.gestures.pinchCloseRatio; // closes only when clearly closed
}

/**
 * Fist: ALL four fingertips within a tight radius of the palm center.
 *
 * REST-POSE IMMUNITY: a relaxed hanging hand naturally half-curls, so the
 * closure ratio must demand DELIBERATE closure — tune with genuinely lazy
 * hands, not demo hands. The thumb is intentionally excluded: thumb position
 * varies wildly between people's fists.
 */
export function isFist(hand: TrackedHand): boolean {
  const span = palmSpan(hand);
  if (span < 1e-6) return false;
  const center = palmCenter(hand);
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  return tips.every((tip) => {
    const t = hand.landmarks[tip];
    return Math.hypot(t.x - center.x, t.y - center.y) / span < settings.gestures.fistClosureRatio;
  });
}

/**
 * Open palm: all four fingers extended (tip clearly further from the wrist
 * than the PIP joint — a curl-invariant extension test) plus the thumb tip
 * away from the palm center.
 */
export function isOpenPalm(hand: TrackedHand): boolean {
  const span = palmSpan(hand);
  if (span < 1e-6) return false;

  const fingerPairs: [number, number][] = [
    [LM.INDEX_TIP, LM.INDEX_PIP],
    [LM.MIDDLE_TIP, LM.MIDDLE_PIP],
    [LM.RING_TIP, LM.RING_PIP],
    [LM.PINKY_TIP, LM.PINKY_PIP],
  ];
  const fingersExtended = fingerPairs.every(
    ([tip, pip]) => lmDist(hand, LM.WRIST, tip) > lmDist(hand, LM.WRIST, pip) * 1.15,
  );
  if (!fingersExtended) return false;

  const center = palmCenter(hand);
  const thumb = hand.landmarks[LM.THUMB_TIP];
  const thumbOut = Math.hypot(thumb.x - center.x, thumb.y - center.y) / span > 0.7;
  return thumbOut;
}

/** Wrist motion between frames, normalized units — the open-palm hold
 *  requires LOW motion so a wave doesn't toggle modes. */
export function wristMotion(prev: TrackedHand, curr: TrackedHand): number {
  const a = prev.landmarks[LM.WRIST];
  const b = curr.landmarks[LM.WRIST];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
