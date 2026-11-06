---
name: intervals-coach
description: Training-analysis protocols for the intervals.icu MCP server (intervals-mcp). Use whenever the user asks about their own training, recovery, readiness, load, form, fitness trends or a recent session and the intervals.icu tools are available (get_readiness_check, get_training_load_risk, get_load_tracker, get_activity_detail, ...). Covers the morning check, the weekly review and plan, the post-activity review and the weekly TSS tracker, how to read the reference_ranges the analysis tools return, and when writes to the calendar need confirmation.
---

# intervals.icu coaching protocols

These protocols sit on top of the intervals-mcp tools. Tool names below are the bare names; in a client they may carry a connector prefix (for example `mcp__Coach__get_recovery_index`).

## Principles

1. **intervals.icu is the reference.** Its values (readiness, CTL, ATL, TSB, HRV, resting HR, zones, efficiency factor, decoupling) come first. The server's own indices (Recovery Index, ACWR, monotony, polarization, durability) fill what intervals.icu does not show; they never replace or contradict an intervals.icu value. Daily readiness follows one rule, the [readiness rule](references/readiness-rule.md), shared with the training dashboard.
2. **The week is the decision unit.** Volume, intensity and distribution are decided in the weekly review. Daily checks only look for exceptions that the weekly review defined in advance. Never turn a single day's value into a training prescription.
3. **Daily variance is noise.** HRV varies by ±15-20% within an individual at stable load (Plews et al., 2012). The readiness rule therefore compares 7-day means, not single days, with a 60-day normal band.
4. **Interpret with the response, not from memory.** Analysis tools return `reference_ranges`. For every number reported, state its range label and what it means for the athlete. The order of authority is in [references/interpretation.md](references/interpretation.md).
5. **Missing data stays missing.** If a tool says data is insufficient, or a field is null (no target, no power, no subjective wellness), say so and continue with what exists. Do not estimate, ask the user to make up values, or fill gaps with typical numbers.
6. **Writes need an explicit yes.** Analysis is read-only. Creating or changing calendar events, plans, wellness or settings happens only after the user has seen the exact change and agreed to it in this conversation. Propose changes that are specific and reversible (swap a Z4 session for Z2, not "rest more").
7. **Not medical advice.** Values the ranges mark as clinical (SpO₂ below 93%, blood pressure stage 2, persistent resting-HR elevation with illness symptoms) are reported with the suggestion to consult a doctor, without diagnosis.
8. **Style.** Reply in the user's language. No emoji. Lead with the decision or the state, then the evidence. Keep a morning check to a few lines.

## Which protocol

| The user asks | Protocol |
|---|---|
| "How am I today?", "Can I train hard?", morning readiness | [Morning check](references/morning-check.md) |
| Review of the week, planning the next one, "load or deload?" | [Weekly review](references/weekly-review.md) |
| "How did today's ride/run/swim go?", analysis of one session | [Activity review](references/activity-review.md) |
| Weekly TSS against targets, "am I on track this week?" | [Load tracker](references/load-tracker.md) |

The server exposes the same four as MCP prompts (`morning_check`, `weekly_review`, `activity_review`, `load_tracker`). They are only entry points: they name the tools and fill in the dates, and point back to the protocols here, which hold the rules.

## Questions outside the four protocols

| Question | Tool |
|---|---|
| How am I today, can I train hard? | `get_readiness_check` (or the full morning check) |
| How much did I ride, run or swim over a period? | `get_fitness_summary` |
| Raw daily wellness values | `get_wellness_data` |
| Am I increasing load too fast? | `get_training_load_risk` |
| Am I improving or declining? | `get_longitudinal_trends` |
| Is my intensity distribution polarized? | `get_polarization_analysis` |
| How well do I hold power under fatigue? | `get_fatigue_resistance` (needs `after_kj0` in sport settings) |
| Metabolic profile, VLaMax | `get_metabolic_profile` |
| Is my CP, W' or sprint changing over the season? | `get_cp_history` (read low months against their peaks: a month without maximal efforts understates CP) |
| Did I follow the plan this week? | `get_load_tracker`, field `plan_compliance` |

The server may register only some toolsets (by default `core` and `planning` on the remote connector). If a tool the user needs is missing (curves, gear, files, chats), say which toolset holds it (`curves`, `gear`, `files`, `social`) and that it is enabled with `INTERVALS_TOOLSETS`; do not imitate it with other tools.

Prefer one analysis tool over assembling the same answer from raw streams: the analysis tools already fetch, align and bound the data.
