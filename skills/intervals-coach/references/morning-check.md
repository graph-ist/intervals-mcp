# Morning check

A scan, not a daily decision. Its only question: does anything justify deviating from the plan set in the weekly review? The reference is intervals.icu.

## Steps

1. Call `get_readiness_check` with no arguments. It applies the [readiness rule](readiness-rule.md) and returns the case and the severe flags.
2. If the user wants the planned session, call `get_events` for today with `category: "WORKOUT"`.

## Output

- Date of the data, today's readiness and TSB.
- HRV, resting HR and readiness: 7-day mean, normal band, position.
- The rule's case and its sentence, in the user's language.
- Severe flags, if any.
- Only when the rule is not 4 or a severe flag is present: one specific, reversible change to today's session (for example "replace the Z4 intervals with 60 min Z2"), and what triggered it.

Do not write the change to the calendar unless the user asks for it after seeing it.
