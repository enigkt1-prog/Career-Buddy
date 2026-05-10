import { describe, expect, test } from "vitest";

describe("vitest rig", () => {
  test("1 === 1", () => {
    expect(1).toBe(1);
  });

  test("dom available via jsdom", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    expect(el.textContent).toBe("hello");
  });

  test("localStorage stub is fresh per test", () => {
    expect(localStorage.length).toBe(0);
    localStorage.setItem("foo", "bar");
    expect(localStorage.getItem("foo")).toBe("bar");
  });
});
