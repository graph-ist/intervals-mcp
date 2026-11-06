import { afterEach, describe, expect, it, vi } from "vitest";
import * as icu from "../intervals.js";
import { createServer } from "../server.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
icu.configure("k", "i1");

async function call(name: string, args: Record<string, unknown>) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { mcpServer } = createServer({ toolsets: ["curves"] });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([mcpServer.connect(serverT), client.connect(clientT)]);
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("{}") });
  const res = await client.callTool({ name, arguments: args });
  const url = fetchMock.mock.calls.length ? String(fetchMock.mock.calls.at(-1)?.[0]) : null;
  return { res, url };
}

describe("merged curve tools", () => {
  afterEach(() => fetchMock.mockReset());

  it("get_athlete_curves routes by kind with the right default sport", async () => {
    expect((await call("get_athlete_curves", { kind: "power" })).url).toMatch(
      /\/athlete\/i1\/power-curves\?.*type=Ride/,
    );
    expect((await call("get_athlete_curves", { kind: "pace", gap: true })).url).toMatch(
      /\/athlete\/i1\/pace-curves\?.*type=Run.*gap=true/,
    );
    expect((await call("get_athlete_curves", { kind: "hr", sport: "Run" })).url).toMatch(
      /\/athlete\/i1\/hr-curves\?.*type=Run/,
    );
  });

  it("get_athlete_curves rejects options that do not fit the kind", async () => {
    for (const args of [
      { kind: "hr", gap: true },
      { kind: "power", pm_type: "CS" },
      { kind: "pace", pm_type: "ECP" },
      { kind: "hr", pm_type: "MS_2P" },
    ]) {
      const { res, url } = await call("get_athlete_curves", args);
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(url).toBeNull();
    }
  });

  it("get_activity_curves_range routes by kind and rejects mismatched options", async () => {
    const range = { oldest: "2026-01-01", newest: "2026-02-01" };
    expect((await call("get_activity_curves_range", { kind: "power", ...range, secs: [300] })).url).toContain(
      "/activity-power-curves?",
    );
    expect((await call("get_activity_curves_range", { kind: "pace", ...range, distances: [1000] })).url).toContain(
      "/activity-pace-curves?",
    );
    expect((await call("get_activity_curves_range", { kind: "hr", ...range })).url).toContain("/activity-hr-curves?");
    for (const args of [
      { kind: "pace", secs: [60] },
      { kind: "hr", distances: [400] },
      { kind: "power", gap: true },
      { kind: "hr", fatigue: "kj0" },
    ]) {
      const { res } = await call("get_activity_curves_range", { ...range, ...args });
      expect(res.isError, JSON.stringify(args)).toBe(true);
    }
  });

  it("get_activity_power_curves covers the single-curve case", async () => {
    const { url } = await call("get_activity_power_curves", { activity_id: "a1", fatigue: ["kj0"] });
    expect(url).toMatch(/\/activity\/a1\/power-curves\?fatigue=kj0/);
  });
});
