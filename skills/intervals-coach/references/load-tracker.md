# Load tracker

A tracker of weekly TSS against target, not an analysis: no risk assessment, no training advice, no recovery index.

## Steps

1. Call `get_load_tracker` with the defaults (the previous week, the current one and the next 11).
2. Draw the chart as `chart_hint` describes: stacked vertical columns on a weekly axis, the previous week first, then the current week (highlighted), then the following ones. Colour segments from `actual_tss_by_sport` (swim, bike, run, strength) with a legend; `target_tss` as an outline or marker. For the current week add the daily `cumulative_tss` profile and `tss_per_day_needed`. Where the client cannot render charts, use a compact table with the same columns.
3. Below the chart, at most three lines: the current week against the days elapsed (with `plan_compliance`: workouts completed of those planned so far), and how many weeks still have no target.

## Rules

- Weeks with `target_tss` null stay empty. That is normal when the plan has not been written yet: do not ask for targets and do not invent them.
- Only swim, bike, run and strength count. Every other activity counts 0 and is not mentioned.
- Strength load is already weighted by the athlete's Activity Types fitness percentage in the response; do not reweight it.
