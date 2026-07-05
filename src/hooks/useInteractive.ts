/**
 * useInteractive — how a HUD widget becomes a target for the ray.
 *
 * Attach the returned ref to the widget's root element. The hook:
 *  - registers the element with the shared ElementRegistry (id, normalized
 *    bounds, snap radius, capability flags)
 *  - keeps the bounds fresh through layout changes (ResizeObserver + window
 *    resize; bounds are stored normalized so they must be recomputed when
 *    the viewport changes)
 *  - routes this element's activate/drag notifications to the widget's
 *    callbacks
 *  - reports hover/armed/dwell status back for visual feedback
 *
 * DESIGN CONSTRAINT (accuracy budget): interactive widgets should be at
 * least ~80×80 px — the input system is aim-assist-class, not a surgical
 * mouse. The hook warns in dev if an element registers smaller than that.
 */

import { useEffect, useRef, useState } from "react";
import type { Vec2 } from "../types/geometry";
import { elementRegistry } from "../core/state/elementRegistry";
import { pointerStateMachine } from "../core/state/pointerStateMachine";
import { settings } from "../config/settings";

export interface InteractiveOptions {
  id: string;
  draggable?: boolean;
  dwellEnabled?: boolean;
  /** Override the default gravity radius (normalized units). */
  snapRadius?: number;
  onActivate?: (position: Vec2) => void;
  onDragStart?: (position: Vec2) => void;
  onDragMove?: (position: Vec2) => void;
  onDragEnd?: (position: Vec2) => void;
  onDragCancel?: () => void;
}

export interface InteractiveStatus {
  hovered: boolean;
  armed: boolean;
  /** Dwell countdown progress 0..1 (0 when not counting). */
  dwellProgress: number;
}

const MIN_TARGET_PX = 80;

export function useInteractive<T extends HTMLElement = HTMLDivElement>(
  opts: InteractiveOptions,
): { ref: React.RefObject<T | null>; status: InteractiveStatus } {
  const ref = useRef<T | null>(null);
  const [status, setStatus] = useState<InteractiveStatus>({
    hovered: false,
    armed: false,
    dwellProgress: 0,
  });

  // Callbacks live in a ref so the registry subscription never goes stale
  // without needing to re-register on every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const id = opts.id;

    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (import.meta.env.DEV && (r.width < MIN_TARGET_PX || r.height < MIN_TARGET_PX)) {
        console.warn(
          `[useInteractive] "${id}" is ${Math.round(r.width)}×${Math.round(r.height)}px — ` +
            `below the ${MIN_TARGET_PX}px accuracy budget for ray pointing.`,
        );
      }
      elementRegistry.updateBounds(id, {
        x: r.left / window.innerWidth,
        y: r.top / window.innerHeight,
        w: r.width / window.innerWidth,
        h: r.height / window.innerHeight,
      });
    };

    elementRegistry.register({
      id,
      bounds: { x: 0, y: 0, w: 0, h: 0 },
      snapRadius: opts.snapRadius ?? settings.filter.snapRadius,
      draggable: opts.draggable ?? false,
      dwellEnabled: opts.dwellEnabled ?? true,
    });
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);

    const unsubscribe = pointerStateMachine.subscribe((n) => {
      const o = optsRef.current;
      switch (n.type) {
        case "hover_change":
          setStatus((s) => ({
            ...s,
            hovered: n.elementId === id,
            armed: false,
            dwellProgress: 0,
          }));
          break;
        case "state_change":
          if (n.to === "ARMED") {
            setStatus((s) => (s.hovered ? { ...s, armed: true } : s));
          } else if (n.to === "TRACKING" || n.to === "IDLE") {
            setStatus((s) =>
              s.hovered || s.armed ? { hovered: false, armed: false, dwellProgress: 0 } : s,
            );
          }
          break;
        case "dwell_progress":
          if (n.elementId === id) setStatus((s) => ({ ...s, dwellProgress: n.progress }));
          break;
        case "activate":
          if (n.elementId === id) o.onActivate?.(n.position);
          break;
        case "drag_start":
          if (n.elementId === id) o.onDragStart?.(n.position);
          break;
        case "drag_move":
          if (n.elementId === id) o.onDragMove?.(n.position);
          break;
        case "drag_end":
          if (n.elementId === id) o.onDragEnd?.(n.position);
          break;
        case "drag_cancel":
          if (n.elementId === id) o.onDragCancel?.();
          break;
      }
    });

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      unsubscribe();
      elementRegistry.unregister(id);
    };
    // Re-register only if identity/capabilities change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.id, opts.draggable, opts.dwellEnabled, opts.snapRadius]);

  return { ref, status };
}
