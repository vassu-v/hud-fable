/**
 * React bridge to the pointer state machine's notification stream.
 *
 * Cursor moves happen at tracking rate (~25–60/s); re-rendering the whole
 * React tree per move would dominate the frame budget. So:
 *  - usePointerSnapshot: cheap subscriptions for state / hover / page — the
 *    things that change rarely and affect layout.
 *  - the cursor itself is rendered by CursorLayer, which writes a transform
 *    directly to a DOM node and never re-renders React per move.
 */

import { useEffect, useState } from "react";
import type { PointerState } from "../types/events";
import { pointerStateMachine } from "../core/state/pointerStateMachine";

export interface PointerSnapshot {
  state: PointerState;
  hoveredId: string | null;
  /** id → dwell progress 0..1; only the hovered element ever has an entry. */
  dwellProgress: { id: string; progress: number } | null;
}

export function usePointerSnapshot(): PointerSnapshot {
  const [snap, setSnap] = useState<PointerSnapshot>({
    state: pointerStateMachine.state,
    hoveredId: pointerStateMachine.activeElementId,
    dwellProgress: null,
  });

  useEffect(() => {
    return pointerStateMachine.subscribe((n) => {
      if (n.type === "state_change") {
        setSnap((s) => ({ ...s, state: n.to }));
      } else if (n.type === "hover_change") {
        setSnap((s) => ({ ...s, hoveredId: n.elementId, dwellProgress: null }));
      } else if (n.type === "dwell_progress") {
        setSnap((s) => ({
          ...s,
          dwellProgress: n.progress > 0 ? { id: n.elementId, progress: n.progress } : null,
        }));
      }
    });
  }, []);

  return snap;
}

/** Subscribe to mode/page changes (open-palm hold, keyboard 1–3, switcher). */
export function useHudPage(onExternalChange?: (page: number) => void): [number, (p: number) => void] {
  const [page, setPage] = useState(0);
  useEffect(() => {
    return pointerStateMachine.subscribe((n) => {
      if (n.type === "mode_change") {
        setPage(n.page);
        onExternalChange?.(n.page);
      }
    });
    // onExternalChange is intentionally captured once — it's a stable
    // callback in App.tsx; re-subscribing per render would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [page, setPage];
}
