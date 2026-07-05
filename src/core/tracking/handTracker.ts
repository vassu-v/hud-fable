/**
 * MediaPipe HandLandmarker wrapper (Module B).
 *
 * Responsibilities:
 *  - lazy-load the model (the .task file + wasm are fetched at runtime)
 *  - run detection per video frame in VIDEO mode (uses temporal tracking)
 *  - normalize MediaPipe's output into our TrackedHand shape
 *  - keep only the two most plausible hands if more are visible
 *
 * NOTE ON HANDEDNESS LABELS: MediaPipe reports handedness as seen from the
 * image. Our camera faces the SCREEN (it sees the back of the user's hands,
 * same orientation as an observer standing behind the user), so the labels
 * correspond to the user's actual left/right — but they still flicker
 * occasionally, which is why roleStabilizer.ts exists. Nothing downstream
 * consumes raw labels.
 */

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { TrackedHand } from "../../types/landmarks";
import { settings } from "../../config/settings";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTimeMs = -1;

  /** Model download + wasm init. Call once at startup; safe to re-await. */
  async init(): Promise<void> {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU", // falls back to CPU automatically if unavailable
      },
      runningMode: "VIDEO",
      numHands: settings.tracking.maxNumHands,
      minHandDetectionConfidence: settings.tracking.minDetectionConfidence,
      minTrackingConfidence: settings.tracking.minTrackingConfidence,
      minHandPresenceConfidence: settings.tracking.minDetectionConfidence,
    });
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /**
   * Detect hands in the current video frame. Returns [] when the frame
   * hasn't advanced (video paused / duplicate rAF) so callers never process
   * the same frame twice.
   */
  detect(video: HTMLVideoElement, timestampMs: number): TrackedHand[] {
    if (!this.landmarker || video.videoWidth === 0) return [];
    if (video.currentTime * 1000 === this.lastVideoTimeMs) return [];
    this.lastVideoTimeMs = video.currentTime * 1000;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    const hands: TrackedHand[] = [];

    for (let i = 0; i < result.landmarks.length; i++) {
      const handednessInfo = result.handedness[i]?.[0];
      if (!handednessInfo) continue;
      hands.push({
        landmarks: result.landmarks[i].map((lm) => ({ x: lm.x, y: lm.y, z: lm.z })),
        handedness: handednessInfo.categoryName === "Left" ? "Left" : "Right",
        handednessScore: handednessInfo.score,
      });
    }
    return hands;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
