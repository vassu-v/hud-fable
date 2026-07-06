/**
 * The end-to-end tracking pipeline — wires every core module together:
 *
 *   Camera frame ─► HandTracker ─► RoleStabilizer ─┬─► pointer hand:
 *                                                  │     buildAimingRay →
 *                                                  │     intersectScreen →
 *                                                  │     FilterPipeline →
 *                                                  │     PointerStateMachine
 *                                                  └─► gesture hand:
 *                                                        GestureEngine →
 *                                                        (events into the SM)
 *
 * Runs on requestAnimationFrame. MediaPipe skips duplicate video frames
 * internally (see HandTracker.detect), so rAF-rate polling is safe.
 *
 * This module also owns the pointing edge cases that sit between the ray
 * solver and the state machine:
 *  - OFF-SCREEN: ray misses the panel → clamp to the nearest edge and mark
 *    the cursor off-screen (renderer shows an edge arrow; a vanishing
 *    cursor is disorienting).
 *  - GRAZING / UNRELIABLE: hold last position, cursor marked unstable.
 *  - POINTER LOST: after the role stabilizer's grace window, reset the
 *    filter (no stale smoothing state) and tell the state machine.
 */

import type { Vec2 } from "../types/geometry";
import type { HandFrame, TrackedHand } from "../types/landmarks";
import { LM } from "../types/landmarks";
import { Camera } from "../core/camera";
import { HandTracker } from "../core/tracking/handTracker";
import { RoleStabilizer } from "../core/tracking/roleStabilizer";
import { buildAimingRay, intersectScreen } from "../core/ray/raySolver";
import { aimYawPitch } from "../core/ray/angularSolver";
import { length } from "../types/geometry";
import { FilterPipeline } from "../core/filtering/filterPipeline";
import { pointerStateMachine } from "../core/state/pointerStateMachine";
import { GestureEngine } from "../core/gestures/gestureEngine";
import { estimateIntrinsics, type Intrinsics } from "../core/calibration/intrinsics";
import type { CalibrationData } from "../core/calibration/calibrationStore";
import { buildAssumedCalibration } from "../core/calibration/assumedScreen";
import { settings } from "../config/settings";
import { measureSpanPx } from "../core/tracking/depthAnchor";

export interface PipelineStats {
  /** Tracking loop throughput — the honest number, not the render FPS. */
  fps: number;
  pointerTracked: boolean;
  gestureTracked: boolean;
  handToCameraCm: number;
  lastRawNorm: Vec2 | null;
  /** Debug: was the last intersection above the graze threshold? */
  lastReliable: boolean;
  /** Debug: did the last raw hit land outside the screen bounds? */
  lastOffScreen: boolean;
}

export class TrackingPipeline {
  readonly camera = new Camera();
  readonly filter = new FilterPipeline();
  readonly gestureEngine: GestureEngine;

  stats: PipelineStats = {
    fps: 0,
    pointerTracked: false,
    gestureTracked: false,
    handToCameraCm: 0,
    lastRawNorm: null,
    lastReliable: false,
    lastOffScreen: false,
  };

  private tracker = new HandTracker();
  private roles = new RoleStabilizer();
  private intrinsics: Intrinsics | null = null;
  private calibration: CalibrationData | null = null;
  private rafId = 0;
  private running = false;
  private lastCursorNorm: Vec2 = { x: 0.5, y: 0.5 };
  private hadPointer = false;
  private frameTimes: number[] = [];
  /** Flip the cursor's x — set in camera-only mode where the user-facing
   *  webcam gives a mirrored view. Marker calibration leaves it false. */
  private mirrorCursorX = false;
  /** Camera-only mode: map the hand to the cursor without a calibrated
   *  screen (settings.cameraOnlyMapping picks position vs. angular). */
  private cameraOnlyMode = false;
  /** Aim angles (rad) that map to screen center (angular mapping). */
  private angularYawCenter = 0;
  private angularPitchCenter = 0;
  /** Fingertip image position that maps to screen center (position mapping). */
  private positionCenter: Vec2 = { x: 0.5, y: 0.5 };
  /** False until a center has been captured — auto-centered shortly after
   *  pointer acquisition so the cursor starts mid-screen even if the user
   *  never presses R. */
  private centered = false;
  /** Consecutive pointer frames since acquisition — auto-center waits a few
   *  so it never captures the half-visible, glitchy landmarks of a hand
   *  still entering the frame (a garbage center pins the cursor off-screen,
   *  which hides it entirely). */
  private autoCenterFrames = 0;
  private static readonly AUTO_CENTER_DELAY_FRAMES = 12;

  /** Latest pointer-hand palm span (px) — the calibration hand-size step
   *  reads this while the user touches the bezel. */
  latestPointerSpanPx = 0;

  /** Latest role-stabilized frame (both hands) — read by the debug overlay
   *  to draw skeletons. Per-frame data, deliberately not React state. */
  latestFrame: HandFrame | null = null;

