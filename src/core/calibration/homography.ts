/**
 * Homography estimation via the Direct Linear Transform (DLT).
 *
 * A homography H maps points on one plane to another in homogeneous
 * coordinates: [x' y' 1]ᵀ ~ H [x y 1]ᵀ. We use it in two directions:
 *   - screen-surface (cm) → camera image (px): the "forward" map used to
 *     recover the screen's 3D pose (see pose.ts)
 *   - camera image (px) → screen surface: sanity checks and drift monitoring
 *
 * With exactly 4 correspondences the system is exactly determined (8 unknowns
 * after fixing h33 = 1, 2 equations per point). Hartley normalization is
 * applied first — without it the pixel-scale coordinates make the 8x8 system
 * badly conditioned and the solve visibly inaccurate.
 */

import type { Mat3, Vec2 } from "../../types/geometry";
import { solveLinearSystem } from "../math/linsolve";

interface Normalization {
  /** Similarity transform T such that T·p has centroid 0 and RMS distance √2. */
  T: Mat3;
  Tinv: Mat3;
  apply: (p: Vec2) => Vec2;
}

function buildNormalization(points: Vec2[]): Normalization {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p.x, 0) / n;
  const cy = points.reduce((s, p) => s + p.y, 0) / n;
  const meanDist =
    points.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n || 1;
  const s = Math.SQRT2 / meanDist;

  const T: Mat3 = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  const Tinv: Mat3 = [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1];
  return { T, Tinv, apply: (p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) }) };
}

function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0) as unknown as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export function mat3Invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  return [
    A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
    C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv,
  ];
}

/**
 * Compute the homography mapping src[k] → dst[k]. Requires exactly 4
 * correspondences (the calibration always produces exactly 4 corners).
 * Returns null on degenerate input (e.g. 3 collinear points).
 */
export function computeHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error(`computeHomography expects 4 point pairs, got ${src.length}/${dst.length}`);
  }

  const normSrc = buildNormalization(src);
  const normDst = buildNormalization(dst);
  const s = src.map(normSrc.apply);
  const d = dst.map(normDst.apply);

  // Each correspondence (x,y)→(x',y') contributes two rows of the standard
  // DLT system with h33 fixed to 1:
  //   x·h11 + y·h12 + h13                       - x'x·h31 - x'y·h32 = x'
  //                       x·h21 + y·h22 + h23   - y'x·h31 - y'y·h32 = y'
  const A: number[][] = [];
  const b: number[] = [];
  for (let k = 0; k < 4; k++) {
    const { x, y } = s[k];
    const { x: xp, y: yp } = d[k];
    A.push([x, y, 1, 0, 0, 0, -xp * x, -xp * y]);
    b.push(xp);
    A.push([0, 0, 0, x, y, 1, -yp * x, -yp * y]);
    b.push(yp);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return null;

  const Hnorm: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // Denormalize: H = Tdst⁻¹ · Hnorm · Tsrc
  return mat3Mul(normDst.Tinv, mat3Mul(Hnorm, normSrc.T));
}
