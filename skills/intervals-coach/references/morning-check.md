# Morning check

A red-flag scan, not a daily decision. Its only question: does anything justify deviating from the plan set in the weekly review?

## Steps

1. Call `get_recovery_index` with the default history (30 days). Use `today` for the current state and `history` (last 7 days) for multi-day patterns.
2. If the user wants the planned session, call `get_events` for today with `category: "WORKOUT"`.
3. Apply the rules below in order and stop at the first that matches.

## Rules

Default: if the recovery index (RI) is between 55 and 80 and there is no multi-day anomaly, the plan is executed as written.

Intervene only if one of these holds:

1. RI below 40 today.
2. Multi-day pattern: at least 3 consecutive days below baseline on at least 2 independent metrics, one autonomic (HRV, resting HR, Baevsky SI) and one structural or subjective (sleep, fatigue, soreness).
3. A single severe red flag: HRV z below -2.0, resting HR z below -2.0, or SpO₂ below 93%.

A single day of RI between 40 and 55 without a pattern is noted and the plan is executed. RI above 80 for several days is not a reason to add load: it is noted for the weekly review.

Z-scores are oriented so that negative means worse for every metric, including resting HR (a resting-HR z of -2 means HR is elevated).

## Output

- RI today with its status label.
- Red flags, or the sentence "No anomalies, execute the plan" in the user's language.
- Only when a rule matched: one specific, reversible change to today's session (for example "replace the Z4 intervals with 60 min Z2"), and the rule that triggered it.

Do not write the change to the calendar unless the user asks for it after seeing it.
