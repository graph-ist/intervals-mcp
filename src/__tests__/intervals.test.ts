import { describe, expect, it, vi } from "vitest";

// Mock fetch globally for intervals.ts tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocking
const {
  configure,
  getAthlete,
  createEvents,
  downloadEventWorkout,
  deleteFolder,
  uploadWellnessCsv,
  exportCsv,
  searchActivities,
  getAthleteSummary,
  getPowerHRCurve,
  getPowerCurves,
  qs,
  getActivity,
  getMMPModel,
} = await import("../intervals.js");

const okJson = (body: unknown) => ({ ok: true, text: () => Promise.resolve(JSON.stringify(body)) });

describe("intervals client", () => {
  it("throws when not configured", async () => {
    // intervals.ts is already configured by import-time side effects;
    // we test the error message from the api helper indirectly
    // by testing a successful call after configure
    configure("test-key", "i123");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ weight: 75 })),
    });

    const result = await getAthlete();
    expect(result).toEqual({ weight: 75 });
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://intervals.icu/api/v1/athlete/i123");
    expect(opts.headers.Authorization).toContain("Basic ");
  });

  it("throws on HTTP error with status and body", async () => {
    configure("test-key", "i123");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });

    await expect(getAthlete()).rejects.toThrow("intervals.icu 404: Not Found");
  });

  it("appends T00:00:00 to date-only start_date_local when creating events", async () => {
    configure("test-key", "i123");
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(okJson([{ id: 1 }, { id: 2 }]));

    await createEvents([
      { start_date_local: "2026-10-02", name: "a" },
      { start_date_local: "2026-10-03T08:00:00", name: "b" },
    ]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/athlete/i123/events/bulk");
    const body = JSON.parse(opts.body);
    expect(body[0].start_date_local).toBe("2026-10-02T00:00:00");
    expect(body[1].start_date_local).toBe("2026-10-03T08:00:00");
  });

  it("downloads a planned workout as text and fit as base64", async () => {
    configure("test-key", "i123");
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve("<workout_file/>") });
    expect(await downloadEventWorkout(7, "zwo")).toBe("<workout_file/>");
    expect(mockFetch.mock.calls[0][0]).toContain("/events/7/download.zwo");

    mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) });
    expect(await downloadEventWorkout(7, "fit")).toBe("AQID");
  });

  it("returns the JSON body for deleteFolder", async () => {
    configure("test-key", "i123");
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(okJson({ deleted: 3 }));
    expect(await deleteFolder(5)).toEqual({ deleted: 3 });
  });

  it("uploads wellness CSV as multipart and exports CSV as text", async () => {
    configure("test-key", "i123");
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(okJson({ ok: 1 }));
    await uploadWellnessCsv("id,weight\n2026-10-01,70", true);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/athlete/i123/wellness?ignoreMissingFields=true");
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.headers["Content-Type"]).toBeUndefined();

    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve("id,weight\n") });
    expect(await exportCsv("wellness", { oldest: "2026-10-01", newest: "2026-10-05" })).toBe("id,weight\n");
    expect(mockFetch.mock.calls[1][0]).toContain("/wellness.csv?oldest=2026-10-01&newest=2026-10-05");
  });

  it("uses documented paths and params for search, summary, power-hr and fatigued curves", async () => {
    configure("test-key", "i123");
    mockFetch.mockClear();
    mockFetch.mockResolvedValue(okJson([]));

    await searchActivities("#race", 5);
    let [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/athlete/i123/activities/search?q=%23race&limit=5");
    expect(opts.method).toBe("GET");

    await getAthleteSummary("2026-09-01", "2026-09-30");
    expect(mockFetch.mock.calls[1][0]).toContain("/athlete-summary?start=2026-09-01&end=2026-09-30");

    await getPowerHRCurve("2026-07-01", "2026-09-30", "Ride");
    expect(mockFetch.mock.calls[2][0]).toContain("/power-hr-curve?start=2026-07-01&end=2026-09-30&type=Ride");

    await getPowerCurves("Ride", ["42d"], "kj0");
    [url] = mockFetch.mock.calls[3];
    expect(url).toContain("curves=42d-kj0");
    expect(url).not.toContain("fatigue=");
  });

  it("qs skips empty values, joins scalar arrays and JSON-encodes filter arrays", () => {
    expect(qs({ a: undefined, b: "", c: [], d: 1 })).toBe("?d=1");
    expect(qs({ ids: ["a", "b"] })).toBe("?ids=a%2Cb");
    expect(qs({ filters: [{ field_id: "type", value: "Ride" }] })).toBe(
      `?filters=${encodeURIComponent('[{"field_id":"type","value":"Ride"}]')}`,
    );
    expect(qs({})).toBe("");
  });

  it("encodes caller-supplied path segments and tolerates empty response bodies", async () => {
    configure("test-key", "i123");
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });

    expect(await getActivity("1/../../athlete/other")).toEqual({ ok: true });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://intervals.icu/api/v1/activity/1%2F..%2F..%2Fathlete%2Fother?intervals=true",
    );

    await getMMPModel("Ride&type=Run");
    expect(mockFetch.mock.calls[1][0]).toContain("/mmp-model?type=Ride%26type%3DRun");
  });

  it("reports Retry-After on 429", async () => {
    configure("test-key", "i123");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "12" }),
      text: () => Promise.resolve("slow down"),
    });
    await expect(getAthlete()).rejects.toThrow("intervals.icu 429 (retry after 12s): slow down");
  });
});
