#!/usr/bin/env node

/**
 * Bulk upload FIT/TCX/GPX files to intervals.icu
 *
 * Usage:
 *   node upload.js /path/to/fit-files/
 *   node upload.js /path/to/fit-files/ --dry-run
 *
 * Environment variables (from .env):
 *   INTERVALS_API_KEY
 *   INTERVALS_ATHLETE_ID
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";

const BASE = "https://intervals.icu/api/v1";
const SUPPORTED_EXTENSIONS = new Set([".fit", ".tcx", ".gpx", ".fit.gz"]);
const BATCH_SIZE = 5; // concurrent uploads
const DELAY_MS = 500; // delay between batches to avoid rate limiting

// Load env from .env file
function loadEnv() {
  try {
    const env = readFileSync(join(import.meta.dirname, ".env"), "utf-8");
    for (const line of env.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
  } catch {
    // .env not found, use existing env vars
  }
}

function getConfig() {
  loadEnv();
  const apiKey = process.env.INTERVALS_API_KEY;
  const athleteId = process.env.INTERVALS_ATHLETE_ID ?? "0";
  if (!apiKey) {
    console.error("Error: INTERVALS_API_KEY is required (set in .env or environment)");
    process.exit(1);
  }
  return { apiKey, athleteId };
}

function findFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...findFiles(full));
    } else {
      const ext = extname(entry).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext) || entry.toLowerCase().endsWith(".fit.gz")) {
        files.push(full);
      }
    }
  }
  return files;
}

async function uploadFile(filePath, apiKey, athleteId) {
  const fileName = basename(filePath);
  const fileData = readFileSync(filePath);

  const formData = new FormData();
  const blob = new Blob([fileData]);
  formData.append("file", blob, fileName);

  const res = await fetch(`${BASE}/athlete/${athleteId}/activities`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { file: fileName, status: "error", code: res.status, message: text.slice(0, 100) };
  }

  const data = await res.json();
  return { file: fileName, status: "ok", id: data.id, name: data.name };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dir = args.find((a) => !a.startsWith("--"));

  if (!dir) {
    console.log("Usage: node upload.js /path/to/fit-files/ [--dry-run]");
    process.exit(1);
  }

  const { apiKey, athleteId } = getConfig();
  const files = findFiles(dir);

  console.log(`Found ${files.length} files in ${dir}`);

  if (dryRun) {
    files.forEach((f) => console.log(`  ${basename(f)}`));
    console.log("\n(dry run — no files uploaded)");
    return;
  }

  let uploaded = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((f) => uploadFile(f, apiKey, athleteId))
    );

    for (const r of results) {
      if (r.status === "ok") {
        uploaded++;
        console.log(`✓ ${r.file} → ${r.name} (${r.id})`);
      } else {
        errors++;
        console.log(`✗ ${r.file} → ${r.code}: ${r.message}`);
      }
    }

    console.log(`  [${Math.min(i + BATCH_SIZE, files.length)}/${files.length}]`);

    if (i + BATCH_SIZE < files.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone: ${uploaded} uploaded, ${errors} errors, ${files.length} total`);
}

main();
