/**
 * Camera-only "calibration": synthesize the screen plane from a FIXED assumed
 * geometry instead of recovering it from corner markers.
 *
 * Rationale (see settings.assumedScreen): the laptop's built-in webcam is
 * embedded in the screen bezel, so the camera and screen are coplanar. We
 * therefore already know the screen's pose relative to the camera without any
 * calibration — we just place it:
 *
 *   camera at the origin, looking down +z (toward the user);
 *   screen lies in the z = 0 plane, centered horizontally on the camera,
 *   extending downward from just below it;
 *   screen normal = (0, 0, 1) = the camera's optical axis.
 *
 *        origin(-w/2, m, 0) ┌───────────────┐  ← top edge, m cm below camera
 *                           │               │
 *                           │    screen     │   basisU = +x (right)
 *                           │               │   basisV = +y (down)
 *                           └───────────────┘
 *
 * The ray solver only consumes `plane`, so that is the only field that has to
 * be physically meaningful. `homography`/`imageCorners` are placeholders here
 * (the screen is edge-on to a coplanar camera, so a screen→image homography is
 * degenerate) — they are used only by the drift monitor and debug overlays,
 * both of which are disabled in camera-only mode.
 *
 * CAVEAT: this is the "dead-on camera" geometry the design flags as high-risk
 * — pointing at your own screen means aiming back near the lens axis, where
 * MediaPipe's noisiest axis (z) dominates the aim. Expect more jitter than the
 * off-axis external-camera setup; the filtering pipeline is what makes it
 * usable.
 */

import type { Mat3 } from "../../types/geometry";
import { v3 } from "../../types/geometry";
import { settings } from "../../config/settings";
import type { CalibrationData } from "./calibrationStore";

const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Build a synthetic CalibrationData for the coplanar laptop-webcam geometry. */
export function buildAssumedCalibration(frameWidth: number, frameHeight: number): CalibrationData {
  const { widthCm: W, heightCm: H, cameraMarginTopCm: m } = settings.assumedScreen;

  return {
    homographyScreenToImage: IDENTITY_MAT3, // unused in camera-only mode
    plane: {
      origin: v3(-W / 2, m, 0), // screen top-left, in camera space (cm)
      basisU: v3(1, 0, 0), // along screen width → +x (right)
      basisV: v3(0, 1, 0), // down screen height → +y (down)
      normal: v3(0, 0, 1), // = camera optical axis, toward the user
      widthCm: W,
      heightCm: H,
    },
    imageCorners: [
      { x: 0, y: 0 },
      { x: frameWidth, y: 0 },
      { x: frameWidth, y: frameHeight },
      { x: 0, y: frameHeight },
    ],
    frameWidth,
    frameHeight,
    screenWidthCm: W,
    screenHeightCm: H,
    handSize: null, // apparent-size depth falls back to an average palm
    calibratedAt: Date.now(),
  };
}
