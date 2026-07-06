/**
 * Keyboard pass-through input (dev testing, always active).
 *
 *   Space (hold)  → commit_begin / commit_end   — click whatever the ray hits
 *   Escape        → cancel
 *   1..3          → mode(n)                     — page switching
 *   C             → recalibrate hotkey          — handled by the app shell,
 *                                                 exported here as a callback
 *                                                 so the shell owns the effect
 *   R             → recenter angular aim         — camera-only mode; callback
 *                                                 owned by the app shell too
 *
 * During development you WILL bump the camera constantly; the 5-second
 * recalibration hotkey exists for exactly that.
 */

import { pointerStateMachine } from "../state/pointerStateMachine";

export class KeyboardInput {
  private active = false;
  private spaceHeld = false;

  constructor(
    private onRecalibrate: () => void,
    private onRecenter: () => void = () => {},
  ) {}

  private onKeyDown = (e: KeyboardEvent): void => {
    // Ignore keystrokes aimed at form fields (calibration size entry etc.).
    if (e.target instanceof HTMLInputElement) return;

    if (e.code === "Space" && !this.spaceHeld) {
      this.spaceHeld = true;
      e.preventDefault(); // stop the page from scrolling
      pointerStateMachine.handleEvent({ type: "commit_begin" });
    } else if (e.code === "Escape") {
      pointerStateMachine.handleEvent({ type: "cancel" });
    } else if (e.code === "KeyC") {
      this.onRecalibrate();
    } else if (e.code === "KeyR") {
      this.onRecenter();
    } else if (/^Digit[1-3]$/.test(e.code)) {
      pointerStateMachine.handleEvent({ type: "mode", page: Number(e.code.slice(5)) - 1 });
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space" && this.spaceHeld) {
      this.spaceHeld = false;
      pointerStateMachine.handleEvent({ type: "commit_end" });
    }
  };

  start(): void {
    if (this.active) return;
    this.active = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
