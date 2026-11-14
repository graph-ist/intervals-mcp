# intervals-mcp

[![CI](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

MCP server for [intervals.icu](https://intervals.icu). It exposes 143 tools covering the whole documented public API (except the OAuth-only `disconnect-app` endpoint), including eleven analysis tools, and four prompts. Version 1.0.0 is the current feature-complete release: no further tools are planned.

Two transports are provided: stdio for local clients such as Claude Desktop, and Streamable HTTP for remote clients such as claude.ai custom connectors.

## Installation

Requires Node.js 22 or later and an intervals.icu API key (intervals.icu → Settings → Developer → API key). The athlete ID is optional: without it the server uses the account the key belongs to.

The server installs straight from this GitHub repository: `npx -y github:graph-ist/intervals-mcp` downloads it, compiles it once and starts the stdio server, with no clone and no npm account. The first start takes about a minute; later starts reuse the npx cache. The package has two commands: `intervals-mcp` (stdio) and `intervals-mcp-http` (Streamable HTTP).

### Claude Desktop (stdio)

Add the server to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "intervals": {
      "command": "npx",
      "args": ["-y", "github:graph-ist/intervals-mcp"],
      "env": {
        "INTERVALS_API_KEY": "your_api_key",
        "INTERVALS_ATHLETE_ID": "your_athlete_id"
      }
    }
  }
}
```

Restart Claude Desktop afterwards.

### Claude Code

```bash
claude mcp add intervals --env INTERVALS_API_KEY=your_api_key -- npx -y github:graph-ist/intervals-mcp
```

### VS Code and other clients

Any client that launches stdio servers takes the same command: `npx -y github:graph-ist/intervals-mcp`, with `INTERVALS_API_KEY` in the environment. Without a suffix npx takes the latest commit on `main`; for a fixed version add a tag, `github:graph-ist/intervals-mcp#v1.0.2`. To skip the compile at every cache refresh, install it once with `npm install -g github:graph-ist/intervals-mcp` and call `intervals-mcp` directly.

### From source

```bash
git clone https://github.com/graph-ist/intervals-mcp.git
cd intervals-mcp
npm ci
npm run build
```

Then point the client at `node /ABSOLUTE/PATH/TO/intervals-mcp/dist/stdio.js`.

### Remote (Streamable HTTP)

```bash
INTERVALS_API_KEY=xxx MCP_AUTH_TOKEN=$(openssl rand -hex 32) npx -y -p github:graph-ist/intervals-mcp intervals-mcp-http
```

The server listens on `http://localhost:3001/mcp`. The transport is stateless: every POST is handled independently, there are no sessions to expire, and restarting the server does not break connected clients. `GET` and `DELETE` on `/mcp` return 405. `/` and `/health` are unauthenticated; `/mcp` requires the token, sent either as `Authorization: Bearer <token>` or as a `?token=` query parameter. The query parameter exists because claude.ai custom connectors cannot send custom headers, so the connector URL has the form:

```
https://your-host.example/mcp?token=YOUR_MCP_AUTH_TOKEN
```

Treat that URL as a password: whoever holds it can read and write your intervals.icu account.

## Deployment

The server is a plain Node.js 22 process. A public HTTPS endpoint is needed only when it is used from claude.ai or a phone.

- **Docker**: see the [Dockerfile](Dockerfile). The image runs `node dist/http.js` as a non-root user on port 3001 and has a health check on `/health`.
- **Render**: see [render.yaml](render.yaml). The free tier sleeps after 15 minutes of inactivity, so the first request takes about 30 seconds. Set `MCP_AUTH_TOKEN` in the service environment.
- **Raspberry Pi**: provisioning, systemd units, firewall and the public tunnel are not part of this repository. They live in the separate `aegis-infra` repository, which treats this server as one of the services running on the device.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `INTERVALS_API_KEY` | Yes | | intervals.icu API key (Settings → Developer) |
| `INTERVALS_ATHLETE_ID` | No | `0` (current user) | intervals.icu athlete ID |
| `MCP_AUTH_TOKEN` | Yes (HTTP only) | | Token required on `/mcp`. At least 32 characters, otherwise the server refuses to start: `openssl rand -hex 32` |
| `INTERVALS_TIMEZONE` | No | athlete profile `timezone` | IANA time zone (e.g. `Europe/Rome`) used for "today" and date ranges. Without it the server reads the zone from the athlete profile at startup, and uses the process zone until then or if that fails |
| `INTERVALS_TOOLSETS` | No | HTTP: `core,planning`; stdio: `all` | Comma-separated toolsets to register (see [Toolsets](#toolsets)), or `all`. An unknown name stops startup |
| `UPLOAD_DIR` | No | | HTTP only: directory from which `upload_activity` may read local files. Without it, remote uploads accept only `file_base64` |
| `PORT` | No | `3001` | HTTP port (`intervals-mcp-http` only) |
| `HOST` | No | all interfaces | Address to listen on (`intervals-mcp-http` only). Set `127.0.0.1` when a local reverse proxy (Tailscale Funnel, cloudflared) is the only way in |

## Toolsets

Every tool belongs to one toolset, defined in [src/mcp/toolsets.ts](src/mcp/toolsets.ts). `INTERVALS_TOOLSETS` chooses which ones the server registers, so a client loads only the definitions it needs: with all 143 tools the list costs about 28,000 tokens per conversation, with the remote default about 15,600 (estimated as characters / 3.5).

| Toolset | Tools | Contents |
|---|---|---|
| `core` | 55 | Readiness and analysis tools, wellness, activity reads and metadata, athlete and sport settings, calendar events |
| `planning` | 21 | Training plans, bulk calendar changes, workout library |
| `curves` | 14 | Power, pace and HR curves, histograms, best efforts |
| `activity_edit` | 8 | Streams and interval editing, deletions, bulk manual activities |
| `files` | 9 | Uploads, downloads and CSV exports |
| `gear` | 9 | Gear and maintenance reminders |
| `social` | 15 | Routes, chats and activity comments |
| `custom` | 7 | Custom charts, fields and panels |
| `coach` | 5 | Tools for coaching several athletes |

The HTTP transport registers `core,planning` unless told otherwise; stdio registers everything. `/health` reports the active toolsets and the tool count. The tables below list all tools, whichever toolset they are in.

## Tools (143)

### Athlete and settings

| Tool | Description |
|---|---|
| `get_athlete` | Athlete profile and current fitness (CTL/ATL/TSB) |
| `get_athlete_profile` | Public profile (bio, shared folders, custom items) |
| `get_athlete_connections` | Connected devices and platforms |
| `get_athlete_settings` | Interface settings for phone, tablet or desktop |
| `update_athlete` | Update the athlete profile (weight, resting HR, birth date, time zone, wellness fields) |
| `list_athletes` | Athletes followed or coached (requires an API key) |
| `get_fitness_summary` | Total hours, distance, TSS and activity count per sport over a period |
| `get_sport_settings` | Zones, FTP, thresholds, max HR |
| `create_sport_settings` | Create the settings for a sport that has none |
| `update_sport_settings` | Update sport settings (FTP, LTHR, zones, W', kJ thresholds, ...) |
| `update_sport_settings_bulk` | Update the settings of several sports at once |
| `apply_sport_settings` | Apply settings (zones, thresholds) to past activities and recalculate |
| `delete_sport_settings` | Delete the settings of a sport |
| `get_weather_config` / `update_weather_config` | Locations used for weather forecasts |
| `list_tags` | Tags used on events or library workouts |
| `create_custom_chart` | Create a custom chart |
| `list_custom_items` | List custom charts, fields and panels |
| `get_custom_item` / `update_custom_item` / `delete_custom_item` | Manage a custom item |
| `reorder_custom_items` | Reorder custom items |

### Activities

| Tool | Description |
|---|---|
| `get_recent_activities` | Recent activities |
| `search_activities` | Search activities by text |
| `search_activities_full` | Search by name or tag, returning full activities |
| `get_activity_detail` | Full details of an activity |
| `get_activity_streams` | Time series (power, HR, pace, ...) |
| `get_activities_by_ids` | Several activities by ID in one call |
| `get_activities_around` | Activities before and after a given one |
| `get_matching_activities` | Activities matching a sport setting |
| `update_activity` | Edit activity metadata (name, type, description, ...) |
| `delete_activity` | Delete an activity |
| `delete_activity_tombstone` | Allow a deleted activity to be uploaded again |
| `create_manual_activity` | Create a manual activity (duration, TSS, ...) |
| `create_manual_activities_bulk` | Create several manual activities (upsert on `external_id`) |
| `update_activity_streams` | Correct the streams (power, HR) of an activity |
| `get_activity_intervals` | Structured intervals of an activity |
| `update_activity_intervals` | Replace manual intervals |
| `update_activity_interval` | Update or create a single interval |
| `delete_activity_intervals` | Delete intervals from an activity |
| `split_activity_interval` | Split an interval in two |
| `search_intervals` | Search intervals by duration and intensity |
| `get_activity_interval_stats` | Statistics (power, HR, NP, ...) over an arbitrary stream range |
| `get_activity_segments` | Segments recognised in the activity |
| `get_activity_tags` | Available activity tags |
| `get_activity_map` | Map and GPS data |
| `get_activity_weather` | Weather during the activity |

### Curves

| Tool | Description |
|---|---|
| `get_athlete_curves` | Athlete power, pace or HR curves (`kind`): season, recent, fatigued, with filter sets for comparisons |
| `get_power_hr_curve` | Aerobic efficiency trend |
| `get_mmp_model` | MMP model (CP, W', pMax) |
| `get_pace_distances` | Distances used for pace curves |
| `get_activity_power_curves` | Power curve of one activity, optionally for several streams and fresh/fatigued variants |
| `get_activity_pace_curve` / `get_activity_hr_curve` | Pace or HR curve of one activity |
| `get_activity_curves_range` | Best power or HR per duration, or best pace per distance (`kind`), for each activity in a date range |
| `get_activity_best_efforts` | Best efforts by duration or distance |
| `get_activity_power_vs_hr` | Raw power vs HR scatter |
| `get_activity_power_histogram` | Power distribution |
| `get_activity_histogram` | HR, pace or grade-adjusted pace distribution |
| `get_activity_time_at_hr` | Time spent at each HR value |
| `get_activity_model` | Load model from HR or power peak detection |

### Analysis

Custom tools that compute physiological models on top of the API data. Formulas, constants and references are documented in [docs/MODELS.md](docs/MODELS.md).

| Tool | Description |
|---|---|
| `get_readiness_check` | Daily readiness on intervals.icu values: 7-day means of readiness, HRV and resting HR against a 60-day normal band (mean ± half the sample SD), plus TSB below −30, give one of four cases. Adds the severe flags (HRV or resting HR z below −2, SpO₂ below 93%). Same rule as the training dashboard and the `intervals-coach` skill |
| `get_recovery_index` | Composite 0-100 recovery index from HRV, resting HR, sleep, Baevsky SI, SpO₂, respiration and subjective fields (mood, motivation, fatigue, soreness, stress, injury), against an individual 30-day baseline |
| `get_training_load_risk` | Monotony, Strain (Foster, 1998), ACWR (Gabbett, 2016), volume spikes |
| `get_aerobic_decoupling` | Pw:Hr decoupling: drift between first and second half, EF curve, assessment |
| `get_activity_dfrc` | dFRC / W'bal of an activity (Skiba model) |
| `get_metabolic_profile` | VLaMax estimate (Mader), energy breakdown, Coggan power profile |
| `get_fatigue_resistance` | Durability: fresh vs fatigued power curves, Fatigue Resistance Score, VO₂max retention (Maunder et al., 2021). Requires the kJ threshold `after_kj0` in the sport settings |
| `get_polarization_analysis` | Time in zones, polarization index, comparison with the 80/20 model (Seiler, 2010; Stöggl & Sperlich, 2015) |
| `get_longitudinal_trends` | Regression on EF, power, HRR, decoupling, CTL, HRV, resting HR, weight and sleep |
| `get_load_tracker` | Load Tracker: weekly TSS for the previous week, the current week and the next 11 (about 3 months, Monday to Sunday). Only swim, bike, run and strength count; every other activity is noise and counts 0. Gym load is weighted with the athlete's Activity Types fitness % (60% by default). Per week: target (manual `targets` by date, else the weekly `TARGET` calendar event, else the load of planned workouts), TSS done per sport, completion %, remaining TSS and, for the current week, the daily cumulative TSS. `plan_compliance` per week: planned, completed, missed and still-to-do workouts, unplanned activities and the mean intervals.icu compliance % of the paired activities. Weeks without a target stay empty |
| `get_cp_history` | Month-by-month CP, W' and Pmax from the intervals.icu power-duration models of each month's best efforts, with peak 5 s / 1 min / 5 min / 20 min power and the change over the window. A month without maximal efforts understates CP |

Which tool answers which question:

| Question | Tool |
|---|---|
| How much did I ride, run or swim this month? | `get_fitness_summary` |
| How am I today, can I train hard? | `get_readiness_check` |
| Am I increasing the load too fast? | `get_training_load_risk` |
| What do the raw daily wellness values look like? | `get_wellness_data` |
| Am I improving or declining? | `get_longitudinal_trends` |
| Is my training well polarized? | `get_polarization_analysis` |
| How well do I hold power under fatigue? | `get_fatigue_resistance` |
| Am I on track with the weekly TSS I planned? | `get_load_tracker` |
| Did I do the workouts I planned? | `get_load_tracker` (`plan_compliance`) |
| Is the season shifting my CP, W' or sprint? | `get_cp_history` |

DFA α1 threshold detection is not part of the server: the unregistered implementation was removed in 0.4.0. It can be recovered from commit `2af8bb6` (`src/analytics/dfa-alpha1.ts`) if beat-to-beat RR data from a chest strap become available.

### Wellness

| Tool | Description |
|---|---|
| `get_wellness_data` | Wellness over a period: CTL, ATL, TSB, HRV, sleep, mood |
| `get_wellness_day` | Wellness of a single day |
| `update_wellness` | Update wellness for a date (weight, HRV, sleep, subjective scales) |
| `update_wellness_bulk` | Update several wellness days in one call |
| `upload_wellness_csv` | Import wellness from CSV text |

Subjective scales use 1 to 4, where 1 is the best value. They must be enabled in the athlete's wellness fields before intervals.icu stores them.

### Calendar and planning

| Tool | Description |
|---|---|
| `get_events` | Calendar events (workouts, races, notes) with a category filter |
| `get_event` | A single event by ID |
| `create_training_plan` | Create a training plan on the calendar in one bulk call |
| `update_event` | Edit an event |
| `mark_event_done` | Mark a planned workout as done (creates a manual activity) |
| `delete_event` | Delete an event |
| `duplicate_events` | Duplicate events (repeat weekly blocks) |
| `bulk_delete_events` | Delete events in batch |
| `delete_events_range` | Delete all events in a date range |
| `update_events_range` | Hide or lock events in a range (coach feature) |
| `get_training_plan` | Details of the active training plan |
| `update_training_plan` | Change the plan assigned to the athlete |
| `update_athlete_plans` | Coach: change the plan of several athletes at once |
| `apply_plan` | Apply a library plan to the calendar from a date |
| `apply_plan_changes` | Propagate changes of the active plan to the calendar |
| `get_fitness_model_events` | Fitness model events (CTL/ATL/TSB) |
| `get_weather_forecast` | Weather forecast for your location |
| `get_shared_event` | Shared event (for example a race) with its routes |

### Workout library

| Tool | Description |
|---|---|
| `get_folders` | Workout and plan folders |
| `create_folder` / `update_folder` / `delete_folder` | Manage folders and plans (deleting removes their workouts) |
| `get_folder_shared_with` / `update_folder_shared_with` | Sharing of folders and plans with other athletes |
| `get_workouts` | Saved workouts |
| `get_workout` | A library workout |
| `create_workout` / `create_workouts_bulk` | Create one or several library workouts |
| `update_workout` / `delete_workout` | Edit or delete a library workout |
| `duplicate_workouts` | Duplicate workouts onto a plan |
| `convert_workout` | Convert a library workout to zwo, mrc, erg or fit |
| `update_plan_workouts` | Hide or show a range of plan workouts to the athlete |

### Files

| Tool | Description |
|---|---|
| `upload_activity` | Upload an activity file (FIT, TCX, GPX) as base64 or, where allowed, from a local path |
| `upload_activity_streams_csv` | Update the streams of an activity from CSV |
| `import_workout_file` | Import a zwo, mrc, erg or fit file into a folder |
| `upload_custom_item_image` | Upload the image of a custom item |
| `download_activity_file` | Original, fit or gpx file of an activity (up to about 1.5 MB) |
| `download_activity_fit_files` | Zip of generated fit files for several activities |
| `download_event_workout` | Export a planned workout as zwo, mrc, erg or fit |
| `download_workouts_zip` | Zip of the workouts in a date range (zwo, mrc, erg, fit) |
| `export_csv` | CSV export of activities, wellness, gear, events, athlete curves and single-activity data |

### Gear

| Tool | Description |
|---|---|
| `get_gear` | Gear list (bikes, shoes, ...) with distance and maintenance |
| `create_gear` / `update_gear` / `delete_gear` | Manage gear and components |
| `replace_gear` | Retire a component and replace it, keeping the reminders |
| `create_gear_reminder` / `update_gear_reminder` / `delete_gear_reminder` | Maintenance reminders (including reset and snooze) |
| `recalculate_gear_stats` | Recalculate distance, hours and activities of a gear item |

### Routes, chats and messages

| Tool | Description |
|---|---|
| `list_routes` / `get_route` / `update_route` | Athlete routes, with or without GPS track |
| `get_route_similarity` | Similarity between two routes |
| `list_chats` / `get_chat` / `list_chat_messages` | Read chats |
| `list_groups` | Athlete groups |
| `send_chat_message` | Send a real message to a chat or an athlete |
| `update_chat_message` / `delete_chat_message` | Edit or delete a message |
| `mark_chat_seen` / `block_chat` | Mark as read, block or unblock a private chat |
| `list_activity_messages` / `add_activity_message` | Comments on an activity |

## Prompts (4)

Available through the prompt picker in claude.ai and Claude Desktop.

| Prompt | When | What it does |
|---|---|---|
| `morning_check` | Morning | Calls `get_readiness_check` and follows the skill's morning check |
| `weekly_review` | Sunday evening | Lists the tools and dates of the week under review and follows the skill's weekly review and planning |
| `activity_review` | After a session | Finds the latest Ride, Run or Swim and follows the skill's activity review, including the rep-by-rep comparison |
| `load_tracker` | Any time | Calls `get_load_tracker` and draws the weekly columns as `chart_hint` describes |

The prompts are short entry points: the rules of each protocol live only in the [skill](#skill), so the two cannot drift apart. Each prompt keeps a one-line fallback for clients without the skill. The prompt texts are written in Italian.

## Skill

[skills/intervals-coach](skills/intervals-coach) is an Agent Skill that carries the coaching protocols behind the four prompts: when to deviate from the weekly plan, which tools each protocol calls, how to read `reference_ranges`, and when calendar writes need the user's confirmation. It loads only when a request is about training, so the protocols do not weigh on every conversation the way tool descriptions do.

- **Claude Code**: copy the folder to `~/.claude/skills/intervals-coach/` (all projects) or `.claude/skills/intervals-coach/` (one project).
- **claude.ai and Claude Desktop**: zip the `intervals-coach` folder and upload it as a custom skill in the app's skills settings.

```bash
cd skills && zip -r intervals-coach.zip intervals-coach
```

The skill and the prompts state the same rules; when one changes, update the other.

## Development

A release is a git tag `vX.Y.Z` matching the `version` in `package.json`; users pin it with `github:graph-ist/intervals-mcp#vX.Y.Z`. The `prepare` script compiles TypeScript when npm installs from git, so `dist/` stays out of the repository. Publishing to the npm registry is prepared in [.github/workflows/release.yml](.github/workflows/release.yml) (npm trusted publishing, no token in the repository) and stays off until the repository variable `NPM_PUBLISH` is `true`.

```bash
npm run build       # compile TypeScript
npm test            # run tests (vitest)
npm run test:watch  # tests in watch mode
npm run lint        # lint with Biome
npm run lint:fix    # lint with automatic fixes
npm run check       # type-check + lint + tests
```

### Project structure

```
src/
├── server.ts           # createServer(): wires prompts and tool modules, filters by toolset, adds MCP annotations
├── http.ts             # Streamable HTTP transport (Express, token auth, stateless)
├── stdio.ts            # stdio transport (Claude Desktop)
├── intervals.ts        # HTTP client for the intervals.icu API
├── types.ts            # response types
├── mcp/
│   ├── helpers.ts      # shared zod schemas, result helpers, date helpers, ServerOptions
│   ├── prompts.ts      # the prompts
│   ├── toolsets.ts     # toolset of every tool, INTERVALS_TOOLSETS parsing
│   └── tools/          # tool registration, one module per domain
│       ├── athlete.ts      activities.ts   curves.ts     analysis.ts
│       ├── wellness.ts     events.ts       workouts.ts   files.ts
│       └── gear.ts         social.ts
└── analytics/          # pure computation behind the analysis tools
    ├── decoupling.ts           # aerobic decoupling Pw:Hr
    ├── dfrc.ts                 # dFRC / W'bal (Skiba)
    ├── fatigue-resistance.ts   # durability: fresh vs fatigued curves
    ├── metabolic.ts            # metabolic profile (VLaMax, Coggan)
    ├── polarization.ts         # intensity distribution
    ├── readiness.ts            # readiness rule on intervals.icu values (same as the dashboard)
    ├── recovery.ts             # composite recovery index
    ├── training-load.ts        # monotony, strain, ACWR
    ├── trends.ts               # longitudinal trends and HRR
    ├── utils.ts                # shared helpers (stream extraction, sport matching)
    ├── cp-history.ts           # month-by-month CP, W', Pmax from intervals.icu PD models
    └── load-tracker.ts         # weekly TSS target vs done and plan compliance, per sport and day
docs/
└── MODELS.md           # mathematical models and literature (Italian)
skills/
└── intervals-coach/    # Agent Skill: coaching protocols (SKILL.md + references/)
```

Tests live in `__tests__` folders next to the code they cover. Each registration function in `src/mcp/tools/` receives the `McpServer`; `registerFileTools` also receives the server options, because `upload_activity` depends on the upload policy. `server.ts` counts registrations and derives the read-only, destructive and open-world annotations from tool names, so a new tool is annotated correctly by following the existing naming (`get_`, `list_`, `delete_`, ...). Every new tool must also be added to a toolset in `src/mcp/toolsets.ts`: `createServer()` throws on a tool without one, and a test checks that each tool is in exactly one toolset. Tools called by the prompts or the skill belong in `core`.

## Troubleshooting

| Problem | Solution |
|---|---|
| `INTERVALS_API_KEY is required` | Set `INTERVALS_API_KEY` in the `env` block of the client configuration (or in the shell for `intervals-mcp-http`) |
| `intervals.icu 401` | Wrong or expired API key: regenerate it in Settings → Developer |
| `intervals.icu 404` | Invalid activity or athlete ID |
| `intervals.icu 429` | Rate limit (10 requests/s). The server retries short waits by itself; otherwise retry after the indicated seconds |
| `401 unauthorized` on `/mcp` | `MCP_AUTH_TOKEN` is missing or differs from the one in the connector URL |
| `get_fatigue_resistance` returns no fatigued curve | Set the kJ threshold (`after_kj0`) in the sport settings on intervals.icu. Curves can take a few minutes to recompute after the change |
| A tool does not respond | Check the internet connection and that intervals.icu is reachable |
| Claude Desktop does not list the tools | Restart Claude Desktop after editing `claude_desktop_config.json` |
| `MCP_AUTH_TOKEN must be at least 32 characters` | Generate a new token with `openssl rand -hex 32` and update the connector URL |
| `Unknown toolset(s) ...` at startup | A name in `INTERVALS_TOOLSETS` is misspelled; the message lists the valid ones |
| A tool from the tables is missing on the remote connector | Its toolset is not enabled: the HTTP default is `core,planning`. Add the toolset to `INTERVALS_TOOLSETS` (or use `all`) and restart; `/health` shows the active ones |
| Dates are off by one day around midnight | Set `INTERVALS_TIMEZONE` (e.g. `Europe/Rome`) or the `timezone` in the intervals.icu profile |

## License

[MIT](LICENSE)
