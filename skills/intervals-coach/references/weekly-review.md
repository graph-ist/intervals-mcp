# Weekly review and planning

The primary decision tool, usually on Sunday evening. Part 1 reviews the week just closed, part 2 sets the next one, including the exception criteria the morning checks will use.

The review period is the 7 days ending today, today included (`oldest` = today minus 6 days). If the user names another week, use that.

## Data

Call these in parallel; each covers one block of the review.

| Block | Tool and arguments |
|---|---|
| Volume per sport (hours, km, TSS) | `get_fitness_summary` with the review period |
| Load: CTL/ATL/TSB, ACWR, monotony, strain | `get_training_load_risk` (default 42 days) |
| Recovery on intervals.icu values: readiness, HRV, resting HR | `get_wellness_data` with `days: 74` and the fields of the [readiness rule](readiness-rule.md) |
| Severe flags of the week | `get_recovery_index` (default 30 days; use `history`) |
| Adherence: planned vs done | `get_events` with the review period and `category: "WORKOUT"`, plus `get_recent_activities` with `days: 7` |
| Intensity distribution | `get_polarization_analysis` with `days: 28` (one week is too short to classify; report the last week as part of the four) |
| Longitudinal trends: EF, HRR, power | `get_longitudinal_trends` (default 90 days) |
| Next week's plan | `get_events` for the next 7 days |

If a tool returns insufficient data, mark that block as unavailable and go on.

## Part 1: the week just closed

- Volume per sport.
- Load: CTL, ATL and TSB trend; ACWR; monotony and strain. Read ACWR as a trend indicator, not as an injury probability (see [interpretation.md](interpretation.md)).
- Recovery: the [readiness rule](readiness-rule.md) at the start and at the end of the week (7-day means against the normal band, and the sentence each day gives), and any severe flags. Do not decide on the Recovery Index.
- Adherence: sessions completed against planned, deviations and their reasons if the user gave them.
- Trends: EF, HRR and power where available.

## Part 2: the next week

- Current form (TSB) and CTL direction.
- Load, maintenance or deload week, justified with the data above.
- Target volume (hours or TSS) and intensity distribution (polarized 80/20 or pyramidal).
- Key sessions, each with its physiological aim.
- Daily exception criteria for this week: explicit thresholds that would justify a deviation, for example "if the morning check says 'keep intensity low' on 2 or more days, replace Thursday's Z4 with Z2". The morning checks apply these.

## Writing the plan

Present the plan in chat first. Create or change calendar events (`create_training_plan`, `update_event`, `apply_plan`) only after the user approves the concrete list of sessions and dates. Those tools overwrite or add many events at once.
