# Reading the analysis outputs

## Order of authority

1. `interpretation_guidance.decision_rules` (recovery) and the protocol rules in this skill decide what to do.
2. `reference_ranges` describe the state of a value: report the label and its meaning.
3. General knowledge comes last and never overrides 1 or 2.

## Thresholds

Recovery index bands and decision rules use the same cut points: 80, 55 and 40. The label describes the day; a change to the plan still needs the multi-day pattern, except below 40. SpO₂ appears in `red_flags` only below 93%; 93-94% is labelled low in `reference_ranges` and is watched, not acted on.

## Z-scores

Recovery metrics are z-scored against an individual 30-day baseline and oriented so that negative is worse for every metric. HRV is log-transformed before scoring. Status: green at z ≥ -0.5, amber from -1.5 to -0.5, red below -1.5. Trend arrows compare the first and second half of the last 7 days.

## ACWR

`acwr` uses intervals.icu's EWMA ATL/CTL (7/42 days); `acwr_rolling_7_28` is Gabbett's original rolling definition. The thresholds come from team sports and the predictive value of ACWR is contested (Impellizzeri et al., 2020). Report it as a load trend, never as a probability of injury.

## Baevsky stress index

Absolute values depend on the device algorithm (some report 50-500, others 2-10). Read only its z-score and trend against the athlete's own baseline.

## Data prerequisites

When a tool returns little or nothing, check these before concluding there is no signal:

- Subjective wellness (mood, motivation, fatigue, soreness, stress, injury) must be enabled in the athlete's wellness fields. The scales run from 1 to 4, where 1 is the best value.
- `get_fatigue_resistance` needs the kJ threshold `after_kj0` in the sport settings; curves can take minutes to recompute after a change.
- Decoupling and dFRC need a power stream.
- DFA α1 thresholds need beat-to-beat RR data from a chest strap; the tool is not registered by default.

## References

Impellizzeri, F. M., Tenan, M. S., Kempton, T., Novak, A., & Coutts, A. J. (2020). Acute:chronic workload ratio: Conceptual issues and fundamental pitfalls. *International Journal of Sports Physiology and Performance, 15*(6), 907-913. https://doi.org/10.1123/ijspp.2019-0864

Plews, D. J., Laursen, P. B., Kilding, A. E., & Buchheit, M. (2012). Heart rate variability in elite triathletes, is variation in variability the key to effective training? A case comparison. *European Journal of Applied Physiology, 112*(11), 3729-3741. https://doi.org/10.1007/s00421-012-2354-4
