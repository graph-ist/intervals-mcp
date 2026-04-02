import { describe, expect, it } from "vitest";
import { createServer } from "../server.js";

describe("createServer", () => {
  it("returns server with expected tool and prompt counts", () => {
    const result = createServer();
    expect(result.mcpServer).toBeDefined();
    expect(result.toolCount).toBe(50);
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
});
