# Readiness rule

The one rule for daily readiness. It reads intervals.icu values only (readiness, HRV, resting HR, CTL, ATL) and is the same rule the training dashboard applies, so Claude and the dashboard give the same sentence. The MCP prompts `morning_check` and `weekly_review` carry a copy: when this file changes, change `src/mcp/prompts.ts` too.

## Data

`get_wellness_data` with `fields: ["id", "readiness", "hrv", "restingHR", "ctl", "atl"]` and enough days for the windows below: `days: 67` for one day, `days: 74` to evaluate a whole week.

## Computation

Work on the most recent day that has data, and state its date. For each of readiness, HRV and resting HR:

- **7-day mean**: the mean of that day and the 6 before it. Needs at least 4 values; otherwise report "insufficient data" for that metric.
- **Normal band**: the mean of the 60 days before that day (the day itself excluded), plus and minus half the sample standard deviation of those days. Needs at least 30 values; otherwise there is no band.
- **Position**: the 7-day mean is below, inside or above the band.

Form: TSB = CTL − ATL on that day.

When the client offers code execution, compute these with code rather than by hand: 60-value means and standard deviations are where mental arithmetic slips.

## Rule

Evaluate in order; the first that holds decides.

| # | Condition | Sentence |
|---|---|---|
| 1 | HRV below and resting HR above the band | Keep intensity low today |
| 2 | TSB below −30 | Accumulated fatigue is high: consider a recovery day |
| 3 | At least one signal out of band (HRV below, resting HR above, or readiness below) | Follow the plan without adding intensity |
| 4 | Otherwise | No signal against today's plan |

HRV above, resting HR below and readiness above the band are not signals against the plan.

## Severe flags

The only exceptions outside the rule come from `get_recovery_index`, today's values: HRV or resting HR with a z-score below −2, or SpO₂ below 93%. A severe flag justifies changing today's session even when the rule says 4. With SpO₂ below 93%, suggest seeing a doctor.

## What not to use

The Recovery Index (RI) and its `interpretation_guidance` are this server's own construct, not intervals.icu values. Do not decide on them, and do not report the RI in place of intervals.icu's readiness. If the user asks for it, report it as a secondary index and say so.
