/**
 * Interactive HUD widgets — the deliberately-chunky demos that exercise the
 * full input pipeline: a big toggle (activate), a slider (drag along one
 * axis), a draggable card (free drag), and a page switcher (activate + mode).
 *
 * Pattern shared by all of them:
 *   const { ref, status } = useInteractive({ id, ...callbacks });
 *   <div ref={ref} className={cls("interactive", status)} ...>
 * plus a dwell ring when status.dwellProgress > 0. The widgets never talk to
 * the tracking pipeline — only to the state machine via the hook.
 */

import { useRef, useState } from "react";
import { useInteractive, type InteractiveStatus } from "../../hooks/useInteractive";
import type { Vec2 } from "../../types/geometry";

function cls(status: InteractiveStatus): string {
  return ["interactive", status.hovered ? "hovered" : "", status.armed ? "armed" : ""].join(" ");
}

/** Radial dwell countdown — visible so an auto-commit never surprises. */
function DwellRing({ progress }: { progress: number }) {
  if (progress <= 0) return null;
  const r = 9;
  const circumference = 2 * Math.PI * r;
  return (
    <svg className="dwell-ring" viewBox="0 0 24 24">
      <circle className="track" cx="12" cy="12" r={r} />
      <circle
        cx="12"
        cy="12"
        r={r}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function BigToggle() {
  const [on, setOn] = useState(false);
  const { ref, status } = useInteractive({
    id: "big-toggle",
    onActivate: () => setOn((v) => !v),
  });
  return (
    <div ref={ref} className={cls(status)} style={{ flex: 1 }}>
      <DwellRing progress={status.dwellProgress} />
      <div className={`toggle-state ${on ? "on" : "off"}`}>{on ? "ON" : "OFF"}</div>
      <div className="dim">Main toggle</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Slider: a draggable — commit_begin grabs it, drag_move maps cursor-x
 * across the slider's own width to a 0..100 value, commit_end releases.
 * Snap is automatically disabled during the drag (state machine drives the
 * filter pipeline's draggingActive flag).
 */
export function HudSlider() {
  const [value, setValue] = useState(40);
  const valueAtGrab = useRef(40);

  const applyDrag = (p: Vec2): void => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = (p.x * window.innerWidth - r.left) / r.width;
    setValue(Math.round(Math.min(1, Math.max(0, frac)) * 100));
  };

  const { ref, status } = useInteractive({
    id: "hud-slider",
    draggable: true,
    dwellEnabled: false, // parking the cursor on a slider shouldn't grab it
    onDragStart: (p) => {
      valueAtGrab.current = value;
      applyDrag(p);
    },
    onDragMove: applyDrag,
    onDragEnd: applyDrag,
    // Cancel = fist / Escape / tracking loss: revert, don't half-apply.
    onDragCancel: () => setValue(valueAtGrab.current),
  });

  return (
    <div ref={ref} className={cls(status)} style={{ flex: 1 }}>
      <div className="dim">Volume · {value}</div>
      <div className="hud-slider-track">
        <div className="hud-slider-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Free-draggable card. Position is stored in normalized units (of course),
 * moved by the delta between drag events so the card doesn't jump to center
 * itself under the cursor on grab.
 */
export function DraggableCard() {
  const [pos, setPos] = useState<Vec2>({ x: 0.42, y: 0.62 });
  const grabState = useRef<{ posAtGrab: Vec2; cursorAtGrab: Vec2 } | null>(null);

  const { ref, status } = useInteractive({
    id: "draggable-card",
    draggable: true,
    dwellEnabled: false,
    onDragStart: (p) => {
      grabState.current = { posAtGrab: pos, cursorAtGrab: p };
    },
    onDragMove: (p) => {
      const g = grabState.current;
      if (!g) return;
      setPos({
        x: g.posAtGrab.x + (p.x - g.cursorAtGrab.x),
        y: g.posAtGrab.y + (p.y - g.cursorAtGrab.y),
      });
    },
    onDragEnd: () => {
      grabState.current = null;
    },
    onDragCancel: () => {
      if (grabState.current) setPos(grabState.current.posAtGrab);
      grabState.current = null;
    },
  });

  return (
    <div
      ref={ref}
      className={cls(status)}
      style={{
        position: "fixed",
        left: `${pos.x * 100}vw`,
        top: `${pos.y * 100}vh`,
        width: "12vw",
        minWidth: 120,
        height: "10vh",
        minHeight: 90,
        zIndex: 10,
      }}
    >
      <div>🗂️</div>
      <div className="dim">Drag me</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PageSwitcher({
  page,
  pageCount,
  onSwitch,
}: {
  page: number;
  pageCount: number;
  onSwitch: (p: number) => void;
}) {
  const { ref, status } = useInteractive({
    id: "page-switcher",
    onActivate: () => onSwitch((page + 1) % pageCount),
  });
  return (
    <div ref={ref} className={cls(status)} style={{ minWidth: "12em" }}>
      <DwellRing progress={status.dwellProgress} />
      <div className="page-dots">
        {Array.from({ length: pageCount }, (_, i) => (
          <span key={i} style={{ opacity: i === page ? 1 : 0.3 }}>
            ●
          </span>
        ))}
      </div>
      <div className="dim">Page {page + 1}</div>
    </div>
  );
}
