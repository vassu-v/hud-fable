/**
 * Mouse input shim (Milestone M0 / dev stand-in).
 *
 * Drives the SAME state machine the tracking pipeline drives, so the whole
 * HUD — hover, arming, commits, drags — is developed and testable with a
 * mouse before a single camera frame is processed. Mouse position maps to
 * the normalized cursor; button down/up map to commit_begin/commit_end.
 *
 * Enabled whenever tracking is not running (and toggleable from the dev
 * panel so mouse and hand input never fight over the cursor).
 */

import { pointerStateMachine } from "../state/pointerStateMachine";

export class MouseInput {
  private active = false;
  private onMove = (e: MouseEvent): void => {
    pointerStateMachine.updateCursor(
      {
        position: { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight },
        stable: true,
        offScreen: false,
        offScreenAngleRad: 0,
      },
      performance.now(),
    );
  };
  private onDown = (): void => pointerStateMachine.handleEvent({ type: "commit_begin" });
  private onUp = (): void => pointerStateMachine.handleEvent({ type: "commit_end" });

  start(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mousedown", this.onDown);
    window.addEventListener("mouseup", this.onUp);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mousedown", this.onDown);
    window.removeEventListener("mouseup", this.onUp);
    pointerStateMachine.pointerLost();
  }

  get running(): boolean {
    return this.active;
  }
}

export const mouseInput = new MouseInput();
