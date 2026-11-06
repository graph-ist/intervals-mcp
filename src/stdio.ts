#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as icu from "./intervals.js";
import { initTimeZone } from "./mcp/helpers.js";
import { parseToolsets } from "./mcp/toolsets.js";
import { createServer } from "./server.js";

const apiKey = process.env.INTERVALS_API_KEY;
const athleteId = process.env.INTERVALS_ATHLETE_ID ?? "0";

if (!apiKey) {
  console.error("INTERVALS_API_KEY is required");
  process.exit(1);
}

icu.configure(apiKey, athleteId);
void initTimeZone(process.env.INTERVALS_TIMEZONE, icu.getAthlete);

let toolsets: string[];
try {
  toolsets = parseToolsets(process.env.INTERVALS_TOOLSETS, "all");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const { mcpServer } = createServer({ allowAnyLocalPath: true, toolsets });
const transport = new StdioServerTransport();
await mcpServer.connect(transport);
