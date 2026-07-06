/**
 * Camera + skeleton debug overlay (camera-only bring-up tool).
 *
 * Draws the raw webcam frame, both hand skeletons (pointer cyan, gesture
 * magenta), the highlighted aiming bone (wrist→index-MCP — the ray source),
 * and a live numeric readout of what the ray solver is producing. This is the
 * instrument for diagnosing "which axis is moving / why is it jittery": watch
 * the raw normalized hit and the reliable/off-screen flags change as you aim.
 *
 * Per-frame data (video + landmarks) is drawn straight to a canvas on rAF —
 * never through React state — matching the project's perf rule.
 */

import { useEffect, useRef } from "react";
import type { TrackingPipeline } from "../../pipeline/trackingPipeline";
import { LM } from "../../types/landmarks";
import type { TrackedHand } from "../../types/landmarks";
import { settings } from "../../config/settings";

/** MediaPipe hand skeleton bone connections (landmark index pairs). */
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

const VIEW_W = 320;
const VIEW_H = 180;

function drawHand(
  ctx: CanvasRenderingContext2D,
  hand: TrackedHand,
  color: string,
  w: number,
  h: number,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  for (const [a, b] of CONNECTIONS) {
    const la = hand.landmarks[a];
    const lb = hand.landmarks[b];
    ctx.beginPath();
    ctx.moveTo(la.x * w, la.y * h);
    ctx.lineTo(lb.x * w, lb.y * h);
    ctx.stroke();
  }
  for (const lm of hand.landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Highlight the aiming bone (wrist → index MCP) — this is the ray source.
  const wr = hand.landmarks[LM.WRIST];
  const mcp = hand.landmarks[LM.INDEX_MCP];
  ctx.strokeStyle = "#ffe100";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(wr.x * w, wr.y * h);
  ctx.lineTo(mcp.x * w, mcp.y * h);
  ctx.stroke();
}

export function DebugOverlay({ pipeline }: { pipeline: TrackingPipeline }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      // Camera frame (raw, unmirrored — matches the coordinates the math uses).
      const video = pipeline.camera.video;
      if (video.videoWidth > 0) {
        ctx.drawImage(video, 0, 0, VIEW_W, VIEW_H);
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }

      const frame = pipeline.latestFrame;
      if (frame?.pointer) drawHand(ctx, frame.pointer, "#25e0e0", VIEW_W, VIEW_H);
      if (frame?.gesture) drawHand(ctx, frame.gesture, "#e048e0", VIEW_W, VIEW_H);

      // Position-mapping visualization: control box + center cross + a ring
      // on the fingertip that drives the cursor.
      const center = pipeline.positionMappingCenter;
      if (center && settings.cameraOnlyMapping === "position") {
        const box = settings.positionBox;
        const cx = center.x * VIEW_W;
        const cy = center.y * VIEW_H;
        ctx.strokeStyle = "#7fff7f";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          (center.x - box.halfX) * VIEW_W,
          (center.y - box.halfY) * VIEW_H,
          box.halfX * 2 * VIEW_W,
          box.halfY * 2 * VIEW_H,
        );
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy);
        ctx.lineTo(cx + 6, cy);
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx, cy + 6);
        ctx.stroke();
        if (frame?.pointer) {
          const tip = frame.pointer.landmarks[LM.INDEX_TIP];
          ctx.strokeStyle = "#ffe100";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(tip.x * VIEW_W, tip.y * VIEW_H, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const s = pipeline.stats;
      const raw = s.lastRawNorm;
      if (textRef.current) {
        textRef.current.textContent =
          `mapping ${settings.cameraOnlyMapping}   fps ${s.fps}  ` +
          `pointer ${s.pointerTracked ? "●" : "○"}  gesture ${s.gestureTracked ? "●" : "○"}  ` +
          `labels P:${frame?.pointer?.handedness ?? "—"} G:${frame?.gesture?.handedness ?? "—"}\n` +
          `raw  x ${raw ? raw.x.toFixed(3) : "—"}   y ${raw ? raw.y.toFixed(3) : "—"}\n` +
          `dist ${Math.round(s.handToCameraCm)}cm  ` +
          `${s.lastReliable ? "reliable" : "GRAZING"}  ` +
          `${s.lastOffScreen ? "OFF-SCREEN" : "on-screen"}`;
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [pipeline]);

  return (
    <div
      style={{
        position: "fixed",
        top: "1vh",
        right: "1vw",
        zIndex: 900,
        background: "rgba(0,0,0,0.75)",
        border: "1px solid #333",
        borderRadius: 6,
        padding: 6,
        font: "11px/1.4 ui-monospace, monospace",
        color: "#cfe",
      }}
    >
      <canvas
        ref={canvasRef}
        width={VIEW_W}
        height={VIEW_H}
        style={{ display: "block", borderRadius: 4, width: VIEW_W, height: VIEW_H }}
      />
      <div ref={textRef} style={{ whiteSpace: "pre", marginTop: 4 }} />
      <div style={{ marginTop: 2, color: "#889" }}>
        cyan=RIGHT/pointer · magenta=LEFT/gesture · green=control box · R=recenter
      </div>
    </div>
  );
}
