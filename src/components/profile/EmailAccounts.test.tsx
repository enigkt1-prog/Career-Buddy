/**
 * RTL tests for EmailAccounts — minimal smoke for Phase 1.6 OAuth wire.
 *
 * Round-14 (A) note: the round-7 stub-era tests in this file asserted
 * info-modal-on-every-click behaviour against the Phase 1.5 stub
 * component. Phase 1.6 replaced the Gmail / Outlook handlers with real
 * `supabase.functions.invoke("email-oauth-start")` redirects. The IMAP
 * button still shows the legacy modal (no IMAP backend path yet).
 *
 * A re-stubbed the suite to keep CI green; B is expected to expand
 * coverage (auth-required surface, error surface, redirect assertion
 * via window.location mock) per the round-14 cross-session pattern.
 *
 * Coverage:
 *  - Empty state visible by default
 *  - 3 connect buttons (Gmail / Outlook / IMAP) rendered
 *  - Click on Connect IMAP → info modal appears + "Got it" closes it
 *  - Click on Connect Gmail → supabase.functions.invoke is called with
 *    { provider: "gmail" }
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/utils", () => ({
  cn: (...parts: Array<string | false | null | undefined>) =>
    parts.filter(Boolean).join(" "),
}));

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

import { EmailAccounts } from "./EmailAccounts";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ data: null, error: null });
});

describe("EmailAccounts — empty state", () => {
  test("shows 'No accounts connected.' headline", () => {
    render(<EmailAccounts />);
    expect(screen.getByText(/No accounts connected\./i)).toBeInTheDocument();
  });

  test("explains why connecting helps", () => {
    render(<EmailAccounts />);
    expect(
      screen.getByText(/read application\s+replies/i),
    ).toBeInTheDocument();
  });
});

describe("EmailAccounts — connect buttons", () => {
  test("renders all 3 connect buttons", () => {
    render(<EmailAccounts />);
    expect(
      screen.getByRole("button", { name: /Connect Gmail/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Connect Outlook/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Connect IMAP/i }),
    ).toBeInTheDocument();
  });

  test("Connect Gmail invokes email-oauth-start with provider=gmail", async () => {
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Gmail/i }));
    expect(invokeMock).toHaveBeenCalledWith("email-oauth-start", {
      body: { provider: "gmail" },
    });
  });

  test("Connect Outlook invokes email-oauth-start with provider=outlook", async () => {
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Outlook/i }));
    expect(invokeMock).toHaveBeenCalledWith("email-oauth-start", {
      body: { provider: "outlook" },
    });
  });
});

describe("EmailAccounts — IMAP placeholder modal", () => {
  test("Connect IMAP click opens placeholder modal", async () => {
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect IMAP/i }));
    expect(
      screen.getByRole("heading", { name: /IMAP support/i }),
    ).toBeInTheDocument();
  });

  test("'Got it' button closes IMAP modal", async () => {
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect IMAP/i }));
    expect(
      screen.getByRole("heading", { name: /IMAP support/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Got it/i }));
    expect(
      screen.queryByRole("heading", { name: /IMAP support/i }),
    ).not.toBeInTheDocument();
  });
});
