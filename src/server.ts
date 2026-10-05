import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOptions } from "./mcp/helpers.js";
import { registerPrompts } from "./mcp/prompts.js";
import { registerActivityTools } from "./mcp/tools/activities.js";
import { registerAnalysisTools } from "./mcp/tools/analysis.js";
import { registerAthleteTools } from "./mcp/tools/athlete.js";
import { registerCurveTools } from "./mcp/tools/curves.js";
import { registerEventTools } from "./mcp/tools/events.js";
import { registerFileTools } from "./mcp/tools/files.js";
import { registerGearTools } from "./mcp/tools/gear.js";
import { registerSocialTools } from "./mcp/tools/social.js";
import { registerWellnessTools } from "./mcp/tools/wellness.js";
import { registerWorkoutTools } from "./mcp/tools/workouts.js";

export type { ServerOptions } from "./mcp/helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const VERSION: string = pkg.version;

const READ_ONLY_TOOL = /^(get|list|search|export|download|convert)_/;
const DESTRUCTIVE_TOOL =
  /^(delete_|bulk_delete_)|^(update_activity_streams|upload_activity_streams_csv|update_folder_shared_with|update_events_range|replace_gear|block_chat)$/;

export function createServer(opts: ServerOptions = { allowAnyLocalPath: true }): {
  mcpServer: McpServer;
  toolCount: number;
  promptCount: number;
  version: string;
} {
  const server = new McpServer({
    name: "intervals-icu",
    version: VERSION,
  });

  // Count registrations and attach MCP annotations so clients can ask confirmation before writes/deletes
  let toolCount = 0;
  let promptCount = 0;
  const registerTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
  const registerPrompt = server.prompt.bind(server) as (...args: unknown[]) => unknown;
  const patchable = server as unknown as { tool: typeof registerTool; prompt: typeof registerPrompt };
  patchable.tool = (...args: unknown[]) => {
    toolCount++;
    const name = String(args[0]);
    if (args.length === 4) {
      const readOnly = READ_ONLY_TOOL.test(name);
      args.splice(3, 0, {
        readOnlyHint: readOnly,
        ...(!readOnly && { destructiveHint: DESTRUCTIVE_TOOL.test(name) }),
        openWorldHint: name === "send_chat_message" || name === "add_activity_message",
      });
    }
    return registerTool(...args);
  };
  patchable.prompt = (...args: unknown[]) => {
    promptCount++;
    return registerPrompt(...args);
  };

  registerPrompts(server);
  registerAthleteTools(server);
  registerActivityTools(server);
  registerCurveTools(server);
  registerAnalysisTools(server);
  registerEventTools(server);
  registerWorkoutTools(server);
  registerWellnessTools(server);
  registerGearTools(server);
  registerSocialTools(server);
  registerFileTools(server, opts);

  return { mcpServer: server, toolCount, promptCount, version: VERSION };
}
