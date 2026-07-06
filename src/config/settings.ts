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
    /** Invert MediaPipe's Left/Right labels. Whether raw webcam frames need
     *  this varies by camera/driver (some mirror in hardware). Empirical test:
     *  raise your RIGHT hand — the debug overlay must paint it CYAN. If it's
     *  magenta, flip this. Default false (correct for this laptop's webcam). */
    flipHandedness: boolean;
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

  /**
   * Camera-only mode (no corner-marker calibration). The laptop webcam is
   * embedded in the screen bezel, so the camera and screen are COPLANAR: the
   * camera sits at top-center, the screen extends downward from just below it,
   * and the screen normal equals the camera's optical axis. That fixed
   * geometry is assumed here instead of being recovered from markers.
   */
  assumedScreen: {
    /** Physical screen size (cm). Set to your panel; defaults to a 15.6"
     *  16:9 laptop. Only the aspect/scale matters for where the ray lands. */
    widthCm: number;
    heightCm: number;
    /** How far the webcam sits ABOVE the top edge of the screen (cm). The
     *  screen's top-left corner is placed at (-w/2, thisMargin, 0). */
    cameraMarginTopCm: number;
    /** A user-facing webcam yields a mirrored view: moving the hand to the
     *  user's right moves it LEFT in the raw image. Flip the cursor's x so
     *  control feels natural. Toggle if pointing comes out reversed. */
    mirrorX: boolean;
  };

  /**
   * How camera-only mode maps the hand to the cursor.
   *
   * 'position' (default): the index fingertip's 2D image position, mapped
   * from a comfortable box around the recenter point to the screen. This is
   * the ONLY mapping that is robust on a user-facing webcam: pointing at the
   * camera foreshortens every aiming bone to nearly nothing in the image, so
   * any direction-based mapping ends up computed from MediaPipe's noisy z —
   * jitter on x, near-zero response on y. Fingertip (x, y) is MediaPipe's
   * most accurate signal and involves no z at all.
   *
   * 'angular': yaw/pitch of the aim bone → cursor. Kept for experimentation
   * and for future off-axis camera setups where the bone isn't foreshortened.
   */
  cameraOnlyMapping: "position" | "angular";

  /** Position mapping: fingertip excursion (normalized image units) from the
   *  recenter point that reaches the screen edge. Smaller = more sensitive. */
  positionBox: {
    halfX: number;
    halfY: number;
  };

  /**
   * Angular ("gyro pointer") mapping — the aim bone's yaw/pitch angles map
   * to cursor x/y through an expo response curve. Center is set by the
   * recenter hotkey.
   *
   * WHY EXPO, NOT LINEAR GAIN: the tilt range a finger can express toward an
   * end-on camera is small, and tracking noise is a large fraction of it — a
   * linear gain is either too twitchy to hold still or too slow to reach the
   * edges. The expo curve (game-controller style) is sub-linear near the
   * center (crushes jitter at rest) and accelerates toward the extremes
   * (edges stay reachable), and the range knobs GUARANTEE the edge lands at
   * a physically expressible angle.
   */
  angular: {
    /** Which bone defines the aim in angular mode. Unlike ray-plane mode
     *  (which favours the curl-immune metacarpal), angular pointing needs a
     *  FINGER bone so raising/lowering the point registers as pitch.
     *  'proximal' (index knuckle→first joint) balances vertical response
     *  against fingertip micro-jitter; 'fingertip' has ~2× the image
     *  footprint (better pitch resolution deep into a tilt) but more
     *  micro-jitter. */
    aimBone: "proximal" | "fingertip" | "metacarpal";
    /** Yaw (degrees) from center that reaches the screen's left/right edge. */
    rangeXDeg: number;
    /** Pitch (degrees) from center that reaches the top/bottom edge. Smaller
     *  than X: vertical tilt saturates earlier under foreshortening. */
    rangeYDeg: number;
    /** Response exponent, ≥1. 1 = linear; higher = calmer center / faster
     *  edges. ~1.6 is a good start. */
    expo: number;
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
    flipHandedness: false,
  },
  ray: {
    aimingBone: "metacarpal",
    minIncidenceAngleDeg: 10,
  },
  filter: {
    // minCutoff lowered from 1.0 after camera-only testing: hand-at-rest
    // drift needs stronger smoothing; beta keeps fast moves responsive.
    oneEuroMinCutoff: 0.5,
    oneEuroBeta: 0.007,
    oneEuroDerivCutoff: 1.0,
    // ~2× the original: angular-mode noise at rest is well above the old
    // 3px-equivalent zone.
    deadZoneRadius: 0.005,
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
  assumedScreen: {
    widthCm: 34.5,
    heightCm: 19.4,
    cameraMarginTopCm: 1.0,
    mirrorX: true,
  },
  cameraOnlyMapping: "position",
  positionBox: {
    // ~45% of the frame width of fingertip travel sweeps the full screen.
    // Bigger box = calmer, more deliberate control (and effectively less
    // jitter, since noise shrinks relative to the travel); smaller = flick-
    // of-the-wrist sensitivity. Tune to taste.
    halfX: 0.22,
    halfY: 0.17,
  },
  angular: {
    aimBone: "proximal",
    // The COMPUTED angles run much hotter than the physical tilt (end-on
    // foreshortening), so these are computed-angle ranges, tuned live with
    // the dev-panel sliders (backtick), not protractor values.
    rangeXDeg: 35,
    rangeYDeg: 22,
    expo: 1.6,
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
