/**
 * Angular ("gyro pointer") aim mapping — the camera-only alternative to
 * ray-plane intersection.
 *
 * WHY: pointing at a webcam embedded in your own screen is the degenerate
 * "dead-on" geometry — the aiming ray runs nearly along the camera axis, so
 * intersecting it with the coplanar screen plane gives enormous, noise-
 * amplified leverage (a hit landing many screen-heights away; see the
 * camera-only bring-up). Instead of asking "where does the ray hit the
 * screen", we ask "which way is the hand aiming" and map that direction's
 * yaw/pitch straight to cursor x/y. This ignores hand position and depth
 * entirely, so noise is bounded by a fixed gain rather than a runaway `t`.
 *
 * Convention (camera space: +x right, +y down, +z away from camera toward the
 * user). Pointing straight back at the camera is d ≈ (0, 0, -1) → yaw =
 * pitch = 0. The recenter step captures the user's comfortable "center" aim
 * so absolute posture doesn't matter.
 */

import type { Vec3 } from "../../types/geometry";

export interface YawPitch {
  /** Horizontal aim angle (rad): +ve = aiming toward camera +x. */
  yaw: number;
  /** Vertical aim angle (rad): +ve = aiming toward camera +y (downward). */
  pitch: number;
  /** False when the hand is NOT aiming toward the camera/screen. atan2
   *  against a negative forward component mirrors the angles (the cursor
   *  would "backpropagate" while pointing away) — callers must hold the last
   *  position instead of consuming mirrored garbage. */
  towardScreen: boolean;
}

/** Decompose an aim direction into yaw/pitch relative to the camera axis. */
export function aimYawPitch(dir: Vec3): YawPitch {
  // -z is "toward the camera/screen"; measuring against it keeps angles small
  // and well-conditioned for normal pointing (dir.z strongly negative). A
  // small positive floor also rejects near-perpendicular aims, where yaw and
  // pitch become ill-conditioned.
  const forward = -dir.z;
  return {
    yaw: Math.atan2(dir.x, forward),
    pitch: Math.atan2(dir.y, forward),
    towardScreen: forward > 0.1,
  };
}
