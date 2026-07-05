/**
 * App shell — owns the mode (HUD vs. calibrating), the tracking pipeline,
 * the input shims, and the drift monitor. Composition:
 *
 *   <App>
 *     <HudLayout/>          the dashboard (M0+)
 *     <CursorLayer/>        cursor + feedback layer
 *     <DevPanel/>           tuning sliders / trace (backtick)
 *     <CalibrationScreen/>  fullscreen overlay while calibrating
 *
 * Input policy:
 *  - Keyboard shim is ALWAYS on (Space=commit, Esc=cancel, C=recalibrate,
 *    1–3=pages, `=dev panel).
 *  - Mouse shim drives the cursor while hand tracking is OFF, so the whole
 *    HUD is developed/testable without a camera (M0).
 *  - Hand tracking takes over the cursor once started + calibrated; dwell
 *    remains available throughout, gestures on top when the left hand is up.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HUD_PAGE_COUNT, HudLayout } from "./ui/hud/HudLayout";
import { CursorLayer } from "./ui/cursor/CursorLayer";
import { DevPanel } from "./ui/devtools/DevPanel";
import { CalibrationScreen } from "./ui/calibration/CalibrationScreen";
import { TrackingPipeline } from "./pipeline/trackingPipeline";
import { KeyboardInput } from "./core/input/keyboardInput";
import { mouseInput } from "./core/input/mouseInput";
import { DriftMonitor } from "./core/calibration/driftMonitor";
import {
  getActiveProfile,
  loadCalibration,
  type CalibrationData,
} from "./core/calibration/calibrationStore";
import { useHudPage } from "./hooks/usePointerState";

type AppMode = "hud" | "calibrating";

export default function App() {
  const pipelineRef = useRef<TrackingPipeline | null>(null);
  if (!pipelineRef.current) pipelineRef.current = new TrackingPipeline(HUD_PAGE_COUNT);
  const pipeline = pipelineRef.current;

  const [mode, setMode] = useState<AppMode>("hud");
  const [trackingOn, setTrackingOn] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationData | null>(() =>
    loadCalibration(getActiveProfile()),
  );
  const [driftWarning, setDriftWarning] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Page state: switcher clicks call setPage directly; palm gesture /
  // keyboard arrive as mode_change events through the hook.
  const [page, setPage] = useHudPage((p) => pipeline.gestureEngine.syncPage(p));
  const switchPage = useCallback(
    (p: number) => {
      setPage(p);
      pipeline.gestureEngine.syncPage(p);
    },
    [setPage, pipeline],
  );

  // ---- recalibration (button, C key, drift banner) -------------------------
  const startCalibration = useCallback(async () => {
    setStartError(null);
    try {
      // Calibration needs the camera; the hand-size step needs the tracker
      // too, so bring the whole pipeline up (it idles without calibration).
      await pipeline.start();
      setMode("calibrating");
      setDriftWarning(false);
    } catch (err) {
      setStartError(`Camera failed to start: ${err instanceof Error ? err.message : err}`);
    }
  }, [pipeline]);

  const onCalibrationDone = useCallback(() => {
    const data = loadCalibration(getActiveProfile());
    setCalibration(data);
    if (data) pipeline.setCalibration(data);
    setMode("hud");
    setTrackingOn(true);
  }, [pipeline]);

  // ---- keyboard shim (always on) -------------------------------------------
  useEffect(() => {
    const kb = new KeyboardInput(() => void startCalibration());
    kb.start();
    return () => kb.stop();
  }, [startCalibration]);

  // ---- mouse shim: only while hand tracking is not driving the cursor ------
  useEffect(() => {
    if (!trackingOn && mode === "hud") mouseInput.start();
    else mouseInput.stop();
    return () => mouseInput.stop();
  }, [trackingOn, mode]);

  // ---- apply stored calibration to the pipeline on startup -----------------
  useEffect(() => {
    if (calibration) pipeline.setCalibration(calibration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- drift monitor: slow poll while tracking with a calibration ----------
  useEffect(() => {
    if (!trackingOn || !calibration || mode !== "hud") return;
    const monitor = new DriftMonitor(
      pipeline.camera,
      calibration.homographyScreenToImage,
      calibration.screenWidthCm,
      calibration.screenHeightCm,
    );
    const id = setInterval(() => {
      monitor.check();
      if (monitor.driftDetected) setDriftWarning(true);
    }, 4000);
    return () => clearInterval(id);
  }, [trackingOn, calibration, mode, pipeline]);

  const startTracking = useCallback(async () => {
    if (!calibration) {
      void startCalibration();
      return;
    }
    setStartError(null);
    try {
      await pipeline.start();
      pipeline.setCalibration(calibration);
      setTrackingOn(true);
    } catch (err) {
      setStartError(`Camera failed to start: ${err instanceof Error ? err.message : err}`);
    }
  }, [calibration, pipeline, startCalibration]);

  const stopTracking = useCallback(() => {
    pipeline.stop();
    setTrackingOn(false);
  }, [pipeline]);

  return (
    <>
      <HudLayout page={page} onSwitchPage={switchPage} stats={pipeline.stats} />
      <CursorLayer />
      <DevPanel pipeline={pipeline} onRecalibrate={() => void startCalibration()} />

      {/* Session controls: plain mouse-clickable buttons (dev/bootstrap only —
          starting the camera requires a user gesture anyway). */}
      <div style={{ position: "fixed", left: "1vw", bottom: "1.2vh", display: "flex", gap: 8, zIndex: 500 }}>
        {!trackingOn ? (
          <button onClick={() => void startTracking()} style={{ cursor: "pointer" }}>
            ▶ Start hand tracking{calibration ? "" : " (calibrates first)"}
          </button>
        ) : (
          <button onClick={stopTracking} style={{ cursor: "pointer" }}>
            ⏸ Stop tracking
          </button>
        )}
      </div>

      {startError && <div className="banner">{startError}</div>}
      {driftWarning && (
        <div className="banner">
          Camera may have moved since calibration.{" "}
          <button onClick={() => void startCalibration()} style={{ cursor: "pointer" }}>
            Recalibrate
          </button>{" "}
          <button onClick={() => setDriftWarning(false)} style={{ cursor: "pointer" }}>
            Dismiss
          </button>
        </div>
      )}

      {/* The persistent bright disc the drift monitor watches. Only shown
          while tracking (it means nothing to a mouse-driven session). */}
      {trackingOn && <div className="drift-marker" />}

      {mode === "calibrating" && (
        <CalibrationScreen
          camera={pipeline.camera}
          getPointerSpanPx={() => pipeline.latestPointerSpanPx}
          onDone={onCalibrationDone}
        />
      )}
    </>
  );
}
