/**
 * Module D — aiming vector + ray–plane intersection.
 *
 * THE core interaction primitive: the cursor is where the pointer hand's
 * aiming ray pierces the screen plane. Angle has leverage; position barely
 * matters — which drives every design choice below.
 *
 * AIMING BONE CHOICE (settings.ray.aimingBone):
 * Never derive the ray from joints that move during natural hand tension.
 *  - 'metacarpal'  wrist(0) → index MCP(5), extended. Most stable: entirely
 *                  unaffected by finger curl. Feels like "pointing with the
 *                  hand". ← default
 *  - 'proximal'    index MCP(5) → PIP(6). Truer "finger pointing" feel,
 *                  mildly affected by finger flexion.
 *  - 'fingertip'   MCP(5) → tip(8). Most intuitive, most polluted by finger
 *                  micro-movement. Experimental only.
 */

import type { Ray3, ScreenPlane, Vec2, Vec3 } from "../../types/geometry";
import { add, dot, normalize, scale, sub } from "../../types/geometry";
import type { TrackedHand } from "../../types/landmarks";
import { LM } from "../../types/landmarks";
import { settings } from "../../config/settings";
import type { Intrinsics } from "../calibration/intrinsics";
import type { HandSizeCalibration } from "../calibration/calibrationStore";
import { landmarkToCameraSpace } from "../tracking/depthAnchor";
import { planePointToScreenNorm } from "../calibration/pose";

export interface RaySolveResult {
  /** Normalized screen coordinates. May lie outside [0,1] — the pipeline
   *  clamps and flags off-screen; raw values are kept for the edge arrow. */
  screenNorm: Vec2;
  /** False when the incidence angle is below the graze threshold and the
   *  intersection is numerically untrustworthy. */
  reliable: boolean;
  /** Hand distance to the screen plane along the normal (cm) — used for the
   *  "too close to screen" fallback and dead-zone distance scaling. */
  handToPlaneCm: number;
  /** Hand distance from camera (cm) — used for dead-zone scaling. */
  handToCameraCm: number;
}

/** Landmark pair for each aiming-bone mode: [origin joint, direction joint]. */
const AIM_BONES: Record<string, [number, number]> = {
  metacarpal: [LM.WRIST, LM.INDEX_MCP],
  proximal: [LM.INDEX_MCP, LM.INDEX_PIP],
  fingertip: [LM.INDEX_MCP, LM.INDEX_TIP],
};

/** Build the aiming ray from the pointer hand in absolute camera space. */
export function buildAimingRay(
  hand: TrackedHand,
  k: Intrinsics,
  handSize: HandSizeCalibration | null,
): Ray3 {
  const [aIdx, bIdx] = AIM_BONES[settings.ray.aimingBone];
  const a = landmarkToCameraSpace(hand, aIdx, k, handSize);
  const b = landmarkToCameraSpace(hand, bIdx, k, handSize);
  return {
    // Bone midpoint as origin: averages out per-joint depth noise a little.
    origin: scale(add(a, b), 0.5),
    direction: normalize(sub(b, a)),
  };
}

/**
 * Intersect the aiming ray with the screen plane.
 * Returns null only when the ray points AWAY from the plane entirely
 * (t < 0) — grazing-but-forward rays return `reliable: false` instead so
 * the pipeline can hold the last position rather than losing the cursor.
 */
export function intersectScreen(ray: Ray3, plane: ScreenPlane): RaySolveResult | null {
  const denom = dot(ray.direction, plane.normal);

  // Incidence angle = angle between ray and plane surface = 90° − angle to
  // normal. |denom| = |cos(angle to normal)| = sin(incidence angle).
  const minIncidence = Math.sin((settings.ray.minIncidenceAngleDeg * Math.PI) / 180);
  const grazing = Math.abs(denom) < minIncidence;

  // Signed distance from ray origin to the plane along the normal.
  const originToPlane = dot(sub(plane.origin, ray.origin), plane.normal);

  if (Math.abs(denom) < 1e-9) return null; // exactly parallel
  const t = originToPlane / denom;
  if (t < 0) return null; // pointing away from the screen

  const hit: Vec3 = add(ray.origin, scale(ray.direction, t));
  const screenNorm = planePointToScreenNorm(plane, hit);

  return {
    screenNorm,
    reliable: !grazing,
    handToPlaneCm: Math.abs(originToPlane),
    handToCameraCm: Math.hypot(ray.origin.x, ray.origin.y, ray.origin.z),
  };
}
