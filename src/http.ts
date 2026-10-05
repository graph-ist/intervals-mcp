#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import * as icu from "./intervals.js";
import { createServer } from "./server.js";

const apiKey = process.env.INTERVALS_API_KEY;
const athleteId = process.env.INTERVALS_ATHLETE_ID ?? "0";
const port = parseInt(process.env.PORT ?? "3001", 10);
const mcpAuthToken = process.env.MCP_AUTH_TOKEN;

if (!apiKey) {
  console.error("INTERVALS_API_KEY is required");
  process.exit(1);
}

if (!mcpAuthToken) {
  console.error("MCP_AUTH_TOKEN is required");
  process.exit(1);
}

if (mcpAuthToken.length < 32) {
  console.warn("MCP_AUTH_TOKEN is shorter than 32 characters: generate a stronger one with `openssl rand -hex 32`");
}

icu.configure(apiKey, athleteId);

// Remote clients cannot read the server's disk: local paths are allowed only inside UPLOAD_DIR
const serverOptions = { allowAnyLocalPath: false, uploadDir: process.env.UPLOAD_DIR };

const app = express();
// Base64 activity files (up to 25 MB raw) travel inside the JSON-RPC body
app.use(express.json({ limit: "40mb" }));

// Richiede il token in "Authorization: Bearer <MCP_AUTH_TOKEN>" oppure come
// query param "?token=<MCP_AUTH_TOKEN>" su /mcp. Il server è esposto
// pubblicamente (Tailscale Funnel): senza questo, chiunque conosca l'URL ha
// accesso in lettura/scrittura al conto intervals.icu collegato (vedi F2 in
// aegis-infra/SECURITY-REVIEW.md). Il query param serve perché i connector
// custom di Claude (claude.ai) non espongono un campo per header HTTP
// personalizzati — solo OAuth Client ID/Secret, che qui non implementiamo —
// quindi l'unico modo di passare il token è incorporarlo nell'URL stesso.
// timingSafeEqual per evitare timing attack sul confronto; "/" e "/health"
// restano senza auth (health check, es. Render).
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expected = Buffer.from(mcpAuthToken as string, "utf8");

  const header = req.headers.authorization;
  const bearer = typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : "";
  const bearerBuf = Buffer.from(bearer, "utf8");
  const bearerValid = bearerBuf.length === expected.length && timingSafeEqual(bearerBuf, expected);

  const queryToken = req.query.token;
  const queryBuf = Buffer.from(typeof queryToken === "string" ? queryToken : "", "utf8");
  const queryValid = queryBuf.length === expected.length && timingSafeEqual(queryBuf, expected);

  if (!bearerValid && !queryValid) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.use("/mcp", requireAuth);

// Map to track active transports by session ID
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const transports = new Map<string, StreamableHTTPServerTransport>();
const sessionLastSeen = new Map<string, number>();

async function pruneStale() {
  const now = Date.now();
  for (const [id, ts] of sessionLastSeen) {
    if (now - ts > SESSION_TTL_MS) {
      const transport = transports.get(id);
      if (transport) await transport.close();
      transports.delete(id);
      sessionLastSeen.delete(id);
    }
  }
}

function touchSession(id: string) {
  sessionLastSeen.set(id, Date.now());
}

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Reuse existing transport for the session
  if (sessionId && transports.has(sessionId)) {
    touchSession(sessionId);
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Enforce session cap
  await pruneStale();
  if (transports.size >= MAX_SESSIONS) {
    res.status(503).json({ error: "Too many active sessions" });
    return;
  }

  // New session: create transport + server
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
      touchSession(id);
    },
  });

  transport.onclose = () => {
    const id = [...transports.entries()].find(([, t]) => t === transport)?.[0];
    if (id) {
      transports.delete(id);
      sessionLastSeen.delete(id);
    }
  };

  const { mcpServer } = createServer(serverOptions);
  await mcpServer.connect(transport);
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
    sessionLastSeen.delete(sessionId);
  }
  res.status(200).json({ ok: true });
});

// Health check (Render pings / by default)
const { toolCount, promptCount, version } = createServer(serverOptions);

app.get("/", (_req, res) => {
  res.json({ status: "ok", version, tools: toolCount, prompts: promptCount, sessions: transports.size });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version, tools: toolCount, prompts: promptCount, sessions: transports.size });
});

const httpServer = app.listen(port, () => {
  console.log(`intervals-mcp HTTP server running on http://localhost:${port}/mcp`);
});

// Periodic session cleanup every 5 minutes
const pruneTimer = setInterval(() => void pruneStale(), 5 * 60 * 1000);
pruneTimer.unref();

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down...");
  clearInterval(pruneTimer);
  for (const [id, transport] of transports) {
    try {
      await transport.close();
    } catch {}
    transports.delete(id);
    sessionLastSeen.delete(id);
  }
  httpServer.close();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
