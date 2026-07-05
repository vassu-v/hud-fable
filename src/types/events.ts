/**
 * The event vocabulary shared by ALL input sources (mouse, dwell, keyboard,
 * left-hand gestures). This abstraction is the load-bearing design decision:
 * the HUD and the pointer state machine only ever see these events, so
 * swapping dwell-clicking for pinch gestures requires zero UI changes.
 */

import type { Vec2 } from "./geometry";

/** All states the pointer can be in. See core/state/pointerStateMachine.ts. */
export type PointerState =
  | "IDLE" //      no pointer hand tracked
  | "TRACKING" //  hand tracked, cursor live, over nothing interactive
  | "HOVER" //     cursor over an interactive element
  | "ARMED" //     hover sustained past arm-delay; ready to accept commit
  | "FROZEN" //    cursor locked (gesture in progress / dwell counting down)
  | "DRAGGING"; // commit happened on a draggable; cursor moves the element

/** Events emitted BY input sources INTO the state machine. */
export type InputEvent =
  | { type: "commit_begin" } //  e.g. pinch closed / mouse down / dwell fired
  | { type: "commit_end" } //    e.g. pinch opened / mouse up
  | { type: "cancel" } //        e.g. fist / Escape
  | { type: "mode"; page: number }; // e.g. open-palm hold / page hotkey

/** Cursor quality flags surfaced to the renderer. */
export interface CursorInfo {
  /** Position in normalized screen space [0..1]. */
  position: Vec2;
  /** False when the ray is grazing / tracking is unreliable — render dimmed. */
  stable: boolean;
  /** True when the ray currently misses the screen and we clamped to an edge. */
  offScreen: boolean;
  /** Direction of the off-screen ray hit, for the edge indicator arrow. */
  offScreenAngleRad: number;
}

/** Notifications emitted BY the state machine TO the HUD / interested widgets. */
export type PointerNotification =
  | { type: "state_change"; from: PointerState; to: PointerState }
  | { type: "cursor_move"; cursor: CursorInfo }
  | { type: "hover_change"; elementId: string | null }
  | { type: "activate"; elementId: string; position: Vec2 } // a completed "click"
  | { type: "drag_start"; elementId: string; position: Vec2 }
  | { type: "drag_move"; elementId: string; position: Vec2 }
  | { type: "drag_end"; elementId: string; position: Vec2 }
  | { type: "drag_cancel"; elementId: string }
  | { type: "dwell_progress"; elementId: string; progress: number } // 0..1 for the radial ring
  | { type: "mode_change"; page: number };

export type PointerListener = (n: PointerNotification) => void;
