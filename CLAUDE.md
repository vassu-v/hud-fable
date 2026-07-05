# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server (needs a webcam-capable browser; MediaPipe wasm/model load from CDN on first tracking start)
npm run typecheck  # tsc -b --noEmit — strict mode with noUnusedLocals/noUnusedParameters
npm run build      # tsc -b && vite build
```

There is no test suite and no linter config; `npm run typecheck` is the only automated check. The full pointing pipeline can only be verified by hand with a camera, but the entire HUD is drivable with the mouse shim (no camera needed) because mouse input goes through the same state machine.

## What this is

A camera-based ray-pointing interface: the right hand aims a ray at the screen (cursor = ray ∩ screen plane), the left hand gestures (pinch = click, fist = cancel, palm-hold = page switch). The authoritative design document is `docs/PLAN.md`; module-level rationale lives in file header comments, which are deliberately detailed — keep them accurate when changing behavior.

## Architecture — the load-bearing rules

**1. The state machine is the only boundary between tracking-land and UI-land.**
`core/state/pointerStateMachine.ts` (singleton). Input sources (mouse shim, keyboard shim, dwell, gesture engine) emit only the abstract events in `types/events.ts` (`commit_begin`, `commit_end`, `cancel`, `mode`); widgets consume only its notifications (`activate`, `drag_*`, `hover_change`, `dwell_progress`, …) via the `useInteractive` hook. Never let a widget read tracking data directly, and never let a gesture map to UI behavior — gestures map to events. This is what lets dwell-clicking and pinch gestures share one UI, and makes the future projector migration a display swap.

**2. Everything is normalized.**
Filtering, element bounds, cursor positions, and layout all use normalized screen space [0..1] (CSS is viewport-relative). Camera space is centimeters, +z away from the camera (conventions in `types/geometry.ts`). Pixel values appear only at the edges: camera-image detection and final CSS rendering.

**3. All tunables live in `config/settings.ts`.**
One mutable `settings` object, read by modules every frame; the dev panel (backtick key) edits it live. Never hardcode a threshold — add it there with a comment explaining the default. Gesture thresholds must scale with apparent hand size, never absolute pixels.

**4. Commit semantics are mouse-up-style.**
`commit_begin` snapshots the cursor position and freezes aim (FROZEN) or starts a drag (DRAGGING); the action fires on `commit_end` at the snapshotted position; `cancel` aborts. Tracking loss during a drag cancels, never commits.

## Data flow (per frame)

`Camera` → `HandTracker` (MediaPipe) → `RoleStabilizer` (handedness labels flicker; roles are debounced + continuity-matched) → pointer hand: `buildAimingRay` (aiming bone is wrist→index-MCP by default — chosen because finger curl doesn't disturb it) → `intersectScreen` → `FilterPipeline` (velocity gate → One Euro → dead zone → snap; snap is disabled while dragging) → `pointerStateMachine.updateCursor`. Gesture hand goes to `GestureEngine`, which emits events into the same state machine. Wiring lives in `pipeline/trackingPipeline.ts`.

Calibration (`core/calibration/`) recovers the screen's 3D pose from 4 corner markers detected by **difference imaging** (markers shown one at a time against a black baseline frame — glare cancels out). The chain is: detected corners → DLT homography (`homography.ts`) → planar-PnP decomposition (`pose.ts`) → `ScreenPlane` used by the ray solver. Intrinsics are estimated from an assumed FOV, not measured — the math tolerates this because ray *direction*, not origin, dominates cursor position (the same reasoning caps effort on depth accuracy in `depthAnchor.ts`).

## Conventions and gotchas

- React perf pattern: per-frame data never flows through React state. The cursor layer writes DOM transforms directly; `FpsCard`/`DevPanel` poll mutable stats objects. Only rare events (state changes, hover) go through `setState`.
- Singletons: `pointerStateMachine`, `elementRegistry`, `mouseInput`. `TrackingPipeline` is created once in `App.tsx` via a ref.
- Interactive widgets must be ≥ ~80×80 px (aim-assist accuracy budget; `useInteractive` warns in dev). Elements with side effects can set `dwellEnabled: false` to require an explicit commit.
- Calibration frame grabs must happen after paint — `CalibrationScreen` defers behind two rAFs; keep that if touching the capture flow.
- No `esModuleInterop`: use named imports from `react` (no `import React from "react"`); don't annotate component returns with `React.JSX.Element`.
- This code was written without being executed (authored on a machine that can't run it). Treat runtime behavior as unverified until exercised; run `npm run typecheck` before committing.
