/**
 * Hand landmark types and MediaPipe landmark index constants.
 *
 * MediaPipe Hands returns 21 landmarks per hand. Indices are stable and
 * documented here so downstream code never uses magic numbers.
 *
 *         8   12  16  20     (fingertips)
 *         |   |   |   |
 *         7   11  15  19
 *         |   |   |   |
 *         6   10  14  18
 *    4    |   |   |   |
 *     \   5   9   13  17     (knuckles / MCP joints)
 *      3   \  |   |  /
 *       \   \ |   | /
 *        2   \|   |/
 *         \   +---+
 *          1  |palm|
 *           \ +---+
 *            0               (wrist)
 */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/**
 * One landmark as delivered by MediaPipe:
 * x, y are normalized to the camera frame [0..1];
 * z is *relative* depth (wrist ≈ 0), same scale as x. Absolute depth is
 * recovered separately by the depth anchor (see core/tracking/depthAnchor.ts).
 */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Which physical hand a skeleton belongs to, per MediaPipe's classifier. */
export type Handedness = "Left" | "Right";

/** Functional role — deliberately separate from handedness so roles can be
 *  swapped for left-handed users without touching any downstream logic. */
export type HandRole = "pointer" | "gesture";

/** A tracked hand for a single frame. */
export interface TrackedHand {
  landmarks: Landmark[]; // always 21 entries
  handedness: Handedness;
  /** MediaPipe's confidence in the handedness label, [0..1]. */
  handednessScore: number;
}

/** Both hands after role stabilization; either may be absent. */
export interface HandFrame {
  pointer: TrackedHand | null;
  gesture: TrackedHand | null;
  /** Camera frame timestamp in ms (performance.now() domain). */
  timestampMs: number;
}
