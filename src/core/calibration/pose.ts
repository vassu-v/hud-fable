/**
 * Recover the screen plane's 3D pose in camera space from calibration
 * correspondences — the planar-PnP decomposition.
 *
 * Setup: put a 2D coordinate system ON the screen surface, in centimeters,
 * origin at the screen's top-left corner, X along the top edge, Y down the
 * left edge. Calibration detects where 4 known points of that surface land
 * in the camera image, giving the homography  H : screen-cm → image-px.
 *
 * For a plane at Z=0 in its own frame, the pinhole projection collapses to
 *   s·[u v 1]ᵀ = K · [r1 r2 t] · [X Y 1]ᵀ
 * hence  K⁻¹·H ~ [r1 r2 t]  up to scale. Normalizing by the rotation-column
 * norms recovers rotation and translation; r3 = r1 × r2 completes R.
 *
 * The recovered pose IS the ScreenPlane the ray solver intersects against:
 *   origin = t      (screen top-left in camera space, cm)
 *   basisU = r1     (unit vector along screen width)
 *   basisV = r2     (unit vector along screen height)
 */

import type { ScreenPlane, Vec2, Vec3 } from "../../types/geometry";
import { add, cross, dot, length, normalize, scale, sub, v3 } from "../../types/geometry";
import { computeHomography, mat3Invert } from "./homography";
import type { Intrinsics } from "./intrinsics";
import { intrinsicsMatrix } from "./intrinsics";

/**
 * General form: recover the plane pose from any 4 non-collinear points ON the
 * screen surface (screen-cm coordinates) and their detected image positions.
 * The calibration uses inset marker positions, not the true panel corners,
 * so this is the primary entry point.
 */
export function recoverPlaneFromPoints(
  screenCm: Vec2[],
  imagePx: Vec2[],
  screenWidthCm: number,
  screenHeightCm: number,
  k: Intrinsics,
): ScreenPlane | null {
  const H = computeHomography(screenCm, imagePx);
  if (!H) return null;
  const Kinv = mat3Invert(intrinsicsMatrix(k));
  if (!Kinv) return null;

  // Columns of K⁻¹H are ~[r1 r2 t] up to a common scale λ.
  const col = (a: number, b: number, c: number): Vec3 =>
    v3(
      Kinv[0] * a + Kinv[1] * b + Kinv[2] * c,
      Kinv[3] * a + Kinv[4] * b + Kinv[5] * c,
      Kinv[6] * a + Kinv[7] * b + Kinv[8] * c,
    );
  const c1 = col(H[0], H[3], H[6]);
  const c2 = col(H[1], H[4], H[7]);
  const c3 = col(H[2], H[5], H[8]);

  // Average the two rotation-column norms for the scale — slightly more
  // robust than either alone when the estimated intrinsics are imperfect.
  const lambda = 2 / (length(c1) + length(c2));
  if (!isFinite(lambda) || lambda <= 0) return null;

  let r1 = scale(c1, lambda);
  let r2 = scale(c2, lambda);
  let t = scale(c3, lambda);

  // Homography sign ambiguity: the screen must be IN FRONT of the camera
  // (+z). Flip the whole solution if it landed behind.
  if (t.z < 0) {
    r1 = scale(r1, -1);
    r2 = scale(r2, -1);
    t = scale(t, -1);
  }

  // r1/r2 come out only approximately orthonormal (noise + intrinsics error):
  // keep r1, remove its component from r2, rebuild the normal.
  r1 = normalize(r1);
  r2 = normalize(sub(r2, scale(r1, dot(r1, r2))));
  const n = normalize(cross(r1, r2));

  return {
    origin: t,
    basisU: r1,
    basisV: r2,
    normal: n,
    widthCm: screenWidthCm,
    heightCm: screenHeightCm,
  };
}

/**
 * Convenience form for the common case where the 4 points are the panel's
 * own corners, in TL, TR, BR, BL order.
 */
export function recoverScreenPose(
  imageCorners: [Vec2, Vec2, Vec2, Vec2],
  screenWidthCm: number,
  screenHeightCm: number,
  k: Intrinsics,
): ScreenPlane | null {
  const W = screenWidthCm;
  const H = screenHeightCm;
  return recoverPlaneFromPoints(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    imageCorners,
    W,
    H,
    k,
  );
}

/** Convert a point on the plane (camera space) to normalized screen coords. */
export function planePointToScreenNorm(plane: ScreenPlane, p: Vec3): Vec2 {
  const rel = sub(p, plane.origin);
  return {
    x: dot(rel, plane.basisU) / plane.widthCm,
    y: dot(rel, plane.basisV) / plane.heightCm,
  };
}

/** Convert normalized screen coords back to a 3D point in camera space. */
export function screenNormToPlanePoint(plane: ScreenPlane, s: Vec2): Vec3 {
  return add(
    plane.origin,
    add(scale(plane.basisU, s.x * plane.widthCm), scale(plane.basisV, s.y * plane.heightCm)),
  );
}

/** Center of the screen in camera space — used by the hand-size depth anchor. */
export function screenCenter(plane: ScreenPlane): Vec3 {
  return screenNormToPlanePoint(plane, { x: 0.5, y: 0.5 });
}
