#!/usr/bin/env node
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import * as icu from "./intervals.js";

const apiKey = process.env.INTERVALS_API_KEY;
const athleteId = process.env.INTERVALS_ATHLETE_ID ?? "0";
const port = parseInt(process.env.PORT ?? "3001", 10);

if (!apiKey) {
  console.error("INTERVALS_API_KEY is required");
  process.exit(1);
}

icu.configure(apiKey, athleteId);

const app = express();
app.use(express.json());

// Map to track active transports by session ID
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Reuse existing transport for the session
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session: create transport + server
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
    },
  });

  transport.onclose = () => {
    const id = [...transports.entries()].find(([, t]) => t === transport)?.[0];
    if (id) transports.delete(id);
  };

  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Handle GET for SSE (server-to-client notifications)
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// Handle DELETE for session cleanup
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.close();
    transports.delete(sessionId);
  }
  res.status(200).json({ ok: true });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", tools: 30, resources: 0, prompts: 4 });
});

app.listen(port, () => {
  console.log(`intervals-mcp HTTP server running on http://localhost:${port}/mcp`);
});
