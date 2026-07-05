/**
 * Webcam capture wrapper.
 *
 * Owns the getUserMedia stream and a hidden <video> element, and hands out
 * frames in two forms:
 *  - the raw HTMLVideoElement (what MediaPipe consumes directly — zero copy)
 *  - ImageData snapshots via an offscreen canvas (what the calibration
 *    marker detector consumes)
 *
 * Capture resolution is deliberately modest (settings.camera): hand tracking
 * is the FPS bottleneck and landmark accuracy degrades gracefully at lower
 * resolutions, while responsiveness does not.
 */

import { settings } from "../config/settings";

export class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.canvas = document.createElement("canvas");
    // willReadFrequently keeps getImageData off the GPU readback slow path.
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: settings.camera.width },
        height: { ideal: settings.camera.height },
        // The camera faces the screen, not the user, so we never want any
        // user-facing "mirror" behavior — we always read raw frames.
        facingMode: "user",
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    // Actual granted resolution may differ from the ideal we asked for.
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  get width(): number {
    return this.video.videoWidth;
  }
  get height(): number {
    return this.video.videoHeight;
  }
  get running(): boolean {
    return this.stream !== null;
  }

  /** Grab the current frame as ImageData (copies pixels — calibration only,
   *  never in the per-frame tracking hot path). */
  grabFrame(): ImageData {
    if (this.canvas.width !== this.video.videoWidth) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
    }
    this.ctx.drawImage(this.video, 0, 0);
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }
}