  constructor(pageCount: number) {
    this.gestureEngine = new GestureEngine(
      (ev) => pointerStateMachine.handleEvent(ev),
      pageCount,
    );
  }

  setCalibration(data: CalibrationData): void {
    this.calibration = data;
    this.mirrorCursorX = false;
    this.cameraOnlyMode = false;
    this.roles.reset();
    this.filter.reset();
  }

  /**
   * Camera-only mode: skip marker calibration entirely. The hand is mapped to
   * the cursor by settings.cameraOnlyMapping ('position' fingertip mapping by
   * default). Must be called after `start()` so the camera resolution is
   * known. Enables x-mirroring per settings. Handedness labels are left to
   * settings.tracking.flipHandedness — empirically this webcam's raw frames
   * already label correctly, so no flip is forced here; toggle that setting
   * if YOUR right hand shows magenta in the debug overlay.
   */
  useAssumedCalibration(): void {
    this.calibration = buildAssumedCalibration(this.camera.width, this.camera.height);
    this.mirrorCursorX = settings.assumedScreen.mirrorX;
    this.cameraOnlyMode = true;
    this.centered = false; // auto-centers shortly after pointer acquisition
    this.autoCenterFrames = 0;
    this.roles.reset();
    this.filter.reset();
  }

  /**
   * Recenter: capture the pointer hand's current pose as "screen center" —
   * fingertip position for the position mapping, aim angles for the angular
   * mapping (both captured; switching mappings keeps a sane center). Call
   * while pointing comfortably at the middle of the screen. No-op if no
   * pointer hand is tracked.
   */
  recenter(): boolean {
    const hand = this.latestFrame?.pointer;
    if (!hand || !this.intrinsics || !this.calibration) return false;

    const tip = hand.landmarks[LM.INDEX_TIP];
    this.positionCenter = { x: tip.x, y: tip.y };

    const ray = buildAimingRay(
      hand,
      this.intrinsics,
      this.calibration.handSize,
      settings.angular.aimBone,
    );
    const { yaw, pitch, towardScreen } = aimYawPitch(ray.direction);
    if (towardScreen) {
      // Only meaningful while aiming at the screen; a mirrored center would
      // poison every subsequent angular sample.
      this.angularYawCenter = yaw;
      this.angularPitchCenter = pitch;
    }

    this.centered = true;
    this.filter.reset();
    return true;
  }

  /** Debug-overlay accessors (position mapping visualization). */
  get positionMappingCenter(): Vec2 | null {
    return this.cameraOnlyMode && this.centered ? this.positionCenter : null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.camera.start();
    await this.tracker.init();
    this.intrinsics = estimateIntrinsics(this.camera.width, this.camera.height);
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.camera.stop();
    pointerStateMachine.pointerLost();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();

    const detections = this.tracker.detect(this.camera.video, now);
    if (detections.length === 0 && !this.tracker.ready) return;

    const frame = this.roles.update(detections, now);
    this.latestFrame = frame;
    this.trackFps(now);
    this.stats.pointerTracked = frame.pointer !== null;
    this.stats.gestureTracked = frame.gesture !== null;

    // --- Gesture hand -------------------------------------------------------
    this.gestureEngine.update(frame.gesture, now);

    // --- Pointer hand -------------------------------------------------------
    if (frame.pointer && this.intrinsics) {
      this.hadPointer = true;
      this.latestPointerSpanPx = measureSpanPx(
        frame.pointer,
        this.intrinsics.width,
        this.intrinsics.height,
      );
      if (this.calibration) this.solvePointer(frame.pointer, now);
    } else if (this.hadPointer) {
      // Grace window already applied inside RoleStabilizer — this is a real loss.
      this.hadPointer = false;
      this.autoCenterFrames = 0; // a re-acquisition gets the full settle delay
      this.filter.reset();
      pointerStateMachine.pointerLost();
    }
  };

