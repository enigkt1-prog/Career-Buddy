/**
 * RTL tests for AuthPill — signed-in vs anonymous render + signOut.
 *
 * Owned by A; tests by B per the cross-session pattern.
 *
 * Coverage:
 *  - Anonymous (INITIAL_SESSION null) → "Sign in" link to /login
 *  - Signed-in (INITIAL_SESSION with user) → email shown + LogOut icon
 *  - LogOut click → calls signOut + sets window.location to "/"
 *  - SIGNED_OUT event → flips back to anonymous
 *  - SIGNED_IN event after anonymous mount → flips to signed-in
 *  - User with no email → "Signed in" fallback label
 *
 * Stale-session fix (round-16 A): AuthPill now subscribes to
 * `supabase.auth.onAuthStateChange` directly. INITIAL_SESSION fires
 * with the cached session on mount, so we no longer race the HTTP
 * getUser() call against detectSessionInUrl.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Listener = (event: string, session: unknown) => void;

const mockUnsubscribe = vi.fn();
let capturedListener: Listener | null = null;

const mockOnAuthStateChange = vi.fn((cb: Listener) => {
  capturedListener = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: Listener) => mockOnAuthStateChange(cb),
    },
  },
}));

const mockSignOut = vi.fn();
vi.mock("@/lib/auth", () => ({
  signOut: () => mockSignOut(),
}));

import { AuthPill } from "./AuthPill";

const originalLocation = window.location;

function fireAuthEvent(event: string, session: unknown) {
  if (!capturedListener) throw new Error("listener not captured");
  act(() => {
    capturedListener!(event, session);
  });
}

beforeEach(() => {
  mockOnAuthStateChange.mockClear();
  mockUnsubscribe.mockReset();
  mockSignOut.mockReset().mockResolvedValue(undefined);
  capturedListener = null;
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: { href: string } }).location = { href: "/" };
});

afterEach(() => {
  (window as unknown as { location: Location }).location = originalLocation;
  vi.clearAllMocks();
});

describe("AuthPill — anonymous", () => {
  test("renders Sign in link to /login when INITIAL_SESSION null", () => {
    render(<AuthPill />);
    fireAuthEvent("INITIAL_SESSION", null);
    const link = screen.getByRole("link", { name: /Sign in/i });
    expect(link).toHaveAttribute("href", "/login");
  });

  test("renders Sign in link before any auth event fires", () => {
    render(<AuthPill />);
    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});

describe("AuthPill — signed-in", () => {
  test("renders email + logout when INITIAL_SESSION has user", () => {
    render(<AuthPill />);
    fireAuthEvent("INITIAL_SESSION", {
      user: { id: "u-abc", email: "alex@example.com" },
    });
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute(
      "title",
      expect.stringContaining("alex@example.com"),
    );
  });

  test("user with null email falls back to 'Signed in' label", () => {
    render(<AuthPill />);
    fireAuthEvent("INITIAL_SESSION", {
      user: { id: "u-no-email", email: null },
    });
    expect(screen.getByText(/Signed in/i)).toBeInTheDocument();
  });

  test("logout button click → signOut + window.location='/'", async () => {
    const user = userEvent.setup();
    render(<AuthPill />);
    fireAuthEvent("INITIAL_SESSION", {
      user: { id: "u-abc", email: "alex@example.com" },
    });
    await user.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
    expect((window.location as unknown as { href: string }).href).toBe("/");
  });
});

describe("AuthPill — auth-state transitions", () => {
  test("SIGNED_OUT event flips signed-in pill back to anonymous", () => {
    render(<AuthPill />);
    fireAuthEvent("INITIAL_SESSION", {
      user: { id: "u-abc", email: "alex@example.com" },
    });
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    fireAuthEvent("SIGNED_OUT", null);
    expect(screen.getByRole("link", { name: /Sign in/i })).toBeInTheDocument();
  });

  test("SIGNED_IN event after anonymous mount flips to signed-in", () => {
    render(<AuthPill />);
    fireAuthEvent("INITIAL_SESSION", null);
    expect(screen.getByRole("link", { name: /Sign in/i })).toBeInTheDocument();
    fireAuthEvent("SIGNED_IN", {
      user: { id: "u-late", email: "late@example.com" },
    });
    expect(screen.getByText("late@example.com")).toBeInTheDocument();
  });
});
