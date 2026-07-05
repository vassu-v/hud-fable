/**
 * Module F — the pointer state machine.
 *
 * The SINGLE interface between tracking-land and UI-land. The HUD never
 * sees raw coordinates; it subscribes to notifications from here. Input
 * sources (mouse, dwell, keyboard, left-hand gestures) all emit the same
 * abstract events — which is precisely what lets Phase 1 (dwell) and
 * Phase 2 (gestures) share one UI with zero changes.
 *
 * States:
 *   IDLE      – no pointer hand tracked
 *   TRACKING  – cursor live, over nothing interactive
 *   HOVER     – cursor over an interactive element (highlighted)
 *   ARMED     – hover sustained past armDelayMs; ready to accept commit /
 *               eligible for dwell auto-commit
 *   FROZEN    – commit in progress on a non-draggable: cursor POSITION IS
 *               LOCKED and pointing input ignored. The two-hand split
 *               already minimizes gesture-disturbs-aim interference, but
 *               left-hand gestures still cause slight whole-body sway —
 *               belt and suspenders.
 *   DRAGGING  – commit on a draggable: cursor moves the element, snap is
 *               disabled (it fights user intent).
 *
 * Commit semantics (mouse-up-style): the action registers where the cursor
 * was at commit_begin (position snapshot), FIRES on commit_end, and can be
 * cancelled by a `cancel` event before release.
 */

import type { Vec2 } from "../../types/geometry";
import type {
  CursorInfo,
  InputEvent,
  PointerListener,
  PointerNotification,
  PointerState,
} from "../../types/events";
import { settings } from "../../config/settings";
import { elementRegistry } from "./elementRegistry";

export class PointerStateMachine {
  state: PointerState = "IDLE";
  cursor: CursorInfo = {
    position: { x: 0.5, y: 0.5 },
    stable: true,
    offScreen: false,
    offScreenAngleRad: 0,
  };
  /** Element under the cursor (HOVER/ARMED) or being interacted with
   *  (FROZEN/DRAGGING). */
  activeElementId: string | null = null;

  private listeners = new Set<PointerListener>();
  private hoverStartMs = 0;
  /** Cursor position snapshotted at commit_begin — where the action lands. */
  private commitPosition: Vec2 | null = null;
  /** True while dwell input owns the pending commit (renders the ring). */
  private dwellArmedSince: number | null = null;
  dwellInputEnabled = true;

  /** The filter pipeline reads this to disable snap during drags. */
  get isDragging(): boolean {
    return this.state === "DRAGGING";
  }

