/**
 * Shared geometry primitives.
 *
 * Conventions used throughout the project:
 * - Camera space: right-handed, origin at the camera's optical center,
 *   +x right, +y down (image convention), +z pointing *away* from the camera
 *   into the scene. Units are centimeters.
 * - Image space: pixels, origin at the top-left of the camera frame.
 * - Normalized screen space: (0,0) top-left of the display, (1,1) bottom-right.
 *   ALL filtering and layout is done in this space so tuning survives
 *   resolution changes and the projector migration.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A ray in camera space: origin + t * direction (direction need not be unit). */
export interface Ray3 {
  origin: Vec3;
  direction: Vec3;
}

/**
 * The physical screen located in camera space.
 * `origin` is the screen's top-left corner; `basisU`/`basisV` are unit vectors
 * along the screen's width/height directions; `normal` = basisU × basisV.
 * `widthCm`/`heightCm` are the physical dimensions entered at calibration.
 */
export interface ScreenPlane {
  origin: Vec3;
  basisU: Vec3;
  basisV: Vec3;
  normal: Vec3;
  widthCm: number;
  heightCm: number;
}

/** Row-major 3x3 matrix, used for homographies and camera intrinsics. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Vec3 helpers (plain functions, no classes — keeps hot paths allocation-lean
// and trivially testable)
// ---------------------------------------------------------------------------

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  // Degenerate input: return +z rather than NaNs, callers guard separately.
  if (len < 1e-12) return v3(0, 0, 1);
  return scale(a, 1 / len);
};

export const dist2d = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Apply a 3x3 matrix to a 2D point in homogeneous coordinates. */
export function applyHomography(h: Mat3, p: Vec2): Vec2 {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  // w ≈ 0 means the point maps to infinity (degenerate homography or a point
  // on the line at infinity). Return a far-away sentinel; callers clamp.
  if (Math.abs(w) < 1e-12) return { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER };
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}
