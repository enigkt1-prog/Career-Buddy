/**
 * RTL tests for CvRadar (F2).
 *
 * Coverage:
 *  - all six axis labels render
 *  - radar_view telemetry fires on mount
 *  - an axis-label click dispatches `open-buddy` + radar_axis_click
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));

import { track } from "@/lib/telemetry";
import type { CvRadar as CvRadarData } from "@/lib/cv-storage";

import { CvRadar } from "./CvRadar";

const AXES = [
  "Commercial acumen",
  "Leadership",
  "Domain expertise",
  "Communication",
  "Execution",
  "Growth trajectory",
];

function radar(): CvRadarData {
  return {
    axes: AXES.map((name, i) => ({ name, score: 40 + i * 8 })),
    strengths: ["Closed enterprise deals"],
    weaknesses: ["No P&L ownership"],
    gaps: ["Lead a launch"],
    snapshot_id: "snap-1",
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CvRadar", () => {
  test("renders all six axis labels", () => {
    render(<CvRadar radar={radar()} />);
    for (const name of AXES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  test("fires radar_view telemetry on mount", () => {
    render(<CvRadar radar={radar()} />);
    expect(track).toHaveBeenCalledWith("radar_view");
  });

  test("axis-label click dispatches open-buddy + radar_axis_click", () => {
    const handler = vi.fn();
    window.addEventListener("open-buddy", handler as EventListener);
    render(<CvRadar radar={radar()} />);

    fireEvent.click(screen.getByText("Leadership"));

    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0][0] as CustomEvent;
    expect(evt.detail.prefill).toContain("Leadership");
    expect(track).toHaveBeenCalledWith("radar_axis_click", {
      axis: "Leadership",
      score: 48,
    });

    window.removeEventListener("open-buddy", handler as EventListener);
  });
});
