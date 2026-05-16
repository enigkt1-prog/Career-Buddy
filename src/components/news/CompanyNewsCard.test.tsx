/**
 * RTL tests for CompanyNewsCard (F3 — company-news headline card).
 *
 * Coverage:
 *  - headline / company / source / timestamp render
 *  - summary renders when present, omitted when null
 *  - headline click opens the article + fires `company_news_card_click`
 *  - "Ask Buddy" dispatches the `open-buddy` event with a prefill
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const trackMock = vi.fn();
vi.mock("@/lib/telemetry", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

import type { CompanyNewsItem } from "@/lib/company-news";

import { CompanyNewsCard } from "./CompanyNewsCard";

function item(over: Partial<CompanyNewsItem> = {}): CompanyNewsItem {
  return {
    id: "news-1",
    company_name: "Stripe",
    headline: "Stripe raises a new funding round",
    url: "https://news.test/stripe",
    summary: "The payments company closed a large round.",
    source: "TechCrunch",
    published_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("CompanyNewsCard — render", () => {
  test("shows headline, company, source and timestamp", () => {
    render(<CompanyNewsCard item={item()} />);
    expect(
      screen.getByText("Stripe raises a new funding round"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("TechCrunch")).toBeInTheDocument();
    expect(screen.getByText("3h ago")).toBeInTheDocument();
  });

  test("renders the summary when present", () => {
    render(<CompanyNewsCard item={item()} />);
    expect(
      screen.getByText("The payments company closed a large round."),
    ).toBeInTheDocument();
  });

  test("omits the summary when null", () => {
    render(<CompanyNewsCard item={item({ summary: null })} />);
    expect(
      screen.queryByText("The payments company closed a large round."),
    ).not.toBeInTheDocument();
  });
});

describe("CompanyNewsCard — actions", () => {
  test("headline click opens the article + fires telemetry", async () => {
    const user = userEvent.setup();
    render(<CompanyNewsCard item={item()} />);
    await user.click(screen.getByText("Stripe raises a new funding round"));
    expect(window.open).toHaveBeenCalledWith(
      "https://news.test/stripe",
      "_blank",
      "noopener,noreferrer",
    );
    expect(trackMock).toHaveBeenCalledWith("company_news_card_click", {
      newsId: "news-1",
      company: "Stripe",
    });
  });

  test("'Ask Buddy' dispatches open-buddy with a company prefill", async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener("open-buddy", listener as EventListener);
    render(<CompanyNewsCard item={item()} />);
    await user.click(screen.getByRole("button", { name: /Ask Buddy/i }));
    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.prefill).toContain("Stripe");
    window.removeEventListener("open-buddy", listener as EventListener);
  });
});
