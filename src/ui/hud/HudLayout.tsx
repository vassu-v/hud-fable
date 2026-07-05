/**
 * The HUD's page layouts — mission-control style, three pages cycled by the
 * page switcher, the open-palm hold gesture, or keys 1–3.
 *
 * Grid: left column (vitals) / center (main content) / right column (system).
 * The draggable card floats above the grid on page 0.
 */

import {
  ClockCard,
  FpsCard,
  LogFeedCard,
  NextEventCard,
  TaskListCard,
  WeatherCard,
} from "./ambientWidgets";
import { BigToggle, DraggableCard, HudSlider, PageSwitcher } from "./interactiveWidgets";
import type { PipelineStats } from "../../pipeline/trackingPipeline";

export const HUD_PAGE_COUNT = 3;

export function HudLayout({
  page,
  onSwitchPage,
  stats,
}: {
  page: number;
  onSwitchPage: (p: number) => void;
  stats: PipelineStats;
}) {
  return (
    <div className="hud-root">
      {/* Row 1: header vitals — always visible on every page. */}
      <ClockCard />
      <div style={{ display: "flex", gap: "1.2vw" }}>
        <div style={{ flex: 1 }}>
          <WeatherCard />
        </div>
        <div style={{ flex: 1 }}>
          <NextEventCard />
        </div>
      </div>
      <FpsCard stats={stats} />

      {/* Row 2: page-specific center content. */}
      {page === 0 && (
        <>
          <TaskListCard />
          <div style={{ display: "flex", gap: "1.2vw", alignItems: "stretch" }}>
            <BigToggle />
            <HudSlider />
          </div>
          <LogFeedCard />
          <DraggableCard />
        </>
      )}
      {page === 1 && (
        <>
          <LogFeedCard />
          <TaskListCard />
          <div style={{ display: "flex", gap: "1.2vw", alignItems: "stretch" }}>
            <BigToggle />
          </div>
        </>
      )}
      {page === 2 && (
        <>
          <div className="card ambient">
            <h3>About</h3>
            <div className="dim">
              hud-fable — ray-pointing HUD. Right hand aims, left hand clicks. Pinch to commit,
              fist to cancel, hold an open palm to switch pages.
            </div>
          </div>
          <div style={{ display: "flex", gap: "1.2vw", alignItems: "stretch" }}>
            <HudSlider />
          </div>
          <LogFeedCard />
        </>
      )}

      {/* Row 3: footer — page switcher centered. */}
      <div />
      <div style={{ display: "flex", justifyContent: "center" }}>
        <PageSwitcher page={page} pageCount={HUD_PAGE_COUNT} onSwitch={onSwitchPage} />
      </div>
      <div />
    </div>
  );
}
