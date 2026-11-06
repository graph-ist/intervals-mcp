import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, daysAgo, getTimeZone, initTimeZone, localDate, setTimeZone, today } from "../mcp/helpers.js";

describe("date helpers", () => {
  afterEach(() => {
    setTimeZone(undefined);
    vi.useRealTimers();
  });

  it("uses the athlete time zone, not UTC, just after local midnight", () => {
    // 23:30 UTC on 4 Nov is 00:30 on 5 Nov in Rome (UTC+1)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
    setTimeZone("Europe/Rome");
    expect(today()).toBe("2026-11-05");
    expect(daysAgo(1)).toBe("2026-11-04");
    setTimeZone("UTC");
    expect(today()).toBe("2026-11-04");
  });

  it("shifts calendar dates across DST and month ends", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(localDate(new Date("2026-06-30T22:30:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("ignores invalid zones and falls back to the athlete profile", async () => {
    setTimeZone("Not/AZone");
    expect(getTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await initTimeZone("Not/AZone", async () => ({ timezone: "America/New_York" }));
    expect(getTimeZone()).toBe("America/New_York");

    await initTimeZone("Asia/Tokyo", async () => ({ timezone: "America/New_York" }));
    expect(getTimeZone()).toBe("Asia/Tokyo");

    setTimeZone(undefined);
    await initTimeZone(undefined, async () => {
      throw new Error("offline");
    });
    expect(getTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    errors.mockRestore();
  });
});