  subscribe(l: PointerListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(n: PointerNotification): void {
    for (const l of this.listeners) l(n);
  }

  private transition(to: PointerState): void {
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    this.emit({ type: "state_change", from, to });
  }

  // -------------------------------------------------------------------------
  // Per-frame position updates (from the tracking pipeline or mouse shim)
  // -------------------------------------------------------------------------

  /**
   * Feed the stabilized cursor position for this frame.
   * Ignored entirely in FROZEN (position locked); routed to drag handling
   * in DRAGGING.
   */
  updateCursor(cursor: CursorInfo, nowMs: number): void {
    if (this.state === "FROZEN") return; // aim is ignored during a commit

    this.cursor = cursor;
    this.emit({ type: "cursor_move", cursor });

    if (this.state === "DRAGGING") {
      if (this.activeElementId) {
        this.emit({ type: "drag_move", elementId: this.activeElementId, position: cursor.position });
      }
      return;
    }

    if (this.state === "IDLE") this.transition("TRACKING");

    // Hover resolution.
    const hit = elementRegistry.hitTest(cursor.position);
    const hitId = hit?.id ?? null;

    if (hitId !== this.activeElementId) {
      this.activeElementId = hitId;
      this.hoverStartMs = nowMs;
      this.dwellArmedSince = null;
      this.emit({ type: "hover_change", elementId: hitId });
      this.transition(hitId ? "HOVER" : "TRACKING");
      return;
    }

    // Same element as last frame: handle HOVER → ARMED → (dwell auto-commit).
    if (this.state === "HOVER" && hitId) {
      if (nowMs - this.hoverStartMs >= settings.stateMachine.armDelayMs) {
        this.transition("ARMED");
        this.dwellArmedSince = nowMs;
      }
    } else if (this.state === "ARMED" && hitId) {
      this.tickDwell(hitId, nowMs);
    }
  }

  /** Pointer hand fully lost (grace window expired). */
  pointerLost(): void {
    // A drag in flight is cancelled, not committed — losing tracking must
    // never trigger an action.
    if (this.state === "DRAGGING" && this.activeElementId) {
      this.emit({ type: "drag_cancel", elementId: this.activeElementId });
    }
    this.activeElementId = null;
    this.commitPosition = null;
    this.dwellArmedSince = null;
    this.emit({ type: "hover_change", elementId: null });
    this.transition("IDLE");
  }

  // -------------------------------------------------------------------------
  // Dwell (Phase 1 stopgap input, also the both-hands-absent fallback)
  // -------------------------------------------------------------------------

  private tickDwell(elementId: string, nowMs: number): void {
    if (!this.dwellInputEnabled || this.dwellArmedSince === null) return;
    const el = elementRegistry.get(elementId);
    if (!el?.dwellEnabled) return;

    const progress = Math.min(1, (nowMs - this.dwellArmedSince) / settings.stateMachine.dwellTimeMs);
    // Visible radial countdown so an auto-commit never surprises.
    this.emit({ type: "dwell_progress", elementId, progress });

    if (progress >= 1) {
      this.dwellArmedSince = null;
      this.emit({ type: "dwell_progress", elementId, progress: 0 });
      // Dwell is an instantaneous commit: begin+end in one step.
      this.handleEvent({ type: "commit_begin" });
      this.handleEvent({ type: "commit_end" });
    }
  }

  // -------------------------------------------------------------------------
  // Abstract input events (gestures / keyboard / mouse all land here)
  // -------------------------------------------------------------------------

  handleEvent(ev: InputEvent): void {
    switch (ev.type) {
      case "commit_begin":
        this.onCommitBegin();
        break;
      case "commit_end":
        this.onCommitEnd();
        break;
      case "cancel":
        this.onCancel();
        break;
      case "mode":
        this.emit({ type: "mode_change", page: ev.page });
        break;
    }
  }

  private onCommitBegin(): void {
    // Commits only act on whatever the ray currently hits — gestures are
    // always local, never global commands. No target = no-op.
    if (this.state !== "HOVER" && this.state !== "ARMED") return;
    if (!this.activeElementId) return;

    this.commitPosition = { ...this.cursor.position };
    const el = elementRegistry.get(this.activeElementId);

    if (el?.draggable) {
      this.transition("DRAGGING");
      this.emit({ type: "drag_start", elementId: el.id, position: this.commitPosition });
    } else {
      // Freeze the aim while the gesture is in progress.
      this.transition("FROZEN");
    }
  }

  private onCommitEnd(): void {
    if (this.state === "DRAGGING") {
      if (this.activeElementId) {
        this.emit({ type: "drag_end", elementId: this.activeElementId, position: this.cursor.position });
      }
      this.transition("TRACKING");
      this.activeElementId = null;
      this.commitPosition = null;
      return;
    }

    if (this.state === "FROZEN") {
      // Fire the action at the snapshotted position (mouse-up semantics).
      if (this.activeElementId && this.commitPosition) {
        this.emit({
          type: "activate",
          elementId: this.activeElementId,
          position: this.commitPosition,
        });
      }
      this.commitPosition = null;
      // Return to HOVER — the cursor is presumably still on the element;
      // the next updateCursor re-resolves the true state either way.
      this.transition("HOVER");
      this.hoverStartMs = performance.now();
    }
  }

  private onCancel(): void {
    if (this.state === "DRAGGING" && this.activeElementId) {
      this.emit({ type: "drag_cancel", elementId: this.activeElementId });
      this.transition("TRACKING");
      this.activeElementId = null;
    } else if (this.state === "FROZEN") {
      // Abort the pending commit; no action fires.
      this.transition("HOVER");
      this.hoverStartMs = performance.now();
    }
    this.commitPosition = null;
    this.dwellArmedSince = null;
  }
}

/** Single shared instance wired to the one HUD. */
export const pointerStateMachine = new PointerStateMachine();
