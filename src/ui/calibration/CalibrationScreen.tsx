/**
 * The calibration UI — a thin view over CalibrationController (which owns
 * all sequencing logic; see its header comment for the flow).
 *
 * Timing subtlety handled here: baseline/corner frames must only be grabbed
 * AFTER the black screen / marker has actually painted, so captures are
 * deferred behind two requestAnimationFrame ticks ("after next paint").
 */

import { useEffect, useRef, useState } from "react";
import {
  CalibrationController,
  MARKER_POSITIONS_NORM,
} from "../../core/calibration/calibrationController";
import { SCREEN_PRESETS } from "../../core/calibration/calibrationStore";
import type { Camera } from "../../core/camera";

/** Resolve after the browser has painted the current React output. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

export function CalibrationScreen({
  camera,
  getPointerSpanPx,
  onDone,
}: {
  camera: Camera;
  /** Live palm span of the pointer hand (px), for the hand-size step.
   *  Returns 0 while no hand is tracked. */
  getPointerSpanPx: () => number;
  onDone: () => void;
}) {
  // The controller mutates itself and calls onChange; a counter re-renders us.
  const [, setTick] = useState(0);
  const controllerRef = useRef<CalibrationController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new CalibrationController(camera, () => setTick((t) => t + 1));
  }
  const ctrl = controllerRef.current;
  const phase = ctrl.phase;

  // Drive phase-specific capture loops.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    if (phase.name === "baseline") {
      afterPaint().then(() => {
        if (!cancelled) ctrl.captureBaseline();
      });
    } else if (phase.name === "corner") {
      afterPaint().then(() => {
        if (cancelled) return;
        interval = setInterval(() => ctrl.tickCorner(), 100);
      });
    } else if (phase.name === "done") {
      onDone();
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.name, phase.name === "corner" ? phase.index : -1]);

  switch (phase.name) {
    case "intro":
      return (
        <div className="calibration-screen">
          <div className="calibration-panel">
            <h2>Calibrate</h2>
            <p className="dim">
              Point your camera at this screen so all four corners are visible. Place it
              <strong> slightly above or beside the screen, at an angle</strong> — a dead-on
              camera makes pointing vectors degenerate.
            </p>
            <button className="primary" onClick={() => ctrl.begin()}>
              Start
            </button>
          </div>
        </div>
      );

    case "screenSize":
      return <ScreenSizeStep onSubmit={(w, h) => ctrl.setScreenSize(w, h)} />;

    case "baseline":
      // Fully black — this IS the baseline being captured.
      return <div className="calibration-screen" />;

    case "corner": {
      const pos = MARKER_POSITIONS_NORM[phase.index];
      return (
        <div className="calibration-screen">
          <div
            className="calibration-marker"
            style={{ left: `${pos.x * 100}vw`, top: `${pos.y * 100}vh` }}
          />
          <CameraPreview
            camera={camera}
            detection={ctrl.currentDetection}
            hint={`Detecting corner ${phase.index + 1}/4 — ${
              ctrl.currentDetection
                ? `hold still ${Math.round(ctrl.stabilityProgress * 100)}%`
                : "marker not seen; click its position in the preview to set manually"
            }`}
            onClickImage={(p) => ctrl.manualCorner(p)}
          />
        </div>
      );
    }

    case "confirm":
      return (
        <div className="calibration-screen">
          <CameraPreview camera={camera} quad={phase.corners} hint="Detected screen outline" />
          <div className="calibration-panel">
            <p>Does the outline match your screen?</p>
            <div style={{ display: "flex", gap: "1em", justifyContent: "center" }}>
              <button className="primary" onClick={() => ctrl.confirm()}>
                Looks right
              </button>
              <button onClick={() => ctrl.retryCorners()}>Retry</button>
            </div>
          </div>
        </div>
      );

    case "handSize":
      return <HandSizeStep ctrl={ctrl} getPointerSpanPx={getPointerSpanPx} />;

    case "error":
      return (
        <div className="calibration-screen">
          <div className="calibration-panel">
            <p style={{ color: "var(--bad)" }}>{phase.message}</p>
            <button className="primary" onClick={() => ctrl.acknowledgeError()}>
              Retry
            </button>
          </div>
        </div>
      );

    case "done":
      return <div className="calibration-screen" />; // onDone fires from the effect
  }
}

