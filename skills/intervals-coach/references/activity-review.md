# Activity review

Analysis of the most recent endurance session.

## Finding the activity

1. Call `get_recent_activities` with `days: 1`. Keep only types Ride, Run, VirtualRide, VirtualRun and Swim; ignore WeightTraining, Pilates, Yoga and similar. Take the most recent.
2. If there is none, repeat with `days: 2`.
3. If there is still none, answer that no Ride, Run or Swim was found in the last 2 days, and stop.

If the user names an activity, use that one instead.

## Data

- `get_activity_detail` for the summary, zones and load.
- `get_activity_intervals` for laps, splits and structured intervals.
- With a power stream (rides, and runs with a power meter): `get_aerobic_decoupling` and `get_activity_dfrc`.
- Without power: decoupling and dFRC are not available. Say so in one line; do not substitute pace for power.

## Interval sessions: fade from rep to rep

When `get_activity_intervals` returns two or more intervals with `type: "WORK"` of similar duration (the same `group_id`, or durations within about 10%), compare the reps in order:

- `average_watts` (pace for runs without power) and `average_heartrate` of each rep;
- power fade: (last rep − first rep) / first rep, in %;
- HR drift at the same output: the change in `average_heartrate` with power within about 3%, and the ratio watts/bpm of each rep;
- `decoupling` of each rep, when present.

Read it plainly: power held and HR rising points to accumulating fatigue; power falling with HR flat or falling points to pacing or peripheral fatigue; both stable means the session was within capacity. With one rep, or reps of different lengths, say there is nothing to compare. These are descriptions of one session, not thresholds: do not turn a single fade into a change of plan.

## Output

- Summary and key metrics (duration, load, intensity, average and normalized power or pace, HR).
- Laps or splits and time in zones.
- For interval sessions, the rep-by-rep table and the fade described above.
- Decoupling and dFRC when computed, each read against its `reference_ranges`. Decoupling is meaningful only for steady sessions; for interval sessions, say that the value reflects the structure of the workout more than aerobic durability.
- Strengths and what to improve, each tied to a number above.
