/**
 * Module E — the ordered stabilization pipeline.
 *
 * Raw ray-solver output is unusable directly (2° of angular noise ≈ 2 cm of
 * cursor noise at 60 cm). Stages, in order, each independently toggleable
 * for tuning:
 *
 *   1. VELOCITY GATE  — a single-frame jump beyond a plausibility threshold
 *                       is a tracking glitch; DISCARD it (don't smooth it —
 *                       smoothing a teleport still yanks the cursor).
 *   2. ONE EURO       — adaptive smoothing (see oneEuro.ts).
 *   3. DEAD ZONE      — sub-threshold movement is ignored entirely so a
 *                       resting hand yields a PERFECTLY still cursor. The
 *                       threshold scales with hand distance (further =
 *                       noisier = bigger zone).
 *   4. SNAP           — inside an element's gravity radius, ease the cursor
 *                       toward the element center, with sticky exit
 *                       (hysteresis) so it doesn't oscillate at boundaries.
 *                       DISABLED while dragging — it fights user intent.
 *
 * Everything operates in NORMALIZED screen space so tuning survives
 * resolution changes.
 *
 * The pipeline also records raw-vs-filtered traces for the dev overlay —
 * tuning without seeing both curves is guesswork.
 */

import type { Vec2 } from "../../types/geometry";
import { settings } from "../../config/settings";
import { OneEuroFilter2D } from "./oneEuro";
import { elementRegistry } from "../state/elementRegistry";

export interface FilterStageToggles {
  velocityGate: boolean;
  oneEuro: boolean;
  deadZone: boolean;
  snap: boolean;
}

export interface TraceSample {
  t: number;
  raw: Vec2;
  filtered: Vec2;
}

export class FilterPipeline {
  toggles: FilterStageToggles = { velocityGate: true, oneEuro: true, deadZone: true, snap: true };

  /** Snap must not fight a drag; the state machine sets this. */
  draggingActive = false;

  /** Rolling raw/filtered trace for the dev overlay (a few seconds' worth). */
  readonly trace: TraceSample[] = [];
  traceEnabled = false;
  private static readonly TRACE_MAX = 600;

  private oneEuro = new OneEuroFilter2D(
    settings.filter.oneEuroMinCutoff,
    settings.filter.oneEuroBeta,
    settings.filter.oneEuroDerivCutoff,
  );
  private lastOutput: Vec2 | null = null;
  private lastRaw: Vec2 | null = null;
  /** Id of the element the cursor is currently snapped to (for hysteresis). */
  private snappedTo: string | null = null;

  /**
   * Process one raw sample. `handToCameraCm` scales the dead zone.
   * Returns the stabilized cursor position (normalized screen space).
   */
  process(raw: Vec2, timestampMs: number, handToCameraCm: number): Vec2 {
    // Live-apply tuning-panel edits.
    this.oneEuro.setParams(
      settings.filter.oneEuroMinCutoff,
      settings.filter.oneEuroBeta,
      settings.filter.oneEuroDerivCutoff,
    );

    // --- 1. Velocity gate -------------------------------------------------
    if (this.toggles.velocityGate && this.lastRaw) {
      const jump = Math.hypot(raw.x - this.lastRaw.x, raw.y - this.lastRaw.y);
      if (jump > settings.filter.teleportThreshold) {
        // Glitch: pretend this frame never happened. If it was a REAL fast
        // move, the next frame will be near the new position and pass.
        this.lastRaw = raw; // remember it so a persistent new position passes next frame
        return this.lastOutput ?? raw;
      }
    }
    this.lastRaw = raw;

    // --- 2. One Euro ------------------------------------------------------
    let p: Vec2 = this.toggles.oneEuro
      ? this.oneEuro.filter(raw.x, raw.y, timestampMs)
      : { ...raw };

    // --- 3. Dead zone -----------------------------------------------------
    if (this.toggles.deadZone && this.lastOutput) {
      // Zone grows with distance beyond ~50 cm (arm's length baseline).
      const distanceFactor =
        1 + settings.filter.deadZoneDistanceScale * Math.max(0, handToCameraCm / 100 - 0.5);
      const zone = settings.filter.deadZoneRadius * distanceFactor;
      if (Math.hypot(p.x - this.lastOutput.x, p.y - this.lastOutput.y) < zone) {
        p = { ...this.lastOutput }; // perfectly still
      }
    }

    // --- 4. Snap / magnetism ----------------------------------------------
    if (this.toggles.snap && !this.draggingActive) {
      // Sticky exit: while snapped, the effective field is wider by the
      // exit bonus, so leaving requires deliberate movement. Each element's
      // own snapRadius (defaulted from settings by useInteractive) defines
      // the base field.
      const extra = this.snappedTo ? settings.filter.snapExitBonus : 0;
      const target = elementRegistry.snapTarget(p, extra);
      if (target) {
        this.snappedTo = target.el.id;
        const s = settings.filter.snapStrength;
        p = {
          x: p.x + (target.center.x - p.x) * s,
          y: p.y + (target.center.y - p.y) * s,
        };
      } else {
        this.snappedTo = null;
      }
    } else {
      this.snappedTo = null;
    }

    this.lastOutput = p;

    if (this.traceEnabled) {
      this.trace.push({ t: timestampMs, raw, filtered: p });
      if (this.trace.length > FilterPipeline.TRACE_MAX) this.trace.shift();
    }
    return p;
  }

  /** Full reset — called when the pointer hand is lost (grace expired). */
  reset(): void {
    this.oneEuro.reset();
    this.lastOutput = null;
    this.lastRaw = null;
    this.snappedTo = null;
  }
}
