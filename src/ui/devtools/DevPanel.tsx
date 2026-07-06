/**
 * Dev tuning panel (toggle with the ` backtick key).
 *
 * Feel-tuning the filter stack is empirical — these sliders edit the live
 * `settings` object directly (modules read it every frame), plus stage
 * toggles and the raw-vs-filtered trace overlay. Copy winning values back
 * into config/settings.ts when a tune feels right.
 */

import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, resetSettings, settings } from "../../config/settings";
import type { TrackingPipeline } from "../../pipeline/trackingPipeline";
import { pointerStateMachine } from "../../core/state/pointerStateMachine";

interface SliderSpec {
  label: string;
  get: () => number;
  set: (v: number) => void;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: SliderSpec[] = [
  {
    label: "One Euro min cutoff",
    get: () => settings.filter.oneEuroMinCutoff,
    set: (v) => (settings.filter.oneEuroMinCutoff = v),
    min: 0.1,
    max: 5,
    step: 0.1,
  },
  {
    label: "One Euro beta",
    get: () => settings.filter.oneEuroBeta,
    set: (v) => (settings.filter.oneEuroBeta = v),
    min: 0,
    max: 0.05,
    step: 0.001,
  },
  {
    label: "Dead zone radius",
    get: () => settings.filter.deadZoneRadius,
    set: (v) => (settings.filter.deadZoneRadius = v),
    min: 0,
    max: 0.02,
    step: 0.0005,
  },
  {
    label: "Snap strength",
    get: () => settings.filter.snapStrength,
    set: (v) => (settings.filter.snapStrength = v),
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    label: "Arm delay ms",
    get: () => settings.stateMachine.armDelayMs,
    set: (v) => (settings.stateMachine.armDelayMs = v),
    min: 0,
    max: 600,
    step: 25,
  },
  {
    label: "Dwell time ms",
    get: () => settings.stateMachine.dwellTimeMs,
    set: (v) => (settings.stateMachine.dwellTimeMs = v),
    min: 300,
    max: 2500,
    step: 50,
  },
  {
    label: "Angular range X (deg to edge)",
    get: () => settings.angular.rangeXDeg,
    set: (v) => (settings.angular.rangeXDeg = v),
    min: 5,
    max: 80,
    step: 1,
  },
  {
    label: "Angular range Y (deg to edge)",
    get: () => settings.angular.rangeYDeg,
    set: (v) => (settings.angular.rangeYDeg = v),
    min: 5,
    max: 60,
    step: 1,
  },
  {
    label: "Angular expo (1=linear)",
    get: () => settings.angular.expo,
    set: (v) => (settings.angular.expo = v),
    min: 1,
    max: 3,
    step: 0.1,
  },
  {
    label: "Position box half-width",
    get: () => settings.positionBox.halfX,
    set: (v) => (settings.positionBox.halfX = v),
    min: 0.05,
    max: 0.45,
    step: 0.01,
  },
  {
    label: "Position box half-height",
    get: () => settings.positionBox.halfY,
    set: (v) => (settings.positionBox.halfY = v),
    min: 0.05,
    max: 0.4,
    step: 0.01,
  },
  {
    label: "Pinch close ratio",
    get: () => settings.gestures.pinchCloseRatio,
    set: (v) => (settings.gestures.pinchCloseRatio = v),
    min: 0.1,
    max: 0.6,
    step: 0.01,
  },
  {
    label: "Pinch open ratio",
    get: () => settings.gestures.pinchOpenRatio,
    set: (v) => (settings.gestures.pinchOpenRatio = v),
    min: 0.2,
    max: 0.9,
    step: 0.01,
  },
];

export function DevPanel({
  pipeline,
  onRecalibrate,
}: {
  pipeline: TrackingPipeline;
  onRecalibrate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const rerender = (): void => force((n) => n + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "`") setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const t = pipeline.filter.toggles;

  return (
    <div className="dev-panel">
      <div className="row">
        <strong>Dev panel</strong>
        <span className="dim">` to close</span>
      </div>

      <div className="row" style={{ marginTop: "0.6em" }}>
        <span>state: {pointerStateMachine.state}</span>
        <span>{pipeline.stats.fps} fps</span>
      </div>

      {SLIDERS.map((s) => (
        <label key={s.label}>
          {s.label}: {s.get().toFixed(4)}
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step}
            value={s.get()}
            onChange={(e) => {
              s.set(parseFloat(e.target.value));
              rerender();
            }}
          />
        </label>
      ))}

      <label style={{ marginTop: "1em" }}>Filter stages</label>
      {(Object.keys(t) as (keyof typeof t)[]).map((k) => (
        <div className="row" key={k}>
          <span>{k}</span>
          <input
            type="checkbox"
            checked={t[k]}
            onChange={(e) => {
              t[k] = e.target.checked;
              rerender();
            }}
          />
        </div>
      ))}

      <div className="row" style={{ marginTop: "0.8em" }}>
        <span>trace overlay</span>
        <input
          type="checkbox"
          checked={pipeline.filter.traceEnabled}
          onChange={(e) => {
            pipeline.filter.traceEnabled = e.target.checked;
            pipeline.filter.trace.length = 0;
            rerender();
          }}
        />
      </div>

      <div className="row" style={{ marginTop: "0.8em" }}>
        <span>angular aim bone</span>
        <select
          value={settings.angular.aimBone}
          onChange={(e) => {
            settings.angular.aimBone = e.target.value as typeof settings.angular.aimBone;
            pipeline.recenter();
            rerender();
          }}
        >
          <option value="proximal">proximal (knuckle→joint)</option>
          <option value="fingertip">fingertip (knuckle→tip)</option>
          <option value="metacarpal">metacarpal (wrist→knuckle)</option>
        </select>
      </div>

      <div className="row" style={{ marginTop: "0.8em" }}>
        <span>left-handed mode</span>
        <input
          type="checkbox"
          checked={settings.tracking.leftHandedMode}
          onChange={(e) => {
            settings.tracking.leftHandedMode = e.target.checked;
            rerender();
          }}
        />
      </div>

      <div className="row" style={{ marginTop: "1em" }}>
        <button onClick={onRecalibrate}>Recalibrate (C)</button>
        <button
          onClick={() => {
            resetSettings();
            rerender();
          }}
        >
          Reset to defaults
        </button>
      </div>
      <div className="dim" style={{ marginTop: "0.6em" }}>
        Defaults live in src/config/settings.ts — copy winning values back.
        {JSON.stringify(DEFAULT_SETTINGS) === JSON.stringify(settings) ? " (unchanged)" : " (modified)"}
      </div>

      {pipeline.filter.traceEnabled && <TraceOverlay pipeline={pipeline} />}
    </div>
  );
}

/**
 * Raw-vs-filtered cursor trace, drawn into a small canvas. Raw in red,
 * filtered in cyan — the visual answer to "is the filter helping or lagging".
 */
function TraceOverlay({ pipeline }: { pipeline: TrackingPipeline }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvas) return;
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#04070c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const trace = pipeline.filter.trace;
      if (trace.length < 2) return;

      const plot = (key: "raw" | "filtered", color: string): void => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        trace.forEach((s, i) => {
          const x = s[key].x * canvas.width;
          const y = s[key].y * canvas.height;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      };
      plot("raw", "#ff5d73");
      plot("filtered", "#37c8ff");
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [canvas, pipeline]);

  return (
    <canvas
      ref={setCanvas}
      width={276}
      height={160}
      style={{ marginTop: "0.8em", width: "100%", border: "1px solid var(--edge)" }}
    />
  );
}
