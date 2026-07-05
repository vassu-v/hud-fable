/**
 * Calibration sequence controller — the state machine behind the calibration
 * screen (ui/calibration/CalibrationScreen.tsx renders whatever this says).
 *
 * Sequence:
 *   1. INTRO / SCREEN_SIZE — camera placement guidance ("slightly above or
 *        beside the screen, at an angle; all 4 corners visible" — dead-on
 *        placement makes pointing vectors degenerate), then physical screen
 *        size via preset list or manual cm entry.
 *   2. BASELINE   — screen goes fully black; capture the baseline frame.
 *   3. CORNER k×4 — show ONE white disc at corner k, detect it as the
 *        brightest difference vs. the baseline (see detectMarker.ts — this
 *        cancels glare and ambient light by construction). Auto-accept once
 *        stable for settings.calibration.stableMs; manual click fallback.
 *   4. CONFIRM    — overlay the detected quadrilateral on the camera feed;
 *        user confirms or retries.
 *   5. HAND_SIZE  — user holds their open pointer hand flat toward the
 *        camera while touching the screen bezel; hand distance is then known
 *        from the just-recovered pose, so recording the palm's pixel span
 *        anchors the apparent-size depth estimator. Skippable (depth then
 *        uses a rough default and degrades gracefully).
 *   6. DONE       — pose + homography persisted to the active profile.
 *
 * The controller is UI-agnostic: it exposes a phase object and methods the
 * UI calls. Frame grabs are driven BY the UI (tickCorner / captureBaseline)
 * because only the UI knows when the marker has actually painted — grabbing
 * before paint would diff against a stale screen.
 */

import type { Vec2 } from "../../types/geometry";
import { settings } from "../../config/settings";
import type { Camera } from "../camera";
import { detectMarkerDiff } from "./detectMarker";
import { computeHomography } from "./homography";
import { estimateIntrinsics } from "./intrinsics";
import { recoverPlaneFromPoints, screenCenter } from "./pose";
import type { CalibrationData } from "./calibrationStore";
import { getActiveProfile, saveCalibration } from "./calibrationStore";
import { length } from "../../types/geometry";

export type CalibrationPhase =
  | { name: "intro" }
  | { name: "screenSize" }
  | { name: "baseline" }
  | { name: "corner"; index: 0 | 1 | 2 | 3 } // TL, TR, BR, BL
  | { name: "confirm"; corners: [Vec2, Vec2, Vec2, Vec2] }
  | { name: "handSize" }
  | { name: "done"; data: CalibrationData }
  | { name: "error"; message: string; retryPhase: CalibrationPhase };

/**
 * Normalized screen positions where the four corner markers are drawn.
 * Inset from the true corners so the discs are fully on-panel; the pose
 * solve uses these exact physical positions, so the inset costs nothing.
 */
export const MARKER_INSET = 0.04;
export const MARKER_POSITIONS_NORM: [Vec2, Vec2, Vec2, Vec2] = [
  { x: MARKER_INSET, y: MARKER_INSET }, // TL
  { x: 1 - MARKER_INSET, y: MARKER_INSET }, // TR
  { x: 1 - MARKER_INSET, y: 1 - MARKER_INSET }, // BR
  { x: MARKER_INSET, y: 1 - MARKER_INSET }, // BL
];

export class CalibrationController {
  phase: CalibrationPhase = { name: "intro" };
  /** Live detection preview for the current corner (null = not seen yet). */
  currentDetection: Vec2 | null = null;
  /** 0..1 progress of the stability countdown, for the UI's ring. */
  stabilityProgress = 0;

  private baseline: ImageData | null = null;
  private detectedCorners: (Vec2 | null)[] = [null, null, null, null];
  private screenWidthCm = 0;
  private screenHeightCm = 0;
  private stableSince: number | null = null;
  private lastStablePos: Vec2 | null = null;
  private pendingData: CalibrationData | null = null;

  constructor(
    private camera: Camera,
    /** Called after every phase/detection update so the UI can re-render. */
    private onChange: () => void,
  ) {}

  begin(): void {
    this.setPhase({ name: "screenSize" });
  }

  setScreenSize(widthCm: number, heightCm: number): void {
    if (!(widthCm > 5 && heightCm > 5)) {
      this.setPhase({
        name: "error",
        message: "Screen dimensions look implausible — enter centimeters, not inches.",
        retryPhase: { name: "screenSize" },
      });
      return;
    }
    this.screenWidthCm = widthCm;
    this.screenHeightCm = heightCm;
    this.setPhase({ name: "baseline" });
  }

  /** Called by the UI after the all-black baseline screen has painted. */
  captureBaseline(): void {
    this.baseline = this.camera.grabFrame();
    this.setPhase({ name: "corner", index: 0 });
  }

