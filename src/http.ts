#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import * as icu from "./intervals.js";
import { initTimeZone } from "./mcp/helpers.js";
import { DEFAULT_REMOTE_TOOLSETS, parseToolsets } from "./mcp/toolsets.js";
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
  console.error("MCP_AUTH_TOKEN must be at least 32 characters: generate one with `openssl rand -hex 32`");
  process.exit(1);
}

icu.configure(apiKey, athleteId);
void initTimeZone(process.env.INTERVALS_TIMEZONE, icu.getAthlete);

// Remote clients cannot read the server's disk: local paths are allowed only inside UPLOAD_DIR
let toolsets: string[];
try {
  toolsets = parseToolsets(process.env.INTERVALS_TOOLSETS, DEFAULT_REMOTE_TOOLSETS);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const serverOptions = { allowAnyLocalPath: false, uploadDir: process.env.UPLOAD_DIR, toolsets };

const app = express();

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

// Auth runs before body parsing, so unauthenticated clients cannot make the server read 40 MB bodies.
// Base64 activity files (up to 25 MB raw) travel inside the JSON-RPC body.
app.use("/mcp", requireAuth, express.json({ limit: "40mb" }));

// Stateless: every request gets its own transport and server, so a restart, a TTL or a
// stale Mcp-Session-Id never leaves a client with "Server not initialized".
// The server sends no notifications or subscriptions, so no session state is needed.
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const { mcpServer } = createServer(serverOptions);
  res.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });
  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// No server-initiated stream and no sessions to close
const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// Health check (Render pings / by default)
const { toolCount, promptCount, version } = createServer(serverOptions);
const health = { status: "ok", version, tools: toolCount, prompts: promptCount, toolsets };

app.get("/", (_req, res) => {
  res.json(health);
});

app.get("/health", (_req, res) => {
  res.json(health);
});

const httpServer = app.listen(port, () => {
  console.log(`intervals-mcp HTTP server running on http://localhost:${port}/mcp`);
});

// Graceful shutdown
const shutdown = () => {
  httpServer.close();
  httpServer.closeIdleConnections();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
