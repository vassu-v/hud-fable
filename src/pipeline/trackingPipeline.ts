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
import type { TrackedHand } from "../types/landmarks";
import { Camera } from "../core/camera";
import { HandTracker } from "../core/tracking/handTracker";
import { RoleStabilizer } from "../core/tracking/roleStabilizer";
import { buildAimingRay, intersectScreen } from "../core/ray/raySolver";
import { FilterPipeline } from "../core/filtering/filterPipeline";
import { pointerStateMachine } from "../core/state/pointerStateMachine";
import { GestureEngine } from "../core/gestures/gestureEngine";
import { estimateIntrinsics, type Intrinsics } from "../core/calibration/intrinsics";
import type { CalibrationData } from "../core/calibration/calibrationStore";
import { measureSpanPx } from "../core/tracking/depthAnchor";

export interface PipelineStats {
  /** Tracking loop throughput — the honest number, not the render FPS. */
  fps: number;
  pointerTracked: boolean;
  gestureTracked: boolean;
  handToCameraCm: number;
  lastRawNorm: Vec2 | null;
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

  /** Latest pointer-hand palm span (px) — the calibration hand-size step
   *  reads this while the user touches the bezel. */
  latestPointerSpanPx = 0;

  constructor(pageCount: number) {
    this.gestureEngine = new GestureEngine(
      (ev) => pointerStateMachine.handleEvent(ev),
      pageCount,
    );
  }

  setCalibration(data: CalibrationData): void {
    this.calibration = data;
    this.roles.reset();
    this.filter.reset();
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
      this.filter.reset();
      pointerStateMachine.pointerLost();
    }
  };

  private solvePointer(hand: TrackedHand, now: number): void {
    if (!this.calibration || !this.intrinsics) return;

    const ray = buildAimingRay(hand, this.intrinsics, this.calibration.handSize);
    const hit = intersectScreen(ray, this.calibration.plane);

    if (!hit) {
      // Pointing away from the screen entirely: hold position, mark unstable.
      pointerStateMachine.updateCursor(
        { position: this.lastCursorNorm, stable: false, offScreen: false, offScreenAngleRad: 0 },
        now,
      );
      return;
    }

    this.stats.handToCameraCm = hit.handToCameraCm;
    this.stats.lastRawNorm = hit.screenNorm;

    if (!hit.reliable) {
      // Grazing incidence: intersection blows up numerically — hold last
      // position rather than sending the cursor to the moon.
      pointerStateMachine.updateCursor(
        { position: this.lastCursorNorm, stable: false, offScreen: false, offScreenAngleRad: 0 },
        now,
      );
      return;
    }

    // Off-screen: clamp to the nearest edge, remember the true direction for
    // the edge indicator arrow.
    const raw = hit.screenNorm;
    const offScreen = raw.x < 0 || raw.x > 1 || raw.y < 0 || raw.y > 1;
    const clamped: Vec2 = {
      x: Math.min(1, Math.max(0, raw.x)),
      y: Math.min(1, Math.max(0, raw.y)),
    };
    const offScreenAngleRad = offScreen
      ? Math.atan2(raw.y - clamped.y, raw.x - clamped.x)
      : 0;

    // Keep filter continuity awareness of drags (snap must not fight them).
    this.filter.draggingActive = pointerStateMachine.isDragging;
    const filtered = this.filter.process(clamped, now, hit.handToCameraCm);
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

