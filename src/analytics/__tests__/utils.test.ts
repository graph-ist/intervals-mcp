import { describe, expect, it } from "vitest";
import { extractStream, getStream, matchesSport } from "../utils.js";

describe("extractStream", () => {
  it("returns empty array for undefined", () => {
    expect(extractStream(undefined)).toEqual([]);
  });

  it("returns the array directly when given a raw array", () => {
    expect(extractStream([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("unwraps {data} wrapper", () => {
    expect(extractStream({ data: [4, 5, 6] })).toEqual([4, 5, 6]);
  });

  it("returns empty array for {data} wrapper with missing data", () => {
    expect(extractStream({} as { data: number[] })).toEqual([]);
  });
});

describe("getStream", () => {
  it("finds a stream by type in the API array shape", () => {
    const streams = [
      { type: "time", data: [0, 1] },
      { type: "watts", data: [100, 110] },
    ];
    expect(getStream(streams, "watts")).toEqual([100, 110]);
    expect(getStream(streams, "heartrate")).toEqual([]);
  });

  it("still supports the object shape", () => {
    expect(getStream({ watts: [1, 2] }, "watts")).toEqual([1, 2]);
    expect(getStream(undefined, "watts")).toEqual([]);
  });
});

describe("matchesSport", () => {
  it("matches sport families", () => {
    expect(matchesSport("VirtualRide", "Ride")).toBe(true);
    expect(matchesSport("GravelRide", "ride")).toBe(true);
    expect(matchesSport("TrailRun", "Run")).toBe(true);
    expect(matchesSport("Run", "Ride")).toBe(false);
    expect(matchesSport(undefined, "Ride")).toBe(false);
  });
});
