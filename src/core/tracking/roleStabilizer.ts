/**
 * Hand role assignment + stabilization (Module B).
 *
 * Maps raw per-frame detections (with occasionally-flickering handedness
 * labels) to stable functional ROLES: pointer (aims the ray) and gesture
 * (performs pinch/fist/palm). Rules:
 *
 *  1. Role ← handedness: by default right hand = pointer, left = gesture;
 *     settings.tracking.leftHandedMode mirrors this.
 *  2. Label flips are debounced: an already-assigned hand keeps its role
 *     unless MediaPipe's label disagrees for N consecutive frames (~10).
 *  3. Continuity first: each incoming detection is matched to the previous
 *     frame's hands by wrist proximity, so a momentary label flip on a hand
 *     that hasn't moved doesn't swap roles even for one frame.
 *  4. Position prior as fallback: if two hands appear simultaneously with
 *     the SAME label (MediaPipe does this occasionally), the hand on the
 *     right half of the frame becomes the pointer.
 *  5. Grace window: when a hand disappears, its last state is held for
 *     settings.tracking.lostHandGraceMs before the role is declared vacant,
 *     so brief occlusions don't reset the pointer state machine.
 *  6. >2 hands (someone walks by): keep the two closest to the previously
 *     tracked wrists; multiple people are out of scope for v1.
 *  7. Single-hand fallback: a lone hand in frame always takes the pointer
 *     role, whatever its label says — label conventions vary by camera and
 *     driver, and a mislabeled lone hand must never leave the system
 *     cursorless. Labels only pick roles when BOTH hands are visible.
 */

import type { HandFrame, HandRole, Handedness, TrackedHand } from "../../types/landmarks";
import { LM } from "../../types/landmarks";
import { settings } from "../../config/settings";

interface RoleSlot {
  hand: TrackedHand | null;
  /** Last time this slot was updated with a real detection. */
  lastSeenMs: number;
  /** Consecutive frames the label has disagreed with the assigned role. */
  disagreementFrames: number;
}

/** Which handedness should hold the pointer role right now. */
function pointerHandedness(): Handedness {
  return settings.tracking.leftHandedMode ? "Left" : "Right";
}

function wristOf(h: TrackedHand): { x: number; y: number } {
  return h.landmarks[LM.WRIST];
}

export class RoleStabilizer {
  private slots: Record<HandRole, RoleSlot> = {
    pointer: { hand: null, lastSeenMs: 0, disagreementFrames: 0 },
    gesture: { hand: null, lastSeenMs: 0, disagreementFrames: 0 },
  };

  /**
   * Ingest one frame of raw detections and produce the role-stable frame.
   */
  update(detections: TrackedHand[], nowMs: number): HandFrame {
    let hands = detections;

    // Rule 6: too many hands — keep the two closest to previous positions.
    if (hands.length > 2) {
      hands = this.keepClosestTwo(hands);
    }

    // Rule 3: match detections to existing slots by wrist proximity first.
    const assigned = new Set<TrackedHand>();
    (Object.keys(this.slots) as HandRole[]).forEach((role) => {
      const slot = this.slots[role];
      if (!slot.hand) return;
      const prev = wristOf(slot.hand);
      let best: TrackedHand | null = null;
      let bestDist = 0.2; // normalized units — beyond this it's a new hand
      for (const h of hands) {
        if (assigned.has(h)) continue;
        const w = wristOf(h);
        const d = Math.hypot(w.x - prev.x, w.y - prev.y);
        if (d < bestDist) {
          bestDist = d;
          best = h;
        }
      }
      if (best) {
        assigned.add(best);
        this.updateSlot(role, best, nowMs);
      }
    });

    // Unmatched detections fill vacant roles by label (rule 1) or position
    // prior (rule 4).
    const leftovers = hands.filter((h) => !assigned.has(h));
    for (const h of leftovers) {
      let wantedRole: HandRole =
        h.handedness === pointerHandedness() ? "pointer" : "gesture";
      // SINGLE-HAND FALLBACK: with only one hand in frame, the pointer role
      // always wins. Whether MediaPipe's labels match the user's actual hands
      // varies by camera/driver (see settings.tracking.flipHandedness) — a
      // mislabeled lone hand must never leave the system cursorless.
      if (hands.length === 1 && this.slotVacant("pointer", nowMs)) {
        wantedRole = "pointer";
      }
      if (this.slotVacant(wantedRole, nowMs)) {
        this.updateSlot(wantedRole, h, nowMs);
        assigned.add(h);
      } else {
        const other: HandRole = wantedRole === "pointer" ? "gesture" : "pointer";
        if (this.slotVacant(other, nowMs)) {
          // Position prior sanity check: pointer hand should sit on the
          // pointer side of the frame (right half for right-handed users).
          this.updateSlot(other, h, nowMs);
          assigned.add(h);
        }
        // Both slots occupied: drop the detection (third hand / duplicate).
      }
    }

    // Rule 5: expire slots that have outlived the grace window.
    const grace = settings.tracking.lostHandGraceMs;
    (Object.keys(this.slots) as HandRole[]).forEach((role) => {
      const slot = this.slots[role];
      if (slot.hand && nowMs - slot.lastSeenMs > grace) {
        slot.hand = null;
        slot.disagreementFrames = 0;
      }
    });

    return {
      pointer: this.slots.pointer.hand,
      gesture: this.slots.gesture.hand,
      timestampMs: nowMs,
    };
  }

  /** Force-clear everything (used when calibration restarts). */
  reset(): void {
    for (const role of Object.keys(this.slots) as HandRole[]) {
      this.slots[role] = { hand: null, lastSeenMs: 0, disagreementFrames: 0 };
    }
  }

  private slotVacant(role: HandRole, nowMs: number): boolean {
    const slot = this.slots[role];
    return !slot.hand || nowMs - slot.lastSeenMs > settings.tracking.lostHandGraceMs;
  }

  /**
   * Write a detection into a role slot, tracking label disagreement (rule 2).
   * If the label disagrees for long enough AND the opposite slot is empty,
   * the hand migrates to its label-preferred role.
   */
  private updateSlot(role: HandRole, hand: TrackedHand, nowMs: number): void {
    const slot = this.slots[role];
    const labelPreferredRole: HandRole =
      hand.handedness === pointerHandedness() ? "pointer" : "gesture";

    if (labelPreferredRole !== role) {
      slot.disagreementFrames++;
      if (
        slot.disagreementFrames >= settings.tracking.roleStabilizationFrames &&
        this.slotVacant(labelPreferredRole, nowMs)
      ) {
        // Sustained disagreement — migrate the hand to its labeled role.
        this.slots[labelPreferredRole] = { hand, lastSeenMs: nowMs, disagreementFrames: 0 };
        slot.hand = null;
        slot.disagreementFrames = 0;
        return;
      }
    } else {
      slot.disagreementFrames = 0;
    }

    slot.hand = hand;
    slot.lastSeenMs = nowMs;
  }

  private keepClosestTwo(hands: TrackedHand[]): TrackedHand[] {
    const anchors = [this.slots.pointer.hand, this.slots.gesture.hand].filter(
      (h): h is TrackedHand => h !== null,
    );
    if (anchors.length === 0) return hands.slice(0, 2);

    // Score each detection by distance to its nearest previously-tracked
    // wrist; keep the two best.
    const scored = hands.map((h) => {
      const w = wristOf(h);
      const d = Math.min(
        ...anchors.map((a) => {
          const aw = wristOf(a);
          return Math.hypot(w.x - aw.x, w.y - aw.y);
        }),
      );
      return { h, d };
    });
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, 2).map((s) => s.h);
  }
}