  private solvePointer(hand: TrackedHand, now: number): void {
    if (!this.calibration || !this.intrinsics) return;

    let raw: Vec2;
    let handToCameraCm: number;

    if (this.cameraOnlyMode) {
      // Auto-center shortly after acquisition (delayed past the entering-
      // the-frame glitch window) so the cursor starts mid-screen even if the
      // user never presses R. Until then, pin the cursor mid-screen as
      // "hand acquired" feedback.
      if (!this.centered) {
        this.autoCenterFrames++;
        if (this.autoCenterFrames < TrackingPipeline.AUTO_CENTER_DELAY_FRAMES) {
          pointerStateMachine.updateCursor(
            { position: { x: 0.5, y: 0.5 }, stable: true, offScreen: false, offScreenAngleRad: 0 },
            now,
          );
          return;
        }
        this.recenter();
      }

      // Rough distance for dead-zone scaling only (average palm ≈ 8 cm).
      handToCameraCm =
        this.latestPointerSpanPx > 1 ? (8 * this.intrinsics.fx) / this.latestPointerSpanPx : 60;

      if (settings.cameraOnlyMapping === "position") {
        // Fingertip 2D position mapping — no z anywhere in the path. The
        // recentered fingertip position maps to screen center; excursions of
        // ±positionBox.half map to the screen edges. The raw (unflipped)
        // image is mirrored relative to the user, hence the x sign flip.
        const tip = hand.landmarks[LM.INDEX_TIP];
        const box = settings.positionBox;
        const mx = this.mirrorCursorX ? -1 : 1;
        raw = {
          x: 0.5 + (0.5 * (mx * (tip.x - this.positionCenter.x))) / box.halfX,
          y: 0.5 + (0.5 * (tip.y - this.positionCenter.y)) / box.halfY,
        };
      } else {
        // Angular mapping: aim direction's yaw/pitch → cursor, offset by the
        // recentered "screen center" aim. Experimental on a user-facing
        // webcam (the aim bone is foreshortened; pitch rides on noisy z).
        const ray = buildAimingRay(
          hand,
          this.intrinsics,
          this.calibration.handSize,
          settings.angular.aimBone,
        );
        const { yaw, pitch, towardScreen } = aimYawPitch(ray.direction);
        if (!towardScreen) {
          // Pointing away from the screen: the angles are mirrored garbage —
          // hold the last position, mark the cursor unstable.
          pointerStateMachine.updateCursor(
            { position: this.lastCursorNorm, stable: false, offScreen: false, offScreenAngleRad: 0 },
            now,
          );
          return;
        }
        handToCameraCm = length(ray.origin);
        const g = settings.angular;
        const mx = this.mirrorCursorX ? -1 : 1;
        // Expo response: deflection normalized to the range (±1 at the
        // screen edge), then |u|^expo — sub-linear near center (kills rest
        // jitter), accelerating toward the edges (they stay reachable).
        const curve = (deltaRad: number, rangeDeg: number): number => {
          const u = deltaRad / ((rangeDeg * Math.PI) / 180);
          const c = Math.min(1, Math.abs(u));
          return Math.sign(u) * Math.pow(c, g.expo) * 0.5;
        };
        raw = {
          x: 0.5 + curve(yaw - this.angularYawCenter, g.rangeXDeg) * mx,
          y: 0.5 + curve(pitch - this.angularPitchCenter, g.rangeYDeg),
        };
      }
      this.stats.lastReliable = true;
    } else {
      const ray = buildAimingRay(hand, this.intrinsics, this.calibration.handSize);
      const hit = intersectScreen(ray, this.calibration.plane);
      if (!hit) {
        // Pointing away from the screen entirely: hold position, unstable.
        pointerStateMachine.updateCursor(
          { position: this.lastCursorNorm, stable: false, offScreen: false, offScreenAngleRad: 0 },
          now,
        );
        return;
      }
      this.stats.lastReliable = hit.reliable;
      if (!hit.reliable) {
        // Grazing incidence: intersection blows up numerically — hold last
        // position rather than sending the cursor to the moon.
        pointerStateMachine.updateCursor(
          { position: this.lastCursorNorm, stable: false, offScreen: false, offScreenAngleRad: 0 },
          now,
        );
        return;
      }
      handToCameraCm = hit.handToCameraCm;
      raw = this.mirrorCursorX
        ? { x: 1 - hit.screenNorm.x, y: hit.screenNorm.y }
        : hit.screenNorm;
    }

    this.stats.handToCameraCm = handToCameraCm;
    this.stats.lastRawNorm = raw;

    // Off-screen: clamp to the nearest edge, remember the true direction for
    // the edge indicator arrow.
    const offScreen = raw.x < 0 || raw.x > 1 || raw.y < 0 || raw.y > 1;
    this.stats.lastOffScreen = offScreen;
    const clamped: Vec2 = {
      x: Math.min(1, Math.max(0, raw.x)),
      y: Math.min(1, Math.max(0, raw.y)),
    };
    const offScreenAngleRad = offScreen
      ? Math.atan2(raw.y - clamped.y, raw.x - clamped.x)
      : 0;

    // Keep filter continuity awareness of drags (snap must not fight them).
    this.filter.draggingActive = pointerStateMachine.isDragging;
    const filtered = this.filter.process(clamped, now, handToCameraCm);
    this.lastCursorNorm = filtered;

    pointerStateMachine.updateCursor(
      { position: filtered, stable: true, offScreen, offScreenAngleRad },
      now,
    );
  }

  private trackFps(now: number): void {
    this.frameTimes.push(now);
    // 1-second sliding window.
    while (this.frameTimes.length > 0 && now - this.frameTimes[0] > 1000) {
      this.frameTimes.shift();
    }
    this.stats.fps = this.frameTimes.length;
  }
}

