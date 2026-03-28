#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import * as icu from "./intervals.js";

const apiKey = process.env.INTERVALS_API_KEY;
const athleteId = process.env.INTERVALS_ATHLETE_ID ?? "0";

if (!apiKey) {
  console.error("INTERVALS_API_KEY is required");
  process.exit(1);
}

icu.configure(apiKey, athleteId);

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
