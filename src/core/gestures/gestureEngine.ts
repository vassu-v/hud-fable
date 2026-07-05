/**
 * Module G — the left-hand gesture engine (Phase 2).
 *
 * Consumes the gesture hand's skeleton each frame, applies temporal
 * robustness on top of the raw pose classifiers (detectors.ts), and emits
 * ABSTRACT input events into the pointer state machine — never anything
 * UI-specific. New gestures map to existing or new events, never directly
 * to UI behavior.
 *
 * Vocabulary (deliberately tiny):
 *   pinch close → commit_begin     pinch open → commit_end
 *   fist        → cancel
 *   open palm held 1s (low motion) → mode toggle (page cycle)
 *
 * Robustness rules, all load-bearing:
 *  - HYSTERESIS: pinch close/open use different thresholds (detectors.ts).
 *  - ONSET DEBOUNCE: a pose must persist for N consecutive frames before
 *    its event fires — gestures are slower than tracking glitches.
 *  - PRIORITY: fist beats pinch beats palm within a frame. A fist while a
 *    pinch-commit is in flight cancels it (that's the whole point of fist).
 *  - GESTURE HAND ABSENT = FINE: the engine simply goes quiet and the
 *    system degrades to dwell-clicking. Both hands are never required.
 */

import type { TrackedHand } from "../../types/landmarks";
import type { InputEvent } from "../../types/events";
import { settings } from "../../config/settings";
import { isFist, isOpenPalm, isPinched, wristMotion } from "./detectors";

type PoseName = "pinch" | "fist" | "palm" | "none";

export class GestureEngine {
  /** Current debounced pinch state — also feeds the pinch hysteresis. */
  pinchClosed = false;

  private prevHand: TrackedHand | null = null;
  /** Consecutive-frame counters per candidate pose (onset debouncing). */
  private candidate: PoseName = "none";
  private candidateFrames = 0;
  /** Open-palm hold tracking. */
  private palmHoldStartMs: number | null = null;
  private palmToggleFired = false;
  /** Fist edge detection — cancel fires once per closure, not per frame. */
  private fistActive = false;
  private currentPage = 0;

  constructor(
    private emit: (ev: InputEvent) => void,
    private pageCount: number,
  ) {}

  /** Feed one frame. `hand` is null when the gesture hand isn't tracked. */
  update(hand: TrackedHand | null, nowMs: number): void {
    if (!hand) {
      // Hand vanished mid-pinch: release the commit rather than leaving the
      // state machine frozen forever. commit_end fires the action, which
      // matches user intent better than a silent cancel on brief dropouts.
      if (this.pinchClosed) {
        this.pinchClosed = false;
        this.emit({ type: "commit_end" });
      }
      this.resetTransients();
      this.prevHand = null;
      return;
    }

    // --- Classify this frame's pose (priority: fist > pinch > palm) -------
    const fist = isFist(hand);
    const pinch = !fist && isPinched(hand, this.pinchClosed);
    const palm = !fist && !pinch && isOpenPalm(hand);
    const pose: PoseName = fist ? "fist" : pinch ? "pinch" : palm ? "palm" : "none";

    // --- Onset debounce ----------------------------------------------------
    if (pose === this.candidate) {
      this.candidateFrames++;
    } else {
      this.candidate = pose;
      this.candidateFrames = 1;
    }
    const confirmed = this.candidateFrames >= settings.gestures.onsetFrames;

    // --- Pinch (commit) edges ----------------------------------------------
    if (confirmed && pose === "pinch" && !this.pinchClosed) {
      this.pinchClosed = true;
      this.emit({ type: "commit_begin" });
    } else if (this.pinchClosed && confirmed && pose !== "pinch" && pose !== "none") {
      // A confirmed different pose ends the pinch...
      this.pinchClosed = false;
      this.emit({ type: "commit_end" });
    } else if (this.pinchClosed && !isPinched(hand, true)) {
      // ...as does the fingers clearly opening (hysteresis threshold).
      // Release intentionally skips the onset debounce: a sluggish
      // commit_end feels far worse than a sluggish commit_begin.
      this.pinchClosed = false;
      this.emit({ type: "commit_end" });
    }

    // --- Fist (cancel) edge ------------------------------------------------
    if (confirmed && pose === "fist") {
      if (!this.fistActive) {
        this.fistActive = true;
        this.emit({ type: "cancel" });
      }
    } else if (confirmed) {
      this.fistActive = false;
    }

    // --- Open palm hold (mode toggle) ---------------------------------------
    if (confirmed && pose === "palm") {
      const moving =
        this.prevHand !== null && wristMotion(this.prevHand, hand) > 0.015;
      if (moving) {
        this.palmHoldStartMs = null; // motion resets the hold
        this.palmToggleFired = false;
      } else if (this.palmHoldStartMs === null) {
        this.palmHoldStartMs = nowMs;
      } else if (
        !this.palmToggleFired &&
        nowMs - this.palmHoldStartMs >= settings.gestures.palmHoldMs
      ) {
        // One toggle per hold — lower the palm to toggle again.
        this.palmToggleFired = true;
        this.currentPage = (this.currentPage + 1) % this.pageCount;
        this.emit({ type: "mode", page: this.currentPage });
      }
    } else {
      this.palmHoldStartMs = null;
      this.palmToggleFired = false;
    }

    this.prevHand = hand;
  }

  /** Keep the engine's page index in sync when pages change by other means
   *  (keyboard shortcut, HUD page-switcher clicks). */
  syncPage(page: number): void {
    this.currentPage = page;
  }

  private resetTransients(): void {
    this.candidate = "none";
    this.candidateFrames = 0;
    this.palmHoldStartMs = null;
    this.palmToggleFired = false;
    this.fistActive = false;
  }
}
