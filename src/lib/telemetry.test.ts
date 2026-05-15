/**
 * Tests for the telemetry helper (F0).
 *
 * Acceptance per WORKPLAN:
 *  - `track(name)` while anon → row with `user_id IS NULL`
 *  - `track(name)` while signed-in → row with `user_id = auth.uid()`
 *  - Mid-session sign-in transition: prior anon rows stay NULL; new
 *    rows post-sign-in carry user_id. No row-linking attempted v1.
 *  - Insert/RLS failures are swallowed; track() never throws.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const insertMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
    },
    from: (table: string) => ({
      insert: (row: unknown) => insertMock(table, row),
    }),
  },
}));

import { track } from "./telemetry";

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ error: null });
  getSessionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("track — anonymous session", () => {
  test("writes row with user_id NULL", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });
    await track("feed_view");
    expect(insertMock).toHaveBeenCalledWith(
      "analytics_events",
      expect.objectContaining({ user_id: null, event_name: "feed_view" }),
    );
  });

  test("payload defaults to null when omitted", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });
    await track("feed_view");
    expect(insertMock).toHaveBeenCalledWith(
      "analytics_events",
      expect.objectContaining({ payload: null }),
    );
  });
});

describe("track — signed-in session", () => {
  test("writes row with user_id = current session uid", async () => {
    getSessionMock.mockResolvedValueOnce({
      data: { session: { user: { id: "user-123" } } },
    });
    await track("feed_card_click", { jobId: "abc" });
    expect(insertMock).toHaveBeenCalledWith(
      "analytics_events",
      expect.objectContaining({
        user_id: "user-123",
        event_name: "feed_card_click",
        payload: { jobId: "abc" },
      }),
    );
  });

  test("anon-then-signed-in transition: separate rows carry their own user_id", async () => {
    getSessionMock
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValueOnce({
        data: { session: { user: { id: "user-9" } } },
      });

    await track("event_a");
    await track("event_b");

    expect(insertMock).toHaveBeenNthCalledWith(
      1,
      "analytics_events",
      expect.objectContaining({ user_id: null, event_name: "event_a" }),
    );
    expect(insertMock).toHaveBeenNthCalledWith(
      2,
      "analytics_events",
      expect.objectContaining({ user_id: "user-9", event_name: "event_b" }),
    );
  });
});

describe("track — failure modes", () => {
  test("supabase insert error is swallowed; track resolves", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });
    insertMock.mockResolvedValueOnce({ error: { message: "rls denied" } });
    await expect(track("rls_test")).resolves.toBeUndefined();
  });

  test("getSession throws → track still resolves and inserts user_id null", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("auth down"));
    await track("auth_down");
    expect(insertMock).toHaveBeenCalledWith(
      "analytics_events",
      expect.objectContaining({ user_id: null, event_name: "auth_down" }),
    );
  });

  test("insert throws synchronously → track does not reject", async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });
    insertMock.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    await expect(track("net_down")).resolves.toBeUndefined();
  });
});