// ---------------------------------------------------------------------------

function ScreenSizeStep({
  onSubmit,
}: {
  onSubmit: (w: number, h: number) => void;
}) {
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  return (
    <div className="calibration-screen">
      <div className="calibration-panel">
        <h2>Physical screen size</h2>
        <p className="dim">Pick a preset or enter the visible panel size in centimeters.</p>
        {SCREEN_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onSubmit(p.widthCm, p.heightCm)}>
            {p.label} — {p.widthCm}×{p.heightCm} cm
          </button>
        ))}
        <div style={{ display: "flex", gap: "0.6em", justifyContent: "center" }}>
          <input
            placeholder="width cm"
            value={w}
            onChange={(e) => setW(e.target.value)}
            style={{ width: "7em" }}
          />
          <input
            placeholder="height cm"
            value={h}
            onChange={(e) => setH(e.target.value)}
            style={{ width: "7em" }}
          />
          <button className="primary" onClick={() => onSubmit(parseFloat(w), parseFloat(h))}>
            Use
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HandSizeStep({
  ctrl,
  getPointerSpanPx,
}: {
  ctrl: CalibrationController;
  getPointerSpanPx: () => number;
}) {
  const [span, setSpan] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSpan(getPointerSpanPx()), 200);
    return () => clearInterval(id);
  }, [getPointerSpanPx]);

  return (
    <div className="calibration-screen">
      <div className="calibration-panel">
        <h2>Hand size (depth anchor)</h2>
        <p className="dim">
          Hold your <strong>pointing hand open, flat toward the camera</strong>, and touch the
          screen bezel. This anchors distance estimation to your hand's size.
        </p>
        <div className="big-number">{span > 0 ? `${Math.round(span)} px` : "no hand"}</div>
        <div style={{ display: "flex", gap: "1em", justifyContent: "center" }}>
          <button className="primary" disabled={span <= 0} onClick={() => ctrl.setHandSpan(span)}>
            Capture
          </button>
          <button onClick={() => ctrl.skipHandSize()}>Skip (use average hand)</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Live camera feed with optional detection dot / quadrilateral overlay. */
function CameraPreview({
  camera,
  detection,
  quad,
  hint,
  onClickImage,
}: {
  camera: Camera;
  detection?: { x: number; y: number } | null;
  quad?: { x: number; y: number }[];
  hint?: string;
  onClickImage?: (p: { x: number; y: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas || camera.width === 0) return;
      if (canvas.width !== camera.width) {
        canvas.width = camera.width;
        canvas.height = camera.height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(camera.video, 0, 0);

      if (detection) {
        ctx.strokeStyle = "#43d97b";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(detection.x, detection.y, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (quad) {
        ctx.strokeStyle = "#37c8ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        quad.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [camera, detection, quad]);

  return (
    <div className="camera-preview" style={{ cursor: onClickImage ? "crosshair" : "default" }}>
      <canvas
        ref={canvasRef}
        onClick={(e) => {
          if (!onClickImage) return;
          const r = e.currentTarget.getBoundingClientRect();
          // Map the CSS click position back to camera-image pixels.
          onClickImage({
            x: ((e.clientX - r.left) / r.width) * camera.width,
            y: ((e.clientY - r.top) / r.height) * camera.height,
          });
        }}
      />
      {hint && (
        <div style={{ padding: "0.5em 1em", color: "var(--text-dim)", fontSize: "0.85em" }}>
          {hint}
        </div>
      )}
    </div>
  );
}
