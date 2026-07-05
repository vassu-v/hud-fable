/**
 * Mock content for the HUD (v1 is mock-first by design — the input system
 * is the product; real integrations come later behind the same shapes).
 */

export interface Task {
  id: string;
  title: string;
  status: "on-track" | "at-risk" | "done";
}

export const MOCK_TASKS: Task[] = [
  { id: "t1", title: "Calibration module", status: "done" },
  { id: "t2", title: "Ray solver + filtering", status: "on-track" },
  { id: "t3", title: "Gesture engine", status: "on-track" },
  { id: "t4", title: "Projector migration", status: "at-risk" },
];

export interface WeatherNow {
  tempC: number;
  condition: string;
  icon: string;
  high: number;
  low: number;
}

export const MOCK_WEATHER: WeatherNow = {
  tempC: 24,
  condition: "Partly cloudy",
  icon: "⛅",
  high: 29,
  low: 19,
};

export interface UpcomingEvent {
  title: string;
  /** Minutes from "now" — recomputed against wall clock in the widget. */
  minutesFromNow: number;
}

export const MOCK_NEXT_EVENT: UpcomingEvent = {
  title: "Standup",
  minutesFromNow: 47,
};

/** Seed lines for the scrolling activity feed; the widget appends more. */
export const MOCK_LOG_SEED = [
  "system: tracking pipeline initialized",
  "calibration: profile 'default' loaded",
  "hud: 3 pages registered",
  "gesture: vocabulary pinch/fist/palm armed",
];
