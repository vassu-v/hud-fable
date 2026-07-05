# Ray-Pointing HUD — Full System Plan

A camera-based, two-handed, ray-pointing interface: the right hand aims like a laser pointer at the screen, the left hand performs gestures (click, drag, mode). Built to run entirely in-browser first (laptop + built-in webcam pointed at the laptop screen), architected so a projector + external camera can replace the display later with zero logic changes.

---

## 0. Design Philosophy (the non-negotiables)

1. **Pointing is a ray, not a position.** The cursor is where the hand's aiming vector intersects the display plane. Angle has leverage; position barely matters.
2. **Gestures are always local.** A gesture only acts on whatever the ray currently hits — never global commands.
3. **Aim and click with different body parts.** Right hand = pointer, left hand = buttons. This eliminates the Heisenberg problem (the click gesture disturbing the aim) by construction.
4. **The system must feel like aim-assist, not a surgical mouse.** Accuracy budget is Wii-mote-class. UI targets are large; snapping and dead zones are load-bearing, not polish.
5. **Everything downstream consumes a state machine, not raw coordinates.** Freeze, arm, commit, cancel are first-class states from day one, even before gestures exist.

---

## 1. System Architecture Overview

```
Camera frame
   │
   ├─► [A] Calibration module (one-time) ──► screen 3D pose + homography
   │
   ├─► [B] Hand tracking (per-frame, both hands)
   │         └─► 3D skeletons (21 landmarks each, relative z)
   │
   ├─► [C] 3D world assembly
   │         ├─ anchor hands in absolute 3D (apparent-size depth)
   │         └─ screen plane already placed from [A]
   │
   ├─► [D] Ray solver (right hand)
   │         └─ aiming vector → ray-plane intersection → raw screen (x, y)
   │
   ├─► [E] Filtering & stabilization
   │         └─ One Euro filter → dead zone → snap-to-target
   │
   ├─► [F] Pointer state machine
   │         └─ IDLE / TRACKING / HOVER / ARMED / DRAGGING / FROZEN
   │
   ├─► [G] Gesture engine (left hand)  [Phase 2]
   │         └─ emits events INTO the state machine, never directly to UI
   │
   └─► [H] HUD renderer (the actual dashboard UI)
             └─ consumes state machine events like normal pointer events
```

Modules A–F are Phase 1 (shippable without any gestures, using dwell-to-click as a stopgap). G is Phase 2. H develops in parallel from day one with mouse input as the stand-in.

---

## 2. Module A — Calibration (one-time, at startup)

### Goal
Locate the physical screen in the camera's view and recover its full 3D pose (position, distance, tilt, rotation relative to camera).

### Flow (user experience)
1. App fullscreens and displays 4 high-contrast corner markers plus a center marker for sanity checking.
2. User points the camera at the screen so all 4 markers are visible. Live preview shows detection status per corner.
3. When all 4 are stable for ~1 second, capture. Show the detected quadrilateral overlaid on the camera feed for visual confirmation. User confirms or retries.
4. Ask once for physical screen dimensions (width × height in cm) — either manual entry or a preset list of common laptop sizes. Store everything.

> **Implementation note:** the code detects markers ONE AT A TIME by difference
> imaging against a black baseline frame (see `core/calibration/detectMarker.ts`)
> — more robust than simultaneous detection under glare, and it makes marker
> contrast adaptation unnecessary. A manual click-on-preview fallback exists per
> corner.

