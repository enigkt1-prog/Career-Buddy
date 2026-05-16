/**
 * RTL tests for CvInsights (F2).
 *
 * Coverage:
 *  - three tabs render; Strengths is the default tab
 *  - switching tab swaps the card list + fires insights_tab_switch
 *  - a card click dispatches `open-buddy` + insights_card_click
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));

import { track } from "@/lib/telemetry";
import type { CvRadar as CvRadarData } from "@/lib/cv-storage";

import { CvInsights } from "./CvInsights";

function radar(): CvRadarData {
  return {
    axes: [],
    strengths: ["Strong B2B closing record", "Owned a 6-figure pipeline"],
    weaknesses: ["Thin people-management evidence"],
    gaps: ["Run a cross-functional launch", "Own a quarterly forecast"],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CvInsights", () => {
  test("renders three tabs with Strengths active by default", () => {
    render(<CvInsights radar={radar()} />);
    expect(screen.getByRole("tab", { name: /Strengths/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Weaknesses/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Gaps/ })).toBeInTheDocument();
    expect(screen.getByText("Strong B2B closing record")).toBeInTheDocument();
  });

  test("switching to Weaknesses swaps the list + fires telemetry", () => {
    render(<CvInsights radar={radar()} />);
    fireEvent.click(screen.getByRole("tab", { name: /Weaknesses/ }));

    expect(track).toHaveBeenCalledWith("insights_tab_switch", {
      tab: "weaknesses",
    });
    expect(screen.getByText("Thin people-management evidence")).toBeInTheDocument();
    expect(
      screen.queryByText("Strong B2B closing record"),
    ).not.toBeInTheDocument();
  });

  test("card click dispatches open-buddy + insights_card_click", () => {
    const handler = vi.fn();
    window.addEventListener("open-buddy", handler as EventListener);
    render(<CvInsights radar={radar()} />);

    fireEvent.click(screen.getByText("Owned a 6-figure pipeline"));

    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0][0] as CustomEvent;
    expect(evt.detail.prefill).toContain("Owned a 6-figure pipeline");
    expect(track).toHaveBeenCalledWith("insights_card_click", {
      tab: "strengths",
      index: 1,
    });

    window.removeEventListener("open-buddy", handler as EventListener);
  });
});
