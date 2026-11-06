import { describe, expect, it } from "vitest";
import { DEFAULT_REMOTE_TOOLSETS, parseToolsets, TOOLSET_NAMES, TOOLSETS } from "../mcp/toolsets.js";
import { createServer } from "../server.js";

async function toolNames(toolsets?: string[]) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { mcpServer } = createServer({ allowAnyLocalPath: false, toolsets });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([mcpServer.connect(serverT), client.connect(clientT)]);
  return (await client.listTools()).tools.map((t) => t.name).sort();
}

describe("toolsets", () => {
  it("assign every registered tool to exactly one toolset", async () => {
    const registered = await toolNames();
    const assigned = TOOLSET_NAMES.flatMap((n) => [...TOOLSETS[n]]).sort();
    expect(assigned).toEqual(registered);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("register only the chosen toolsets", async () => {
    const names = await toolNames([...DEFAULT_REMOTE_TOOLSETS]);
    expect(names.length).toBe(TOOLSETS.core.length + TOOLSETS.planning.length);
    expect(names).toContain("get_readiness_check");
    expect(names).toContain("create_training_plan");
    expect(names).not.toContain("send_chat_message");
    expect(names).not.toContain("get_power_curves");
    expect(createServer({ toolsets: ["core"] }).toolCount).toBe(TOOLSETS.core.length);
  });

  it("keep every tool the prompts and the skill call in core", () => {
    const used = [
      "get_readiness_check",
      "get_recovery_index",
      "get_training_load_risk",
      "get_fitness_summary",
      "get_events",
      "get_recent_activities",
      "get_activity_detail",
      "get_activity_intervals",
      "get_aerobic_decoupling",
      "get_activity_dfrc",
      "get_polarization_analysis",
      "get_longitudinal_trends",
      "get_load_tracker",
      "get_wellness_data",
      "get_sport_settings",
    ];
    for (const t of used) expect(TOOLSETS.core as readonly string[], t).toContain(t);
  });

  it("parse INTERVALS_TOOLSETS", () => {
    expect(parseToolsets(undefined, DEFAULT_REMOTE_TOOLSETS)).toEqual(["core", "planning"]);
    expect(parseToolsets("", "all")).toEqual(TOOLSET_NAMES);
    expect(parseToolsets(" Core, curves ,core", "all")).toEqual(["core", "curves"]);
    expect(parseToolsets("core,all", DEFAULT_REMOTE_TOOLSETS)).toEqual(TOOLSET_NAMES);
    expect(() => parseToolsets("core,chat", "all")).toThrow(/Unknown toolset\(s\) chat/);
  });
});
