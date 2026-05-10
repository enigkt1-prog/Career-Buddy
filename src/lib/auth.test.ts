import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocked Supabase auth client
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();
const mockSignInWithOtp = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockSignOut = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockUnsubscribe = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
      signInWithOtp: (args: unknown) => mockSignInWithOtp(args),
      signInWithOAuth: (args: unknown) => mockSignInWithOAuth(args),
      signOut: () => mockSignOut(),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) =>
        mockOnAuthStateChange(cb),
    },
  },
}));

import {
  getCurrentUserId,
  onAuthChange,
  signInWithEmail,
  signInWithGoogle,
  signOut,
} from "./auth";

beforeEach(() => {
  mockGetUser.mockReset();
  mockSignInWithOtp.mockReset().mockResolvedValue({ data: null, error: null });
  mockSignInWithOAuth.mockReset().mockResolvedValue({ data: null, error: null });
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  mockUnsubscribe.mockReset();
  mockOnAuthStateChange.mockReset().mockReturnValue({
    data: { subscription: { unsubscribe: mockUnsubscribe } },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getCurrentUserId
// ---------------------------------------------------------------------------

describe("getCurrentUserId", () => {
  test("returns user.id when session is live", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: "abc-123" } },
      error: null,
    });
    expect(await getCurrentUserId()).toBe("abc-123");
  });

  test("returns null when no user (anonymous)", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await getCurrentUserId()).toBeNull();
  });

  test("returns null on SDK error", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: null,
      error: { message: "expired" },
    });
    expect(await getCurrentUserId()).toBeNull();
  });

  test("returns null when SDK throws", async () => {
    mockGetUser.mockRejectedValueOnce(new Error("network"));
    expect(await getCurrentUserId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// signInWithEmail
// ---------------------------------------------------------------------------

describe("signInWithEmail", () => {
  test("trims + forwards email to signInWithOtp", async () => {
    await signInWithEmail("  alex@example.com  ");
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alex@example.com" }),
    );
  });

  test("throws on empty / whitespace email (no SDK call)", async () => {
    await expect(signInWithEmail("")).rejects.toThrow(/Email required/);
    await expect(signInWithEmail("   ")).rejects.toThrow(/Email required/);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  test("re-throws SDK error so the caller surfaces it", async () => {
    mockSignInWithOtp.mockResolvedValueOnce({
      data: null,
      error: new Error("rate limit"),
    });
    await expect(signInWithEmail("a@b.c")).rejects.toThrow(/rate limit/);
  });

  test("uses window.origin for emailRedirectTo when available", async () => {
    await signInWithEmail("a@b.c");
    const call = mockSignInWithOtp.mock.calls[0][0];
    expect(call.options.emailRedirectTo).toMatch(/^http/);
  });
});

// ---------------------------------------------------------------------------
// signInWithGoogle
// ---------------------------------------------------------------------------

describe("signInWithGoogle", () => {
  test("calls signInWithOAuth with provider=google", async () => {
    await signInWithGoogle();
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });

  test("re-throws SDK error", async () => {
    mockSignInWithOAuth.mockResolvedValueOnce({
      data: null,
      error: new Error("provider misconfigured"),
    });
    await expect(signInWithGoogle()).rejects.toThrow(/misconfigured/);
  });
});

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

describe("signOut", () => {
  test("invokes supabase.auth.signOut", async () => {
    await signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test("swallows SDK errors (does NOT throw)", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("network"));
    await expect(signOut()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// onAuthChange
// ---------------------------------------------------------------------------

describe("onAuthChange", () => {
  test("forwards user_id from session to the callback", () => {
    const cb = vi.fn();
    onAuthChange(cb);
    const innerCb = mockOnAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: unknown,
    ) => void;
    innerCb("SIGNED_IN", { user: { id: "u1" } });
    expect(cb).toHaveBeenCalledWith("u1");
  });

  test("forwards null on sign-out (no session)", () => {
    const cb = vi.fn();
    onAuthChange(cb);
    const innerCb = mockOnAuthStateChange.mock.calls[0][0] as (
      event: string,
      session: unknown,
    ) => void;
    innerCb("SIGNED_OUT", null);
    expect(cb).toHaveBeenCalledWith(null);
  });

  test("returns an unsubscribe function that calls subscription.unsubscribe", () => {
    const unsub = onAuthChange(vi.fn());
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    unsub();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
