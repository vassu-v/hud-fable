/**
 * Ambient (non-interactive) HUD widgets — the dense information layer.
 * None of these register with the element registry; the ray passes straight
 * through them.
 */

import { useEffect, useRef, useState } from "react";
import { MOCK_LOG_SEED, MOCK_NEXT_EVENT, MOCK_TASKS, MOCK_WEATHER } from "../../data/mockData";
import type { PipelineStats } from "../../pipeline/trackingPipeline";

export function ClockCard() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="card ambient">
      <h3>Time</h3>
      <div className="big-number">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="dim">
        {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

export function WeatherCard() {
  const w = MOCK_WEATHER;
  return (
    <div className="card ambient">
      <h3>Weather</h3>
      <div className="big-number">
        {w.icon} {w.tempC}°
      </div>
      <div className="dim">
        {w.condition} · H {w.high}° L {w.low}°
      </div>
    </div>
  );
}

export function NextEventCard() {
  // Anchor the mock event against mount time so the countdown actually counts.
  const [remainingMin, setRemainingMin] = useState(MOCK_NEXT_EVENT.minutesFromNow);
  useEffect(() => {
    const target = Date.now() + MOCK_NEXT_EVENT.minutesFromNow * 60_000;
    const id = setInterval(
      () => setRemainingMin(Math.max(0, Math.round((target - Date.now()) / 60_000))),
      15_000,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="card ambient">
      <h3>Next event</h3>
      <div className="big-number">{remainingMin}m</div>
      <div className="dim">{MOCK_NEXT_EVENT.title}</div>
    </div>
  );
}

export function TaskListCard() {
  const color = { "on-track": "var(--good)", "at-risk": "var(--warn)", done: "var(--text-dim)" };
  return (
    <div className="card ambient">
      <h3>Project status</h3>
      {MOCK_TASKS.map((t) => (
        <div className="task-card" key={t.id}>
          <span>{t.title}</span>
          <span className="status-pill" style={{ color: color[t.status] }}>
            {t.status}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Tracking-pipeline vitals — a fun widget that is also genuinely useful:
 * tracking FPS is the single best early-warning signal for laggy pointing.
 * Reads the stats object by polling (it's mutated in place by the pipeline).
 */
export function FpsCard({ stats }: { stats: PipelineStats }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const fpsColor = stats.fps >= 20 ? "var(--good)" : stats.fps >= 12 ? "var(--warn)" : "var(--bad)";
  return (
    <div className="card ambient">
      <h3>Pipeline</h3>
      <div className="big-number" style={{ color: fpsColor }}>
        {stats.fps} <span style={{ fontSize: "0.4em" }}>fps</span>
      </div>
      <div className="dim">
        pointer {stats.pointerTracked ? "●" : "○"} · gesture {stats.gestureTracked ? "●" : "○"}
        {stats.handToCameraCm > 0 && ` · ${Math.round(stats.handToCameraCm)}cm`}
      </div>
    </div>
  );
}

/** Scrolling activity feed. Appends synthetic entries so the HUD feels alive. */
export function LogFeedCard() {
  const [lines, setLines] = useState<string[]>(MOCK_LOG_SEED);
  const counter = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      counter.current++;
      setLines((prev) =>
        [...prev, `heartbeat: cycle ${counter.current} nominal`].slice(-8),
      );
    }, 7000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="card ambient">
      <h3>Activity</h3>
      <div className="log-feed">
        {lines.map((l, i) => (
          <div className="entry" key={i}>
            <span className="time">{String(i).padStart(2, "0")}</span>
            <span>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
