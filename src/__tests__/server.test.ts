import { describe, expect, it } from "vitest";
import { createServer } from "../server.js";

describe("createServer", () => {
  it("returns server with expected tool and prompt counts", () => {
    const result = createServer();
    expect(result.mcpServer).toBeDefined();
    expect(result.toolCount).toBe(146);
    expect(result.promptCount).toBe(4);
  });

  it("version matches package.json", async () => {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(join(dir, "..", "..", "package.json"), "utf-8"));
    const { version } = createServer();
    expect(version).toBe(pkg.version);
  });

  async function connect(opts?: Parameters<typeof createServer>[0]) {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { mcpServer } = createServer(opts);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([mcpServer.connect(serverT), client.connect(clientT)]);
    return client;
  }

  it("annotates read-only and destructive tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get_events?.readOnlyHint).toBe(true);
    expect(byName.delete_folder?.destructiveHint).toBe(true);
    expect(byName.create_workout?.readOnlyHint).toBe(false);
    expect(byName.create_workout?.destructiveHint).toBe(false);
    expect(byName.send_chat_message?.openWorldHint).toBe(true);
    for (const name of ["update_activity_intervals", "apply_sport_settings", "apply_plan", "upload_wellness_csv"]) {
      expect(byName[name]?.destructiveHint, name).toBe(true);
    }
    expect(byName.update_activity?.destructiveHint).toBe(false);
  });

  it("rejects out-of-range numeric arguments", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "get_training_load_risk", arguments: { days: 100000 } });
    expect(res.isError).toBe(true);
  });

  it("refuses local file paths when not allowed or outside the upload dir", async () => {
    const { mkdtemp, writeFile, symlink } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "icu-up-"));
    const outside = await mkdtemp(join(tmpdir(), "icu-out-"));
    await writeFile(join(outside, "secret.env"), "KEY=1");
    await symlink(join(outside, "secret.env"), join(dir, "evil.fit"));

    const remote = await connect({ allowAnyLocalPath: false });
    const r1 = await remote.callTool({ name: "upload_activity", arguments: { file_path: join(dir, "evil.fit") } });
    expect(r1.isError).toBe(true);
    expect(JSON.stringify(r1.content)).toContain("disabled");

    const scoped = await connect({ allowAnyLocalPath: false, uploadDir: dir });
    const r2 = await scoped.callTool({ name: "upload_activity", arguments: { file_path: join(dir, "evil.fit") } });
    expect(r2.isError).toBe(true);
    expect(JSON.stringify(r2.content)).toMatch(/Only \.fit|inside the configured upload directory/);
  });

  it("serves prompts when the client sends no arguments", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "activity_review",
      "load_tracker",
      "morning_check",
      "weekly_review",
    ]);
    for (const { name } of prompts) {
      const res = await client.getPrompt({ name });
      expect(res.messages.length).toBeGreaterThan(0);
    }
  });
});
