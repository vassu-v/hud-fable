/**
 * Registry of interactive HUD elements (the state machine's "world model").
 *
 * Every interactive widget registers itself here (via the useInteractive
 * hook) with its id, bounds, snap radius and capability flags. The registry
 * answers two queries per frame:
 *   - hit test: which element (if any) is under the cursor?
 *   - snap query: which element's gravity field is the cursor inside?
 *
 * All bounds are in NORMALIZED screen space [0..1] — same space the filter
 * pipeline works in — so nothing here changes when resolution or display
 * hardware changes (projector migration).
 */

import type { Vec2 } from "../../types/geometry";

export interface RegisteredElement {
  id: string;
  /** Normalized bounds: x/y = top-left corner, w/h = size. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Extra gravity radius around the bounds for snap, normalized units. */
  snapRadius: number;
  draggable: boolean;
  /** Whether dwell-clicking may auto-commit on this element. Things with
   *  side effects you wouldn't want triggered by parking the cursor
   *  (e.g. page switches) can opt out and require an explicit gesture. */
  dwellEnabled: boolean;
}

export class ElementRegistry {
  private elements = new Map<string, RegisteredElement>();

  register(el: RegisteredElement): void {
    this.elements.set(el.id, el);
  }

  /** Widgets re-report bounds on layout changes (ResizeObserver-driven). */
  updateBounds(id: string, bounds: RegisteredElement["bounds"]): void {
    const el = this.elements.get(id);
    if (el) el.bounds = bounds;
  }

  unregister(id: string): void {
    this.elements.delete(id);
  }

  get(id: string): RegisteredElement | undefined {
    return this.elements.get(id);
  }

  /** Element directly under the point, or null. Smallest-area match wins so
   *  a small control sitting on a large card is selectable. */
  hitTest(p: Vec2): RegisteredElement | null {
    let best: RegisteredElement | null = null;
    let bestArea = Infinity;
    for (const el of this.elements.values()) {
      const { x, y, w, h } = el.bounds;
      if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) {
        const area = w * h;
        if (area < bestArea) {
          bestArea = area;
          best = el;
        }
      }
    }
    return best;
  }

  /**
   * Snap query: the element whose gravity field contains `p`, with its
   * center and the distance to it. `extraRadius` widens every field by the
   * hysteresis bonus while the cursor is already snapped (sticky exit).
   */
  snapTarget(
    p: Vec2,
    extraRadius = 0,
  ): { el: RegisteredElement; center: Vec2; dist: number } | null {
    let best: { el: RegisteredElement; center: Vec2; dist: number } | null = null;
    for (const el of this.elements.values()) {
      const { x, y, w, h } = el.bounds;
      const center = { x: x + w / 2, y: y + h / 2 };
      // Distance from p to the element's RECTANGLE (not center), so large
      // cards don't out-gravitate small nearby buttons.
      const dx = Math.max(x - p.x, 0, p.x - (x + w));
      const dy = Math.max(y - p.y, 0, p.y - (y + h));
      const dist = Math.hypot(dx, dy);
      const radius = el.snapRadius + extraRadius;
      if (dist <= radius && (!best || dist < best.dist)) {
        best = { el, center, dist };
      }
    }
    return best;
  }
}

/** Single shared instance — widgets and the pipeline must see the same set. */
export const elementRegistry = new ElementRegistry();