  /**
   * Called repeatedly (every ~100ms) by the UI while a corner marker is
   * displayed. Once the detected centroid has stayed within a few pixels
   * for `stableMs`, the corner is accepted automatically.
   */
  tickCorner(): void {
    if (this.phase.name !== "corner" || !this.baseline) return;
    const idx = this.phase.index;

    const det = detectMarkerDiff(this.baseline, this.camera.grabFrame());
    this.currentDetection = det?.center ?? null;

    if (!det) {
      this.stableSince = null;
      this.lastStablePos = null;
      this.stabilityProgress = 0;
      this.onChange();
      return;
    }

    const STABLE_RADIUS_PX = 4;
    const now = performance.now();
    const moved =
      !this.lastStablePos ||
      Math.hypot(det.center.x - this.lastStablePos.x, det.center.y - this.lastStablePos.y) >
        STABLE_RADIUS_PX;

    if (moved) {
      this.stableSince = now;
      this.lastStablePos = det.center;
      this.stabilityProgress = 0;
    } else if (this.stableSince !== null) {
      const elapsed = now - this.stableSince;
      this.stabilityProgress = Math.min(1, elapsed / settings.calibration.stableMs);
      if (elapsed >= settings.calibration.stableMs) {
        this.acceptCorner(idx, det.center);
        return;
      }
    }
    this.onChange();
  }

  /** Manual fallback: user clicked the marker position on the camera preview
   *  because auto-detection failed (extreme glare, very dim screen). */
  manualCorner(imagePos: Vec2): void {
    if (this.phase.name !== "corner") return;
    this.acceptCorner(this.phase.index, imagePos);
  }

  private acceptCorner(idx: 0 | 1 | 2 | 3, pos: Vec2): void {
    this.detectedCorners[idx] = pos;
    this.stableSince = null;
    this.lastStablePos = null;
    this.currentDetection = null;
    this.stabilityProgress = 0;
    if (idx < 3) {
      this.setPhase({ name: "corner", index: (idx + 1) as 0 | 1 | 2 | 3 });
    } else {
      this.setPhase({
        name: "confirm",
        corners: this.detectedCorners as [Vec2, Vec2, Vec2, Vec2],
      });
    }
  }

  retryCorners(): void {
    this.detectedCorners = [null, null, null, null];
    this.setPhase({ name: "baseline" });
  }

  /** User confirmed the overlaid quadrilateral — solve pose + homography. */
  confirm(): void {
    if (this.phase.name !== "confirm") return;
    const imageCorners = this.phase.corners;

    // Physical (cm) positions of the inset markers on the panel.
    const markerCm: Vec2[] = MARKER_POSITIONS_NORM.map((p) => ({
      x: p.x * this.screenWidthCm,
      y: p.y * this.screenHeightCm,
    }));

    const k = estimateIntrinsics(this.camera.width, this.camera.height);
    const plane = recoverPlaneFromPoints(
      markerCm,
      [...imageCorners],
      this.screenWidthCm,
      this.screenHeightCm,
      k,
    );
    const homography = computeHomography(markerCm, [...imageCorners]);

    if (!plane || !homography) {
      this.setPhase({
        name: "error",
        message:
          "Pose solve failed — the detected corners are degenerate (nearly collinear). " +
          "Re-aim the camera so the screen fills more of the frame, then retry.",
        retryPhase: { name: "baseline" },
      });
      return;
    }

    this.pendingData = {
      homographyScreenToImage: homography,
      plane,
      imageCorners,
      frameWidth: this.camera.width,
      frameHeight: this.camera.height,
      screenWidthCm: this.screenWidthCm,
      screenHeightCm: this.screenHeightCm,
      handSize: null,
      calibratedAt: Date.now(),
    };
    this.setPhase({ name: "handSize" });
  }

  /**
   * Record the hand-size depth anchor. `spanPx` is the palm pixel span
   * (index MCP ↔ pinky MCP) measured by the hand tracker while the user
   * touches the screen bezel — their hand is then approximately at the
   * screen-plane distance.
   */
  setHandSpan(spanPx: number): void {
    if (!this.pendingData) return;
    const distCm = length(screenCenter(this.pendingData.plane));
    this.pendingData.handSize = {
      calibratedSpanPx: spanPx,
      calibratedDistanceCm: distCm,
      frameWidth: this.camera.width,
    };
    this.finish();
  }

  skipHandSize(): void {
    this.finish();
  }

  acknowledgeError(): void {
    if (this.phase.name === "error") this.setPhase(this.phase.retryPhase);
  }

  private finish(): void {
    if (!this.pendingData) return;
    saveCalibration(getActiveProfile(), this.pendingData);
    this.setPhase({ name: "done", data: this.pendingData });
  }

  private setPhase(p: CalibrationPhase): void {
    this.phase = p;
    this.onChange();
  }
}
