/**
 * Every tunable in the system lives here, grouped by module, with the
 * reasoning behind each default. The dev tuning panel (ui/devtools) edits a
 * mutable copy of this object at runtime; these are the cold-start defaults.
 *
 * Feel-tuning is empirical — expect to change these with the sliders, then
 * copy the winning values back into this file.
 */

export interface Settings {
  camera: {
    /** Requested capture resolution. Hand tracking is the FPS bottleneck;
     *  landmark accuracy degrades gracefully at lower input resolutions and
     *  responsiveness matters more than pixel precision. */
    width: number;
    height: number;
  };

  tracking: {
    maxNumHands: number;
    /** Moderate — we'd rather re-detect than miss a hand. */
    minDetectionConfidence: number;
    /** Higher than detection — reduces identity flicker between frames. */
    minTrackingConfidence: number;
    /** A hand keeps its role unless MediaPipe's handedness label disagrees
     *  for this many consecutive frames (labels flip occasionally). */
    roleStabilizationFrames: number;
    /** Hold last hand state for this long after tracking loss before
     *  declaring the hand gone (brief occlusions shouldn't reset state). */
    lostHandGraceMs: number;
    /** Swap roles for left-handed users (left aims, right gestures). */
    leftHandedMode: boolean;
  };

  ray: {
    /** Which bone defines the aiming direction. 'metacarpal' (wrist→index
     *  knuckle) is the stable default: unaffected by finger curl entirely.
     *  'proximal' (knuckle→middle joint) feels more like finger-pointing but
     *  picks up mild flexion noise. 'fingertip' (knuckle→tip) is intuitive
     *  but polluted by finger micro-movement — experimental only. */
    aimingBone: "metacarpal" | "proximal" | "fingertip";
    /** Below this ray-vs-plane incidence angle (degrees) the intersection
     *  math explodes to huge coordinates; hold last position instead and
     *  mark the cursor unstable. */
    minIncidenceAngleDeg: number;
  };

  filter: {
    /** One Euro: cutoff frequency at zero speed. Lower = smoother at rest. */
    oneEuroMinCutoff: number;
    /** One Euro: speed coefficient. Higher = less lag during fast moves. */
    oneEuroBeta: number;
    /** One Euro: cutoff for the internal speed estimate. Rarely needs tuning. */
    oneEuroDerivCutoff: number;
    /** Movement below this (normalized units) is ignored entirely so a
     *  resting hand produces a perfectly still cursor. ~3px at 1080p. */
    deadZoneRadius: number;
    /** Dead zone grows with hand distance (further = noisier). Multiplier
     *  applied per meter beyond the calibration distance. */
    deadZoneDistanceScale: number;
    /** A single-frame jump beyond this (normalized units) is a tracking
     *  glitch — discard the sample rather than smoothing it. */
    teleportThreshold: number;
    /** Snap: cursor inside (elementRadius + snapRadius) eases toward the
     *  element center. Normalized units. */
    snapRadius: number;
    /** Snap hysteresis: must travel this much *further* than the entry
     *  radius to escape, so the cursor doesn't oscillate at boundaries. */
    snapExitBonus: number;
    /** Per-frame easing factor toward the snap target, 0..1. */
    snapStrength: number;
  };

  stateMachine: {
    /** HOVER → ARMED after this much sustained hover. */
    armDelayMs: number;
    /** ARMED → auto-commit (dwell click) after this much additional time.
     *  Only active when dwell input is enabled. */
    dwellTimeMs: number;
  };

  gestures: {
    /** Pinch closes when thumbtip↔indextip distance < close × handSpan,
     *  and opens only when > open × handSpan. Open must be clearly wider
     *  (hysteresis) so a borderline pinch doesn't machine-gun clicks. */
    pinchCloseRatio: number;
    pinchOpenRatio: number;
    /** Fist requires fingertips within this radius of the palm center
     *  (× handSpan). Deliberately tight: a relaxed hanging hand half-curls
     *  and must NOT read as a fist. */
    fistClosureRatio: number;
    /** Open-palm mode toggle requires all fingers extended AND low motion
     *  for this long. */
    palmHoldMs: number;
    /** Require this many consecutive agreeing frames before emitting any
     *  gesture event (gestures are slower than tracking glitches). */
    onsetFrames: number;
  };

  calibration: {
    /** Corners must be detected stably for this long before capture. */
    stableMs: number;
    /** Drift monitor: if the persistent corner marker wanders more than
     *  this many camera pixels from its calibrated position, prompt
     *  recalibration. */
    driftThresholdPx: number;
    /** Assumed horizontal field of view for the intrinsics estimate when
     *  the camera is uncalibrated. Typical laptop webcams: 55–70°. */
    assumedHfovDeg: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  camera: { width: 640, height: 360 },
  tracking: {
    maxNumHands: 2,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
    roleStabilizationFrames: 10,
    lostHandGraceMs: 300,
    leftHandedMode: false,
  },
  ray: {
    aimingBone: "metacarpal",
    minIncidenceAngleDeg: 10,
  },
  filter: {
    oneEuroMinCutoff: 1.0,
    oneEuroBeta: 0.007,
    oneEuroDerivCutoff: 1.0,
    deadZoneRadius: 0.0028,
    deadZoneDistanceScale: 1.5,
    teleportThreshold: 0.25,
    snapRadius: 0.03,
    snapExitBonus: 0.015,
    snapStrength: 0.35,
  },
  stateMachine: {
    armDelayMs: 150,
    dwellTimeMs: 800,
  },
  gestures: {
    pinchCloseRatio: 0.28,
    pinchOpenRatio: 0.45,
    fistClosureRatio: 0.55,
    palmHoldMs: 1000,
    onsetFrames: 4,
  },
  calibration: {
    stableMs: 1000,
    driftThresholdPx: 12,
    assumedHfovDeg: 62,
  },
};

/**
 * The live, mutable settings object. Modules read from this every frame so
 * the tuning panel's edits take effect immediately without plumbing.
 */
export const settings: Settings = structuredClone(DEFAULT_SETTINGS);

export function resetSettings(): void {
  Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
}