### Math
- 4 detected corners (image px) + 4 known screen corners (real cm) → solve **homography H** AND **PnP pose** (screen plane's 3D position/orientation in camera coordinates). Both come from the same correspondence set.
- Store: `H`, screen plane as `(point, normal, basisU, basisV)` in camera space, screen physical size.

### Nuances & failure modes
- **Glare / low contrast:** handled by difference imaging (static scene cancels out).
- **Camera or laptop moved after calibration:** one small persistent marker in a HUD corner; if its detected position wanders beyond a threshold, prompt recalibration.
- **Rolling recalibration shortcut:** `C` hotkey to redo calibration in <15s — during development you WILL bump the camera constantly.
- **Camera placement guidance:** dead-on camera placement makes pointing vectors degenerate. Hint shown during calibration: "place camera slightly above or beside the screen at an angle." Any placement where all 4 corners are visible works mathematically.

---

## 3. Module B — Hand Tracking

### Tool
MediaPipe Hands (client-side in browser, ~20–25 fps on modest laptops, 21 landmarks per hand with relative-z, plus handedness labels).

### Configuration decisions
- `maxNumHands: 2`, moderate detection confidence (~0.6), higher tracking confidence (~0.6) to reduce identity flicker.
- **Handedness assignment:** labels flip occasionally. Stabilizer: a hand keeps its assigned role unless the label disagrees for N consecutive frames (~10). Wrist-proximity continuity matching as the primary signal, position prior as fallback, user-swappable for left-handed users.
- **Back-of-hand caveat:** camera faces the screen, so it sees the back of the pointing hand. Mitigated by off-axis camera placement and the aiming-bone choice (Module D).

### Nuances
- **Frame drops / lost tracking:** hold last state for ~300ms grace before declaring the hand gone.
- **Multiple people in frame:** out of scope v1; if >2 hands, keep the two closest to previous tracked positions.
- **Performance:** hand tracking is the FPS bottleneck. Reduced input resolution (640×360) — landmark accuracy degrades gracefully; responsiveness matters more.

---

## 4. Module C — 3D World Assembly

### Depth anchoring (the key trick)
MediaPipe z-values are relative to the wrist, not absolute. Recover absolute hand distance via **apparent size**:
- One-time per-user measurement during calibration: "hold your open right hand flat toward the camera touching the screen bezel" (distance then known from Module A's pose). Record the pixel span of stable palm bones.
- At runtime: `distance ≈ calibrated_distance × (calibrated_pixel_span / current_pixel_span)`.
- Hand 3D position = back-projected image position at that distance; per-joint relative-z layered on top, scaled by the same factor.

### Nuances
- **Palm rotation shrinks apparent span** (foreshortening). Fix: use the maximum of several candidate bone pairs.
- **Accuracy budget:** hand depth error of ±5–10cm is acceptable — ray *origin* error has little leverage on cursor position; only ray *direction* matters much.
- **Different users:** hand-size calibration is per-user, stored in a named profile.

---

## 5. Module D — Ray Solver (Right Hand / Pointer)

### The aiming vector — critical design decision
**Never derive the ray from joints that move during natural hand tension.** Candidates ranked:

1. **Index metacarpal line (wrist → index knuckle, 0 → 5), extended:** most stable; unaffected by finger curl entirely. **← Recommended default.**
2. **Index proximal bone (5 → 6):** closer to true "finger pointing" feel; mildly affected by flexion.
3. **Knuckle 5 → fingertip 8:** most intuitive but most polluted by finger micro-movement — experimental mode only.

The chosen bone's direction in 3D = ray direction; the bone's midpoint = ray origin.

### Intersection
Standard ray–plane intersection against the screen plane → 3D hit point → plane basis → normalized screen coordinates → CSS pixels.

### Nuances
- **Off-screen pointing:** clamp the cursor to the nearest edge with an "off-screen" arrow indicator — losing the cursor is disorienting.
- **Near-parallel rays:** below a threshold incidence angle, hold last position and mark cursor "unstable" (dimmed).
- **Pointing hand too close to screen:** ray gets very short; jitter magnifies. (Position-based fallback blend is a future option.)

---

## 6. Module E — Filtering & Stabilization

Ordered pipeline; each stage independently toggleable for tuning:

1. **One Euro Filter** on (x, y) — adaptive: strong smoothing at rest, minimal smoothing during fast moves. `min_cutoff` and `beta` exposed as dev sliders.
2. **Dead zone** — sub-threshold movement ignored entirely; a resting hand produces a *perfectly* still cursor. Threshold scales with estimated hand distance.
3. **Snap / magnetism** — cursor inside an element's gravity radius eases toward its center; sticky exit (hysteresis) so it doesn't oscillate at boundaries.
4. **Velocity gate** — a single-frame jump beyond a plausibility threshold is discarded, not smoothed.

### Nuances
- Filter in **normalized screen space**, not pixels.
- Snap disabled while DRAGGING (it fights the user's intent).
- Raw-vs-filtered trace recorder overlay built in — pays for itself in tuning time.

---

## 7. Module F — Pointer State Machine

The single interface between tracking-land and UI-land.

### States
```
IDLE      – no pointer hand tracked
TRACKING  – hand tracked, cursor live, over nothing interactive
HOVER     – cursor over an interactive element (element highlighted)
ARMED     – hover sustained past arm-delay (~150ms); ready to accept commit
FROZEN    – cursor position locked (gesture in progress); pointing input ignored
DRAGGING  – commit happened on a draggable; cursor moves the element; snap disabled
```

### Events consumed
`commit_begin`, `commit_end`, `cancel`, `mode(n)` — deliberately abstract: mouse, dwell timer, and left-hand gestures all emit the same events.

### Commit semantics
- Action registers where the cursor was at `commit_begin` (position snapshot), fires on `commit_end` — mouse-up-style, cancellable.
- On `commit_begin`, state → FROZEN (or DRAGGING if target is draggable).

### Phase 1 stopgap input
- **Dwell-to-click:** ARMED for ~800ms → auto-commit with a visible radial countdown.
- **Keyboard/mouse pass-through:** space = commit, esc = cancel.

---

## 8. Module G — Gesture Engine (Left Hand) [Phase 2]

### Vocabulary
| Gesture (left hand) | Detection | Event emitted |
|---|---|---|
| **Pinch** | thumb↔index distance < threshold, scaled by hand size | `commit_begin` / `commit_end` |
| **Fist** | all fingertips near palm center | `cancel` |
| **Open palm, hold 1s** | all fingers extended, low motion | `mode` toggle |

### Detection nuances
- All thresholds scale with apparent hand size.
- Hysteresis on every gesture (pinch-close ≠ pinch-open threshold).
- Onset debouncing: N consecutive frames (~3–4) before emitting.
- Rest-pose immunity: fist requires *deliberate* closure — test with genuinely lazy hands.
- Left hand absent = fine: degrades to dwell-clicking automatically.

### Future gesture expansion (design for, don't build)
- Left-hand pinch-drag while pointer HOVERs a dial = rotary adjustment.
- Two-finger point = context action.
- Event vocabulary stays fixed; new gestures map to events, never to UI behavior.

---

## 9. Module H — The HUD Itself

### Design constraints imposed by the input system
- Minimum target size ~80×80px, generous spacing.
- Every interactive element registers with the state machine (id, bounds, snap radius, draggable?, dwell-enabled?).
- Three visual layers: ambient info / interactive controls / cursor+feedback.
- Cursor: distinct visual states for TRACKING, HOVER, ARMED, FROZEN, unstable.

### Content
- Clock + date, weather, next-event countdown (mock data first)
- Task/project status cards
- Tracking-pipeline FPS widget
- Scrolling activity feed
- Interactive demos: big toggle, slider, draggable card, page switcher

### Nuances
- Dark theme, high contrast — doubles as projector-friendliness.
- All layout in normalized/viewport units → projector migration is plugging in a different display.

---

## 10. Build Order & Milestones

- **M0 — HUD shell (mouse-driven).** UI + state machine contract.
- **M1 — Calibration.** Geometry foundation.
- **M2 — Single-hand ray pointing.** End-to-end pipeline, raw cursor.
- **M3 — Stabilization.** Exit criterion: hold cursor inside an 80px target for 5s without effort.
- **M4 — Dwell interaction.** Shippable v1.
- **M5 — Two-hand gestures.** Pinch/fist/palm; freeze-on-commit verified.
- **M6 — Polish & profiles.** Handedness swap, off-screen indicators, degradation states.
- **M7 (future) — Projector mode.** Same code; markers projected on a wall; external camera.

---

## 11. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Angular error → cursor error amplification (~2° ≈ 2cm at 60cm) | High | Big targets, snapping, dead zones are core design |
| Fingertip-forward degeneracy | High | Off-axis camera placement + metacarpal aiming bone |
| Hand-depth corrupted by palm rotation | Medium | Multi-bone span max; low leverage anyway |
| Handedness label flicker | Medium | N-frame stabilization + continuity matching + manual swap |
| Tracking FPS too low | Medium | Reduced input resolution, FPS widget to monitor |
| Rest-pose false gestures | Medium | Strict closure thresholds + debouncing + hysteresis |
| Camera bumped post-calibration | Low | Drift marker + hotkey recalibration |
| Arm fatigue ("gorilla arm") | Low (v1) | Ray aiming needs only wrist pivots, not arm sweeps |

---

## 12. Open Questions (decided during implementation)

1. Physical screen size: **preset list + manual override** (implemented).
2. Dwell time default — 800ms starting guess; tune with real use (dev slider).
3. ARMED requirement: **HOVER → pinch directly; ARMED only gates dwell-clicks** (implemented — commits accepted from HOVER or ARMED).
4. Left-handed mode: **settings toggle**, roles abstract from day one (implemented).
5. HUD content: **mock-first** (implemented); real integrations later.
