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
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  // Default: Outlook flag enabled so the bulk of round-14 coverage
  // (which clicks the Outlook button) keeps working. The dedicated
  // visibility-gate describe-block clears the flag explicitly.
  vi.stubEnv("VITE_OUTLOOK_OAUTH_ENABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

describe("EmailAccounts — Outlook visibility gate", () => {
  test("Outlook button hidden when VITE_OUTLOOK_OAUTH_ENABLED is unset", () => {
    vi.stubEnv("VITE_OUTLOOK_OAUTH_ENABLED", "");
    render(<EmailAccounts />);
    expect(
      screen.queryByRole("button", { name: /Connect Outlook/i }),
    ).not.toBeInTheDocument();
    // Gmail + IMAP still rendered
    expect(
      screen.getByRole("button", { name: /Connect Gmail/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Connect IMAP/i }),
    ).toBeInTheDocument();
  });

  test("Outlook button visible when VITE_OUTLOOK_OAUTH_ENABLED='1'", () => {
    vi.stubEnv("VITE_OUTLOOK_OAUTH_ENABLED", "1");
    render(<EmailAccounts />);
    expect(
      screen.getByRole("button", { name: /Connect Outlook/i }),
    ).toBeInTheDocument();
  });

  test("Outlook button visible when VITE_OUTLOOK_OAUTH_ENABLED='true'", () => {
    vi.stubEnv("VITE_OUTLOOK_OAUTH_ENABLED", "true");
    render(<EmailAccounts />);
    expect(
      screen.getByRole("button", { name: /Connect Outlook/i }),
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

// ---------------------------------------------------------------------------
// Round-14 B expansion — auth-required + redirect + error surfaces
// ---------------------------------------------------------------------------

describe("EmailAccounts — auth-required surface", () => {
  test("401 status → renders 'sign in before connecting' prompt with /login link", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Unauthorized", context: { status: 401 } },
    });
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Gmail/i }));
    expect(
      screen.getByText(/signed in before connecting/i),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Sign in/i });
    expect(link).toHaveAttribute("href", "/login");
  });

  test("'sign in required' message body (no status) → auth-required surface", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "sign in required for OAuth connect" },
    });
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Gmail/i }));
    expect(
      screen.getByText(/signed in before connecting/i),
    ).toBeInTheDocument();
  });
});

describe("EmailAccounts — error surfaces", () => {
  test("generic edge function error → red error pill", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "internal server error", context: { status: 500 } },
    });
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Outlook/i }));
    expect(
      screen.getByText(/Outlook couldn't start: internal server error/i),
    ).toBeInTheDocument();
  });

  test("missing authoriseUrl in success body → error pill", async () => {
    invokeMock.mockResolvedValueOnce({ data: { other: "junk" }, error: null });
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Gmail/i }));
    expect(
      screen.getByText(/Gmail couldn't start: Edge function returned no authorise URL/i),
    ).toBeInTheDocument();
  });

  test("invoke throws → error pill with thrown message", async () => {
    invokeMock.mockRejectedValueOnce(new Error("network blip"));
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Gmail/i }));
    expect(
      screen.getByText(/Gmail couldn't start: network blip/i),
    ).toBeInTheDocument();
  });
});

describe("EmailAccounts — redirect on happy path", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    delete (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: { href: string } }).location = {
      href: "/profile",
    };
  });

  // restore after each test in this describe
  afterEach(() => {
    (window as unknown as { location: Location }).location = originalLocation;
  });

  test("authoriseUrl returned → window.location.href is set", async () => {
    const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x";
    invokeMock.mockResolvedValueOnce({
      data: { authoriseUrl: url },
      error: null,
    });
    const user = userEvent.setup();
    render(<EmailAccounts />);
    await user.click(screen.getByRole("button", { name: /Connect Gmail/i }));
    expect((window.location as unknown as { href: string }).href).toBe(url);
  });
});
