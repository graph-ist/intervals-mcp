import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { recordArg, safe, toolError } from "../helpers.js";

export function registerSocialTools(server: McpServer): void {
  // --- list_routes ---
  server.tool("list_routes", "List the athlete's routes with activity counts (GPS path not included)", {}, () =>
    safe(() => icu.listRoutes()),
  );

  // --- get_route ---
  server.tool(
    "get_route",
    "Get a route by ID, optionally with the GPS path",
    {
      route_id: z.number().describe("Route ID (see list_routes)"),
      include_path: z.boolean().optional().describe("Include latlngs of the GPS path (large)"),
    },
    ({ route_id, include_path }) => safe(() => icu.getRoute(route_id, include_path ?? false)),
  );

  // --- update_route ---
  server.tool(
    "update_route",
    "Update a route (name, description, tags, commute flag, rename_activities)",
    { route_id: z.number().describe("Route ID"), updates: recordArg.describe("Fields to update") },
    ({ route_id, updates }) => safe(() => icu.updateRoute(route_id, updates)),
  );

  // --- get_route_similarity ---
  server.tool(
    "get_route_similarity",
    "How similar two routes are (0-1), with distances and activity counts. Use to decide whether to merge routes.",
    { route_id: z.number().describe("Route ID"), other_route_id: z.number().describe("Route ID to compare with") },
    ({ route_id, other_route_id }) => safe(() => icu.getRouteSimilarity(route_id, other_route_id)),
  );

  // --- list_chats ---
  server.tool(
    "list_chats",
    "List the athlete's chats (private, group, activity) with unread counts, most recently active first",
    {},
    () => safe(() => icu.listChats()),
  );

  // --- list_groups ---
  server.tool("list_groups", "List the groups the athlete belongs to", {}, () => safe(() => icu.listGroups()));

  // --- get_chat ---
  server.tool(
    "get_chat",
    "Get a chat by ID, including members",
    { chat_id: z.number().describe("Chat ID (see list_chats)") },
    ({ chat_id }) => safe(() => icu.getChat(chat_id)),
  );

  // --- list_chat_messages ---
  server.tool(
    "list_chat_messages",
    "List messages of a chat, most recent first",
    {
      chat_id: z.number().describe("Chat ID"),
      before_id: z.number().optional().describe("Only messages older than this message ID (pagination)"),
      limit: z.number().optional().describe("Max messages (default 30, max 100)"),
    },
    ({ chat_id, before_id, limit }) => safe(() => icu.listChatMessages(chat_id, before_id, limit)),
  );

  // --- list_activity_messages ---
  server.tool(
    "list_activity_messages",
    "List comments on an activity",
    {
      activity_id: z.string().describe("Activity ID"),
      since_id: z.number().optional().describe("Only messages after this message ID"),
      limit: z.number().optional().describe("Max messages (default 100)"),
    },
    ({ activity_id, since_id, limit }) => safe(() => icu.listActivityMessages(activity_id, since_id, limit)),
  );

  // --- add_activity_message ---
  server.tool(
    "add_activity_message",
    "Post a comment on an activity. Visible to everyone with access to the activity; confirm the text with the user first.",
    {
      activity_id: z.string().describe("Activity ID"),
      content: z.string().min(1).max(4000).describe("Comment text"),
    },
    ({ activity_id, content }) => safe(() => icu.addActivityMessage(activity_id, content)),
  );

  // --- send_chat_message ---
  server.tool(
    "send_chat_message",
    "Send a real chat message to a chat or directly to an athlete. Other people will see it; confirm recipient and text with the user first.",
    {
      content: z.string().min(1).max(4000).describe("Message text"),
      chat_id: z.number().optional().describe("Existing chat ID"),
      to_athlete_id: z.string().optional().describe("Athlete ID for a private message (when no chat_id)"),
    },
    ({ content, chat_id, to_athlete_id }) => {
      if (chat_id === undefined && to_athlete_id === undefined) return toolError("Provide chat_id or to_athlete_id.");
      return safe(() =>
        icu.sendChatMessage({
          type: "TEXT",
          content,
          ...(chat_id !== undefined && { chat_id }),
          ...(to_athlete_id !== undefined && { to_athlete_id }),
        }),
      );
    },
  );

  // --- update_chat_message ---
  server.tool(
    "update_chat_message",
    "Edit a chat message you sent (only content or answer can be changed). Others will see the edit.",
    {
      chat_id: z.number().describe("Chat ID"),
      message_id: z.number().describe("Message ID"),
      content: z.string().min(1).max(4000).optional().describe("New text"),
      answer: z.string().optional().describe("New answer (for request-type messages)"),
    },
    ({ chat_id, message_id, content, answer }) =>
      safe(() =>
        icu.updateChatMessage(chat_id, message_id, {
          ...(content !== undefined && { content }),
          ...(answer !== undefined && { answer }),
        }),
      ),
  );

  // --- delete_chat_message ---
  server.tool(
    "delete_chat_message",
    "Delete a chat message. Irreversible — confirm with the user first.",
    { chat_id: z.number().describe("Chat ID"), message_id: z.number().describe("Message ID") },
    ({ chat_id, message_id }) => safe(() => icu.deleteChatMessage(chat_id, message_id)),
  );

  // --- mark_chat_seen ---
  server.tool(
    "mark_chat_seen",
    "Mark a chat as read up to a given message",
    { chat_id: z.number().describe("Chat ID"), message_id: z.number().describe("Last seen message ID") },
    ({ chat_id, message_id }) => safe(() => icu.markChatSeen(chat_id, message_id)),
  );

  // --- block_chat ---
  server.tool(
    "block_chat",
    "Block or unblock the other athlete in a private chat. Confirm with the user first.",
    {
      chat_id: z.number().describe("Private chat ID"),
      blocked: z.boolean().describe("true to block, false to unblock"),
    },
    ({ chat_id, blocked }) => safe(() => icu.setChatBlocked(chat_id, blocked)),
  );
}
