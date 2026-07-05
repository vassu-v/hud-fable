/**
 * Camera intrinsics — estimated, not measured.
 *
 * We don't run a full checkerboard camera calibration; instead we assume a
 * pinhole model with square pixels, principal point at the frame center, and
 * a focal length derived from an assumed horizontal FOV (settings). Typical
 * laptop webcams sit in the 55–70° range; the error this introduces mostly
 * shows up as a small scale error in the recovered screen distance, which the
 * ray-pointing math is quite tolerant of (ray *direction* dominates cursor
 * position, ray *origin* barely matters).
 */

import type { Mat3, Vec3 } from "../../types/geometry";
import { v3, normalize } from "../../types/geometry";
import { settings } from "../../config/settings";

export interface Intrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export function estimateIntrinsics(frameWidth: number, frameHeight: number): Intrinsics {
  const hfovRad = (settings.calibration.assumedHfovDeg * Math.PI) / 180;
  const fx = frameWidth / 2 / Math.tan(hfovRad / 2);
  return {
    fx,
    fy: fx, // square pixels assumption
    cx: frameWidth / 2,
    cy: frameHeight / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

export function intrinsicsMatrix(k: Intrinsics): Mat3 {
  return [k.fx, 0, k.cx, 0, k.fy, k.cy, 0, 0, 1];
}

/**
 * Back-project an image pixel to a unit direction ray in camera space
 * (camera at origin, +z into the scene).
 */
export function pixelToRayDirection(k: Intrinsics, px: number, py: number): Vec3 {
  return normalize(v3((px - k.cx) / k.fx, (py - k.cy) / k.fy, 1));
}
