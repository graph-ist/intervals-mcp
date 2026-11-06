# Readiness rule

The one rule for daily readiness. It reads intervals.icu values only (readiness, HRV, resting HR, CTL, ATL) and is the same rule the training dashboard applies, so Claude and the dashboard give the same case. `get_readiness_check` computes it on the server (`src/analytics/readiness.ts`); this file documents what the tool does. Report the tool's case as it comes, do not recompute it. When the rule changes, change the tool, this file and the dashboard together.

## Data

`get_readiness_check` with no arguments evaluates today; with `date` it evaluates the last day with data on or before that date (the weekly review uses it for the first day of the week). It reads `get_wellness_data` fields `readiness`, `hrv`, `restingHR`, `ctl`, `atl` over the 70 days before.

## Computation

Work on the most recent day that has data, and state its date. For each of readiness, HRV and resting HR:

- **7-day mean**: the mean of that day and the 6 before it. Needs at least 4 values; otherwise report "insufficient data" for that metric.
- **Normal band**: the mean of the 60 days before that day (the day itself excluded), plus and minus half the sample standard deviation of those days. Needs at least 30 values; otherwise there is no band.
- **Position**: the 7-day mean is below, inside or above the band.

Form: TSB = CTL − ATL on that day.

Means and band limits are rounded to 0.1 before comparing, as in the dashboard.

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

The only exceptions outside the rule are in the tool's `severe_flags`, taken from the recovery index of the same day: HRV or resting HR with a z-score below −2, or SpO₂ below 93%. A severe flag justifies changing today's session even when the rule says 4. With SpO₂ below 93%, suggest seeing a doctor.

## What not to use

The Recovery Index (RI) and its `interpretation_guidance` are this server's own construct, not intervals.icu values. Do not decide on them, and do not report the RI in place of intervals.icu's readiness. If the user asks for it, report it as a secondary index and say so.
