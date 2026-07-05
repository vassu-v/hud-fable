/**
 * Persistence for everything calibration produces, keyed by user profile.
 *
 * Stored in localStorage so a laptop that hasn't moved can skip straight to
 * pointing on the next launch (the drift monitor still verifies validity).
 */

import type { Mat3, ScreenPlane, Vec2 } from "../../types/geometry";

export interface HandSizeCalibration {
  /** Pixel span of the palm (index MCP ↔ pinky MCP) measured at a known
   *  distance — the anchor for apparent-size depth estimation. */
  calibratedSpanPx: number;
  /** The known distance (cm) at which the span was measured. */
  calibratedDistanceCm: number;
  /** Camera frame width at calibration time; spans scale linearly with
   *  resolution, so runtime spans are rescaled by (thisWidth / currentWidth). */
  frameWidth: number;
}

export interface CalibrationData {
  /** Homography: screen-cm coordinates → camera-image pixels. */
  homographyScreenToImage: Mat3;
  /** The recovered 3D screen plane in camera space. */
  plane: ScreenPlane;
  /** Detected image positions of the 4 screen corners (TL, TR, BR, BL) —
   *  kept for the drift monitor and debug overlays. */
  imageCorners: [Vec2, Vec2, Vec2, Vec2];
  /** Camera frame size the calibration was performed at. */
  frameWidth: number;
  frameHeight: number;
  screenWidthCm: number;
  screenHeightCm: number;
  /** Per-user hand-size anchor; null until the hand step has been done. */
  handSize: HandSizeCalibration | null;
  /** Epoch ms — shown in UI so stale calibrations are noticeable. */
  calibratedAt: number;
}

const KEY_PREFIX = "hud-fable/calibration/";
const PROFILE_KEY = "hud-fable/activeProfile";

export function saveCalibration(profile: string, data: CalibrationData): void {
  localStorage.setItem(KEY_PREFIX + profile, JSON.stringify(data));
}

export function loadCalibration(profile: string): CalibrationData | null {
  const raw = localStorage.getItem(KEY_PREFIX + profile);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CalibrationData;
  } catch {
    // Corrupt entry (e.g. schema change between versions): discard it.
    localStorage.removeItem(KEY_PREFIX + profile);
    return null;
  }
}

export function getActiveProfile(): string {
  return localStorage.getItem(PROFILE_KEY) ?? "default";
}

export function setActiveProfile(profile: string): void {
  localStorage.setItem(PROFILE_KEY, profile);
}

/** Common laptop display presets for the physical-size prompt (16:9 panels). */
export const SCREEN_PRESETS: { label: string; widthCm: number; heightCm: number }[] = [
  { label: '13.3" laptop', widthCm: 29.4, heightCm: 16.5 },
  { label: '14" laptop', widthCm: 31.0, heightCm: 17.4 },
  { label: '15.6" laptop', widthCm: 34.5, heightCm: 19.4 },
  { label: '16" laptop', widthCm: 35.4, heightCm: 19.9 },
  { label: '24" monitor', widthCm: 53.1, heightCm: 29.9 },
  { label: '27" monitor', widthCm: 59.8, heightCm: 33.6 },
];
