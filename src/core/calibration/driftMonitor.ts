/**
 * Post-calibration drift detection.
 *
 * If the camera or laptop is bumped after calibration, every recovered pose
 * is silently wrong. Rather than continuously re-matching all four corners
 * (expensive, fragile), we keep ONE small persistent marker in a HUD corner
 * and periodically check that its detected image position hasn't wandered
 * beyond a threshold from where the calibration says it should be.
 *
 * The check reuses the same difference-imaging trick as calibration: the HUD
 * briefly blanks the marker, grabs a baseline, redraws it, grabs again, and
 * diffs — but that visual blink would be distracting mid-use, so instead we
 * use the cheaper static variant: the marker is a bright disc on the HUD's
 * dark theme, and we search ONLY a small window around the expected position
 * for the local brightness peak. A full-scene search isn't needed because
 * we're validating, not discovering.
 *
 * The monitor runs on a slow timer (a few seconds) — drift is a rare event,
 * not a per-frame concern.
 */

import type { Vec2, Mat3 } from "../../types/geometry";
import { applyHomography } from "../../types/geometry";
import { settings } from "../../config/settings";
import type { Camera } from "../camera";

/** Where the drift marker lives on the HUD, normalized screen coords.
 *  Bottom-right, tucked into the status bar area. */
export const DRIFT_MARKER_NORM: Vec2 = { x: 0.975, y: 0.965 };

export class DriftMonitor {
  /** Latest verdict; the app shows a "recalibrate?" banner when true. */
  driftDetected = false;
  /** Last measured deviation in camera pixels, for the debug panel. */
  lastDeviationPx = 0;

  private expectedImagePos: Vec2;
  private searchRadiusPx: number;

  constructor(
    private camera: Camera,
    homographyScreenToImage: Mat3,
    screenWidthCm: number,
    screenHeightCm: number,
  ) {
    // Project the drift marker's physical position through the calibration
    // homography to find where the camera should see it.
    this.expectedImagePos = applyHomography(homographyScreenToImage, {
      x: DRIFT_MARKER_NORM.x * screenWidthCm,
      y: DRIFT_MARKER_NORM.y * screenHeightCm,
    });
    // Generous search window: 3× the drift threshold, so we can still FIND
    // the marker after a small bump and report how far it moved.
    this.searchRadiusPx = settings.calibration.driftThresholdPx * 3;
  }

  /** Run one check. Call every few seconds, never per-frame. */
  check(): void {
    const frame = this.camera.grabFrame();
    const peak = this.findLocalBrightnessPeak(frame);
    if (!peak) {
      // Marker not found at all — could be occlusion (a hand in front of the
      // camera), so a single miss is NOT drift. Only positional deviation is.
      return;
    }
    this.lastDeviationPx = Math.hypot(
      peak.x - this.expectedImagePos.x,
      peak.y - this.expectedImagePos.y,
    );
    this.driftDetected = this.lastDeviationPx > settings.calibration.driftThresholdPx;
  }

  private findLocalBrightnessPeak(frame: ImageData): Vec2 | null {
    const { width, height, data } = frame;
    const cx = Math.round(this.expectedImagePos.x);
    const cy = Math.round(this.expectedImagePos.y);
    const r = Math.round(this.searchRadiusPx);

    const x0 = Math.max(0, cx - r);
    const x1 = Math.min(width - 1, cx + r);
    const y0 = Math.max(0, cy - r);
    const y1 = Math.min(height - 1, cy + r);
    if (x0 >= x1 || y0 >= y1) return null; // expected position off-frame

    // Brightness-weighted centroid of the top-quartile pixels in the window.
    let peak = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum > peak) peak = lum;
      }
    }
    if (peak < 60) return null; // nothing bright here — probably occluded

    const threshold = peak * 0.75;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < threshold) continue;
        sx += x * lum;
        sy += y * lum;
        sw += lum;
      }
    }
    if (sw === 0) return null;
    return { x: sx / sw, y: sy / sw };
  }
}
