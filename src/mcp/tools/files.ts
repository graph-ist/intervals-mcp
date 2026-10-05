import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as icu from "../../intervals.js";
import { dateStr, type ServerOptions, safe, safeReturn, type ToolResult, toolError } from "../helpers.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_EXT = /\.(fit|fit\.gz|tcx|gpx)$/i;

// Resolves symlinks before checking, so a link named x.fit cannot point at .env or other files
async function checkUploadPath(filePath: string, opts: ServerOptions): Promise<string | null> {
  if (!opts.allowAnyLocalPath && !opts.uploadDir) {
    return "Local file upload is disabled on this server: send file_base64 + filename instead.";
  }
  if (!isAbsolute(filePath)) return "file_path must be absolute.";
  let real: string;
  try {
    real = await realpath(filePath);
  } catch {
    return "File not found.";
  }
  if (!ALLOWED_UPLOAD_EXT.test(real)) return "Only .fit, .fit.gz, .tcx, .gpx files are allowed.";
  if (opts.uploadDir) {
    const root = await realpath(opts.uploadDir).catch(() => null);
    const rel = root ? relative(root, real) : "..";
    if (rel.startsWith("..") || isAbsolute(rel)) return "file_path must be inside the configured upload directory.";
  }
  const info = await stat(real);
  if (!info.isFile()) return "file_path is not a regular file.";
  if (info.size > MAX_UPLOAD_BYTES) return `File larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  return null;
}

const MAX_FILE_CHARS = 2_000_000;
const fileFormat = z.enum(["zwo", "mrc", "erg", "fit"]);

// Large files would blow up the MCP response, so refuse instead of truncating
async function fileResult(fn: () => Promise<string>, extra: Record<string, unknown>): Promise<ToolResult> {
  try {
    const content = await fn();
    if (content.length > MAX_FILE_CHARS) {
      return toolError(`File too large for an MCP response (${(content.length / 1e6).toFixed(1)} MB encoded).`);
    }
    return safeReturn({ ...extra, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(`API error: ${msg}`);
  }
}
export function registerFileTools(server: McpServer, opts: ServerOptions): void {
  // --- upload_activity ---
  server.tool(
    "upload_activity",
    "Upload an activity file (FIT, TCX, GPX or gzipped) to intervals.icu. Pass file_base64 + filename (works remotely) or file_path (only where the server allows local files). Set paired_event_id to link it to a planned workout.",
    {
      file_base64: z
        .string()
        .max(MAX_UPLOAD_BYTES * 1.4)
        .optional()
        .describe("File content, base64"),
      filename: z.string().optional().describe("File name with extension, required with file_base64"),
      file_path: z.string().optional().describe("Absolute path to the activity file on the server machine"),
      name: z.string().optional().describe("Activity name"),
      description: z.string().optional().describe("Activity description"),
      device_name: z.string().optional().describe("Recording device, e.g. Garmin Edge 540"),
      external_id: z.string().optional().describe("ID of the activity in the source system"),
      paired_event_id: z.number().int().optional().describe("Planned workout event ID to pair with"),
    },
    async ({ file_base64, filename: givenName, file_path, ...uploadOpts }) => {
      let fileData: Buffer;
      let filename: string;
      if (file_base64) {
        if (!givenName || !ALLOWED_UPLOAD_EXT.test(givenName)) {
          return toolError("filename ending in .fit, .fit.gz, .tcx or .gpx is required with file_base64.");
        }
        fileData = Buffer.from(file_base64, "base64");
        filename = basename(givenName);
      } else if (file_path) {
        const pathError = await checkUploadPath(file_path, opts);
        if (pathError) return toolError(pathError);
        try {
          fileData = Buffer.from(await readFile(await realpath(file_path)));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return toolError(`Cannot read file: ${msg}`);
        }
        filename = basename(file_path);
      } else {
        return toolError("Provide file_base64 + filename, or file_path.");
      }
      if (fileData.length === 0 || fileData.length > MAX_UPLOAD_BYTES) {
        return toolError(`File must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
      }
      try {
        const data = await icu.uploadActivity(fileData, filename, uploadOpts);
        return safeReturn(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`Upload failed: ${msg}`);
      }
    },
  );

  // --- download_event_workout ---
  server.tool(
    "download_event_workout",
    "Export a planned calendar workout as a file for other platforms: zwo (Zwift), mrc, erg (text) or fit (returned base64-encoded).",
    {
      event_id: z.number().describe("Event ID of the planned workout"),
      format: z.enum(["zwo", "mrc", "erg", "fit"]).describe("Output format"),
    },
    async ({ event_id, format }) => {
      try {
        const content = await icu.downloadEventWorkout(event_id, format);
        return safeReturn({ format, encoding: format === "fit" ? "base64" : "text", content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`API error: ${msg}`);
      }
    },
  );

  // --- download_workouts_zip ---
  server.tool(
    "download_workouts_zip",
    "Download all planned workouts in a date range as a zip of zwo, mrc, erg or fit files (zip returned base64-encoded, max ~1.5 MB)",
    {
      format: fileFormat.describe("File format inside the zip"),
      oldest: dateStr.describe("First day YYYY-MM-DD"),
      newest: dateStr.describe("Last day YYYY-MM-DD (inclusive)"),
    },
    ({ format, oldest, newest }) =>
      fileResult(() => icu.downloadWorkoutsZip(format, oldest, newest), {
        mime: "application/zip",
        encoding: "base64",
      }),
  );

  // --- download_activity_file ---
  server.tool(
    "download_activity_file",
    "Download an activity file: original uploaded file, intervals.icu generated fit, or generated gpx (gpx as text, others base64, max ~1.5 MB). Not available for Strava activities.",
    {
      activity_id: z.string().describe("Activity ID"),
      kind: z.enum(["original", "fit", "gpx"]).describe("Which file"),
    },
    ({ activity_id, kind }) =>
      fileResult(() => icu.downloadActivityFile(activity_id, kind), {
        kind,
        encoding: kind === "gpx" ? "text" : "base64",
      }),
  );

  // --- export_csv ---
  server.tool(
    "export_csv",
    "Export data as CSV text for spreadsheets or external analysis: activities, wellness, gear, events, athlete power/pace/HR curves, per-activity curves range, or a single activity's streams, curves and power vs HR.",
    {
      resource: z.enum(icu.CSV_RESOURCES).describe("What to export"),
      oldest: dateStr.optional().describe("Start date YYYY-MM-DD (date-based resources)"),
      newest: dateStr.optional().describe("End date YYYY-MM-DD (date-based resources)"),
      cols: z.array(z.string()).optional().describe("Wellness only: columns to include"),
      sport: z.string().optional().describe("Curves: sport type (default Ride)"),
      curves: z.array(z.string()).optional().describe("Athlete curves: curve specs (default 1y)"),
      activity_id: z.string().optional().describe("Required for activity_* resources"),
      types: z.array(z.string()).optional().describe("activity_streams only: stream types"),
    },
    ({ resource, oldest, newest, cols, sport, curves, activity_id, types }) =>
      fileResult(
        () => icu.exportCsv(resource, { oldest, newest, cols, sport, curves, activityId: activity_id, types }),
        {
          resource,
          encoding: "text",
        },
      ),
  );

  // --- upload_wellness_csv ---
  server.tool(
    "upload_wellness_csv",
    "Import wellness records from CSV text. The header row must use wellness field names, with an 'id' column holding the day (YYYY-MM-DD).",
    {
      csv: z.string().min(1).max(MAX_FILE_CHARS).describe("CSV content including header row"),
      ignore_missing_fields: z.boolean().optional().describe("Ignore columns that are not known wellness fields"),
    },
    ({ csv, ignore_missing_fields }) => safe(() => icu.uploadWellnessCsv(csv, ignore_missing_fields ?? false)),
  );

  // --- import_workout_file ---
  server.tool(
    "import_workout_file",
    "Import a workout file into a library folder: .zwo, .mrc, .erg as text, or .fit as base64",
    {
      folder_id: z.number().describe("Library folder ID"),
      sport: z.string().describe("Sport type: Ride, Run, Swim, etc."),
      filename: z
        .string()
        .regex(/\.(zwo|mrc|erg|fit)$/i, "Must end in .zwo, .mrc, .erg or .fit")
        .describe("File name with extension"),
      content: z.string().min(1).max(MAX_FILE_CHARS).describe("File content: text for zwo/mrc/erg, base64 for fit"),
    },
    ({ folder_id, sport, filename, content }) =>
      safe(() => icu.importWorkoutFile(folder_id, sport, content, filename, /\.fit$/i.test(filename))),
  );

  // --- upload_custom_item_image ---
  server.tool(
    "upload_custom_item_image",
    "Upload a new image (base64 PNG/JPG) for a custom item",
    {
      item_id: z.number().describe("Custom item ID"),
      filename: z
        .string()
        .regex(/\.(png|jpe?g|gif|webp)$/i, "Must be an image file name")
        .describe("Image file name"),
      image_base64: z.string().min(1).max(MAX_FILE_CHARS).describe("Image content, base64"),
    },
    ({ item_id, filename, image_base64 }) => safe(() => icu.uploadCustomItemImage(item_id, image_base64, filename)),
  );

  // --- upload_activity_streams_csv ---
  server.tool(
    "upload_activity_streams_csv",
    "Update activity streams from CSV text. Column headers must match those returned by export_csv with resource=activity_streams.",
    {
      activity_id: z.string().describe("Activity ID"),
      csv: z.string().min(1).max(MAX_FILE_CHARS).describe("CSV content including header row"),
    },
    ({ activity_id, csv }) => safe(() => icu.uploadActivityStreamsCsv(activity_id, csv)),
  );

  // --- download_activity_fit_files ---
  server.tool(
    "download_activity_fit_files",
    "Download a zip of intervals.icu generated fit files for several activities (base64, max ~1.5 MB). Strava activities are excluded.",
    {
      activity_ids: z.array(z.string()).min(1).max(50).describe("Activity IDs"),
      power: z.boolean().optional().describe("Include power data (default true)"),
      hr: z.boolean().optional().describe("Include heart rate data (default true)"),
    },
    ({ activity_ids, power, hr }) =>
      fileResult(() => icu.downloadActivityFitFiles(activity_ids, power ?? true, hr ?? true), {
        mime: "application/zip",
        encoding: "base64",
      }),
  );
}
