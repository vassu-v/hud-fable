/**
 * The cursor + feedback layer (topmost, never captures input).
 *
 * PERFORMANCE NOTE: cursor positions arrive at tracking rate. Instead of
 * setState-per-move (which would re-render React constantly), this component
 * subscribes to the state machine directly and writes a CSS transform onto
 * a DOM node. React only re-renders on STATE changes (rare).
 *
 * Visual states (distinct at a glance from 1 m):
 *   TRACKING  small dot          HOVER/ARMED  expanded ring (+glow)
 *   FROZEN    amber + lock       DRAGGING     green
 *   unstable  dimmed             off-screen   edge arrow instead of dot
 */

import { useEffect, useRef, useState } from "react";
import type { CursorInfo, PointerState } from "../../types/events";
import { pointerStateMachine } from "../../core/state/pointerStateMachine";

export function CursorLayer() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PointerState>(pointerStateMachine.state);
  const [flags, setFlags] = useState({ unstable: false, offScreen: false });

  useEffect(() => {
    const applyCursor = (c: CursorInfo): void => {
      const el = cursorRef.current;
      if (el) {
        el.style.transform = `translate(${c.position.x * window.innerWidth}px, ${
          c.position.y * window.innerHeight
        }px)`;
      }
      const arrow = arrowRef.current;
      if (arrow && c.offScreen) {
        // Park the arrow at the clamped edge position, rotated toward the
        // true (off-screen) hit direction.
        arrow.style.transform =
          `translate(${c.position.x * window.innerWidth}px, ${
            c.position.y * window.innerHeight
          }px) rotate(${c.offScreenAngleRad}rad) translate(-50%, -50%)`;
      }
      // Flag changes are rare; guard to avoid redundant renders.
      setFlags((f) =>
        f.unstable === !c.stable && f.offScreen === c.offScreen
          ? f
          : { unstable: !c.stable, offScreen: c.offScreen },
      );
    };

    applyCursor(pointerStateMachine.cursor);
    return pointerStateMachine.subscribe((n) => {
      if (n.type === "cursor_move") applyCursor(n.cursor);
      else if (n.type === "state_change") setState(n.to);
    });
  }, []);

  const hidden = state === "IDLE";

  return (
    <div className="cursor-layer">
      <div
        ref={cursorRef}
        className={[
          "ray-cursor",
          `state-${state}`,
          flags.unstable ? "unstable" : "",
          hidden || flags.offScreen ? "hidden" : "",
        ].join(" ")}
      >
        {state === "FROZEN" && <span className="cursor-glyph">🔒</span>}
      </div>
      {flags.offScreen && !hidden && (
        <div ref={arrowRef} className="offscreen-arrow">
          ➤
        </div>
      )}
    </div>
  );
}
