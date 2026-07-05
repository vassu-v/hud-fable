# hud-fable — Ray-Pointing HUD

A camera-based, two-handed, ray-pointing interface. The **right hand aims like a
laser pointer** at the screen; the **left hand performs gestures** (pinch = click,
fist = cancel, open-palm hold = switch page). Runs entirely in-browser with a
laptop webcam pointed at the laptop screen, and is architected so a projector +
external camera can replace the display later with zero logic changes.

The full design document (philosophy, module specs, risk register) lives in
[`docs/PLAN.md`](docs/PLAN.md). This README covers running and navigating the code.

## Quick start

```bash
npm install
npm run dev        # Vite dev server
npm run typecheck  # tsc, no emit
npm run build      # production build
```

Requires a browser with webcam access (Chrome recommended — MediaPipe's GPU
delegate is most reliable there). The MediaPipe wasm + hand model are fetched
from CDN on first tracking start, so the first run needs network access.

## Using it

1. **Mouse mode (default).** The HUD starts driven by the mouse through the
   exact same state machine hand tracking uses — everything is testable
   without a camera.
2. **Calibrate.** Click *Start hand tracking* (or press `C`). Point the camera
   at the screen — **slightly above or beside it, at an angle** (a dead-on
   camera makes pointing vectors degenerate). The app flashes a white disc at
   each corner and detects it by difference-imaging against a black baseline
   frame, so glare and lamps cancel out. Confirm the detected outline, then
   optionally anchor depth estimation by holding your open pointing hand
   against the screen bezel.
3. **Point.** Right hand aims (the ray comes from the wrist→index-knuckle bone
   by default — finger curl does not disturb it). Hover an element, and either
   let the dwell ring complete (~800 ms) to click, or **pinch your left
   thumb+index** to commit. **Fist cancels**, **open palm held 1 s** switches
   pages. The left hand is optional — without it the system degrades to
   dwell-clicking.

### Keys

| Key | Action |
|---|---|
| `Space` (hold) | commit (click/drag whatever the ray hits) |
| `Esc` | cancel |
| `1`–`3` | switch HUD page |
| `C` | recalibrate (you *will* bump the camera during development) |
| `` ` `` | dev panel: filter tuning sliders, stage toggles, raw-vs-filtered trace |

## Code map

```
src/
├── config/settings.ts        every tunable, with rationale; live-edited by the dev panel
├── types/                    geometry primitives, landmark indices, the event vocabulary
├── core/
│   ├── camera.ts              getUserMedia wrapper + frame grabbing
│   ├── calibration/           Module A: marker detection (difference imaging),
│   │                          DLT homography, planar-PnP pose, drift monitor, persistence
│   ├── tracking/              Module B+C: MediaPipe wrapper, role stabilizer,
│   │                          apparent-size depth anchor
│   ├── ray/raySolver.ts       Module D: aiming bone → ray → plane intersection
│   ├── filtering/             Module E: velocity gate → One Euro → dead zone → snap
│   ├── state/                 Module F: pointer state machine + element registry
│   ├── gestures/              Module G: pinch/fist/palm detectors + temporal engine
│   └── input/                 mouse + keyboard shims (same event vocabulary)
├── pipeline/trackingPipeline.ts  wires camera → hands → ray → filter → state machine
├── hooks/                     React bridges (useInteractive, usePointerSnapshot)
└── ui/                        Module H: HUD widgets, cursor layer, calibration UI, dev panel
```

### The one architectural rule

**Everything downstream consumes the state machine, not coordinates.** Input
sources (mouse, dwell, keyboard, gestures) emit only `commit_begin`,
`commit_end`, `cancel`, `mode(n)`; widgets receive only notifications
(`activate`, `drag_*`, `hover_change`, …) via `useInteractive`. This is what
lets dwell-clicking and pinch gestures share one UI, and what makes the
projector migration a display swap rather than a rewrite.

### Pointer states

`IDLE → TRACKING → HOVER → ARMED → (FROZEN | DRAGGING)` — see
`src/core/state/pointerStateMachine.ts` for the full transition semantics
(commit fires at the position snapshotted on `commit_begin`, mouse-up-style,
and is cancellable).

## Debugging notes

- **Cursor feels laggy** → check the FPS card; if tracking FPS is low, lower
  `settings.camera` resolution. Filtering can't fix a slow pipeline.
- **Cursor jitters at rest** → dev panel: raise dead zone radius or lower One
  Euro `minCutoff`. Watch the raw-vs-filtered trace to see which stage helps.
- **Clicks fire while the left hand rests** → the fist detector's
  `fistClosureRatio` is too loose for that user; tighten it (lower value) in
  the dev panel. Test with a genuinely relaxed hand, not a demo hand.
- **Cursor drifts off target after a camera bump** → the drift banner should
  appear within seconds; press `C` to recalibrate (~15 s).
- **Everything maps to the wrong part of the screen** → physical screen size
  was probably entered in inches; recalibrate with centimeters.
