# Reading the analysis outputs

## Order of authority

1. intervals.icu values (readiness, CTL, ATL, TSB, ramp rate, HRV, resting HR, zones, efficiency factor, decoupling) are the reference. The server's own indices complement them and never replace them.
2. The protocol rules in this skill decide what to do; for daily readiness that is the [readiness rule](readiness-rule.md).
3. `reference_ranges` describe the state of a value: report the label and its meaning.
4. General knowledge comes last and never overrides the above.

`get_recovery_index` returns its own `interpretation_guidance` with decision rules on the Recovery Index. Those rules are not the basis for decisions here: use the readiness rule, and take from `get_recovery_index` only the severe flags and which metric moved.

## Thresholds

Recovery Index bands use the cut points 80, 55 and 40; when the RI is reported, give its label as a secondary index. SpO₂ appears in `red_flags` only below 93%; 93-94% is labelled low in `reference_ranges` and is watched, not acted on.

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
