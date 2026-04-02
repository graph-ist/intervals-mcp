import { describe, expect, it } from "vitest";
import { extractStream } from "../utils.js";

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
