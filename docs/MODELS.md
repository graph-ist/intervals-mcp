# Mathematical Models — References and Implementation Choices

A concise documentation of the physiological models implemented in the custom tools `get_activity_dfrc`, `get_metabolic_profile`, `get_recovery_index`, `get_training_load_risk`, `get_aerobic_decoupling`, `get_fatigue_resistance`, `get_dfa_alpha1`, `get_polarization_analysis` and `get_longitudinal_trends`, with references to the scientific literature and a critical contextualisation.

---

## 1. `get_activity_dfrc` — W'bal (dFRC)

### Model

Instantaneous balance of the anaerobic work capacity (W') during an activity, known as **W'bal** or **dFRC** (differential Functional Reserve Capacity).

$$
W'_{bal}(t) = \begin{cases}
W'_{bal}(t-1) - (P - CP) \cdot \Delta t & \text{if } P > CP \\[6pt]
W' - (W' - W'_{bal}(t_{prev})) \cdot e^{-(CP - P) \cdot \Delta t / W'} & \text{if } P \leq CP
\end{cases}
$$

- **Depletion** (above CP): linear, proportional to the excess power
- **Reconstitution** (below CP): exponential, with an effective τ that depends on $(CP - P)$

### Origin and literature

| Reference | Contribution |
|---|---|
| **Monod & Scherrer (1965)**. *The work capacity of a synergic muscular group.* Ergonomics, 8(3), 329–338. | Original 2-parameter CP model: $W = CP \cdot t + W'$. Hyperbolic power-duration relationship for maximal exercise. |
| **Morton (1996)**. *A 3-parameter critical power model.* Ergonomics, 39(4), 611–619. | Extension to 3 parameters with $P_{max}$: $P(t) = CP + W'/(t + \tau)$, where $\tau = W'/(P_{max} - CP)$. Incorporates the maximal instantaneous power. |
| **Skiba et al. (2012)**. *Modeling the expenditure and reconstitution of work capacity above critical power.* MSSE, 44(8), 1526–1532. | **Adopted model.** Introduces W'bal with exponential reconstitution. Validated on intermittent protocols in the laboratory ($r$ = 0.86 vs exhaustion measurements). |
| **Skiba et al. (2015)**. *Validation of a novel intermittent W' model for cycling using field data.* Int J Sports Physiol Perform, 10(6), 692–698. | Validation on field data (Garmin/SRM). Confirms the accuracy of the differential model in real conditions. |

### Critical context

The Skiba (2012) model is the most used on the platforms (WKO5, GoldenCheetah, intervals.icu) but has **known limitations**:

- **Overestimated reconstitution**: recent studies (Caen et al., 2019; Chorley et al., 2020) show that the real recovery of W' is slower and more incomplete than pure exponential, especially after deep depletions.
- **Constant τ**: the model assumes a fixed recovery kinetics. Caen et al. (2021) propose a variable τ that depends on the accumulated depletion and on the duration of the previous exercise.
- **Domain independence**: the model does not distinguish between the heavy and severe domains. Reconstitution in the severe domain is significantly slower (Vinetti et al., 2020).

> **Caen et al. (2019)**. *Reconstitution of W' depends on both work and recovery characteristics.* MSSE, 51(8), 1745–1751.
>
> **Chorley et al. (2020)**. *Methodological considerations for the determination of the reconstitution of W'.* Int J Sports Physiol Perform, 15(10), 1441–1448.

**Implementation choice**: we adopt Skiba (2012) because (a) it is the de facto gold standard on the analysis platforms, (b) it allows a direct comparison with the WKO5 and intervals.icu charts, (c) the alternative models require individual parameters that are not available via the API.

### Parameters

| Parameter | Source | Notes |
|---|---|---|
| CP | PD model from intervals.icu (`criticalPower`), otherwise FTP from the sport settings | W' must be paired with the CP with which it was estimated: using FTP in place of CP overestimates the depletion |
| W' (= FRC) | PD model (`wPrime`) or sport settings | 4 PD models available: MS_2P, MORTON_3P, FFT_CURVES, ECP |
| Streams | API `/activity/{id}/streams` | Power array + time array |

The output also includes `intervals_icu_max_wbal_depletion_joules`, the value computed by intervals.icu with its own parameters, as a reference: the differences come from the choice of CP/W', not from the formula.

The 4 PD models of intervals.icu differ in the estimate of W':

| Model | Formulation | Typical W' |
|---|---|---|
| **MS_2P** | $P = CP + W'/t$ (Monod-Scherrer) | Conservative |
| **MORTON_3P** | $P = CP + W'/(t + \tau)$ with $P_{max}$ | Includes instantaneous power |
| **FFT_CURVES** | Fit on MMP curves with FFT smoothing (intervals.icu proprietary) | Default in the intervals.icu UI |
| **ECP** | Extended CP — multi-component model | Typically higher W' |

---

## 2. `get_metabolic_profile` — VLaMax (Mader)

### Model

Three-component decomposition of the energy produced during maximal effort, derived from the bioenergetic model of **Mader (2003)**:

$$
P_{total}(t) = P_{aer}(t) + P_{PCr}(t) + P_{glyc}(t)
$$

#### Aerobic component (oxidative phosphorylation)

$$
P_{aer}(t) = MAP \cdot \left(1 - e^{-t/\tau_{VO_2}}\right)
$$

Mono-exponential kinetics of O₂ uptake. $MAP$ = Maximal Aerobic Power (power at 5 min from the MMP curve).

#### Alactic component (PCr system)

$$
P_{PCr}(t) = (P_{max} - MAP) \cdot e^{-t/\tau_{PCr}}
$$

Exponential decay of phosphocreatine. $P_{max}$ = maximal instantaneous power from the PD model.

#### Glycolytic (lactic) component — residual

$$
P_{glyc}(t) = P_{total}(t) - P_{aer}(t) - P_{PCr}(t)
$$

### VLaMax calculation

For each test duration $T \in \{10, 12, 15, 18, 20, 25, 30\}$ seconds:

$$
E_{total} = P(T) \cdot T
$$

$$
E_{aer} = MAP \cdot \left[T + \tau_{VO_2} \cdot \left(e^{-T/\tau_{VO_2}} - 1\right)\right]
$$

$$
E_{PCr} = (P_{max} - MAP) \cdot \tau_{PCr} \cdot \left(1 - e^{-T/\tau_{PCr}}\right)
$$

$$
E_{glyc} = \max\left(0, \ E_{total} - E_{aer} - E_{PCr}\right)
$$

$$
VLaMax(T) = \frac{E_{glyc}}{K \cdot m \cdot T} \quad [\text{mmol/L/s}]
$$

The VLaMax reported is the maximum over all $T$.

### Origin and literature

| Reference | Contribution |
|---|---|
| **Mader (2003)**. *Glycolysis and oxidative phosphorylation as a function of cytoplasmic phosphorylation state and power output of the muscle cell.* Eur J Appl Physiol, 88(4–5), 317–338. | **Founding model.** System of coupled differential equations for glycolytic and oxidative metabolism. Defines VLaMax as the maximal rate of lactate production of the muscle fibre. |
| **Heck & Schulz (2002)**. *Methoden der anaeroben Leistungsdiagnostik.* Deutsche Zeitschrift für Sportmedizin, 53(7–8), 202–212. | VLaMax ↔ performance relationship: VLaMax determines the anaerobic capacity but also the supra-threshold point at which lactate accumulates. |
| **Mader & Heck (1986)**. *A theory of the metabolic origin of anaerobic threshold.* Int J Sports Med, 7(S1), 45–65. | Original framework: the anaerobic threshold is the equilibrium point between production (VLaMax) and elimination (VO₂max) of lactate. VLaMax/VO₂max duality. |
| **Rossiter et al. (2002)**. *Dynamic asymmetry of phosphocreatine concentration and O₂ uptake between the on- and off-transients of moderate- and high-intensity exercise.* J Physiol, 541(3), 991–1002. | τ_VO₂ ≈ 25–40 s for trained subjects. Confirms mono-exponential on-transient kinetics. |
| **Haseler et al. (1999)**. *Phosphocreatine hydrolysis during submaximal exercise: the effect of FI_O₂.* J Appl Physiol, 87(6), 2013–2018. | τ_PCr ≈ 20–30 s (³¹P NMR). Confirms exponential PCr decay. |
| **Sundberg & Fitts (2019)**. *Bioenergetic basis of skeletal muscle fatigue.* Curr Opin Physiol, 10, 118–127. | Modern review: confirms the validity of the three-component framework for the energetic analysis of exercise. |

### Critical context

#### On the validity of the Mader model

The Mader (2003) model is **the most cited bioenergetic framework** for estimating VLaMax, adopted by:
- **INSCYD** (commercial platform, proprietary model based on Mader)
- **WKO5** (Kolie Moore model, a variant calibrated on blood samples, R² ≈ 0.95)
- Numerous WorldTour teams and Olympic programmes

Main limitations:

1. **Single-compartment simplification**: the model treats muscle as a single compartment. In reality, fibre recruitment (type I vs type II) and the distribution of blood flow influence the local lactate kinetics (Grassi & Quaresima, 2016).

2. **Residual as a proxy**: $P_{glyc}$ is computed as a residual, so errors in $P_{aer}$ or $P_{PCr}$ propagate entirely onto the glycolytic estimate. If τ_VO₂ is underestimated, VLaMax will be overestimated.

3. **Dependence on Pmax**: the estimate is extremely sensitive to $P_{max}$. Without recent maximal efforts in the MMP (all-out 5–15 s sprints), the power-duration curve underestimates Pmax and consequently VLaMax is distorted.

4. **Not individually validated**: unlike INSCYD (which requires 2–4 specific maximal tests + possibly blood lactate), our implementation has no individual calibration on lactate. The value of $K$ was calibrated on a single field test.

> **Grassi & Quaresima (2016)**. *Near-infrared spectroscopy and skeletal muscle oxidative function in vivo in health and disease.* Biomed Opt Express, 7(8), 3151–3172.

#### On the values of the time constants

| Constant | Adopted value | Literature range | Justification |
|---|---|---|---|
| $\tau_{VO_2}$ | **30 s** | 20–45 s | Centre of the range for trained cyclists (Rossiter et al., 2002; Whipp et al., 2002). Highly trained subjects → 20–25 s; less trained → 35–45 s. |
| $\tau_{PCr}$ | **23 s** | 15–30 s | NMR studies: 23 s is the median for severe exercise (Haseler et al., 1999; Forbes et al., 2009). Forbes reports 15–25 s for healthy subjects. |
| $K$ | **6.3** | — | **Empirical calibration constant.** Calibrated on the correspondence between the VLaMax estimated by the model and the VLaMax measured by a lactate field test (baseline: 0.34 mmol/L/s, September 2024). It is not a universal value. |

> **Whipp et al. (2002)**. *Pulmonary O₂ uptake during exercise: conflating muscular and cardiovascular responses.* MSSE, 34(9), 1518–1522.
>
> **Forbes et al. (2009)**. *Phosphocreatine recovery kinetics following low- and high-intensity exercise in human triceps surae and rat posterior hindlimb muscles.* AJP-Regul, 296(1), R161–R170.

### Comparison with commercial implementations

| | **Our implementation** | **INSCYD** | **WKO5** |
|---|---|---|---|
| **Base model** | Mader (2003) 3-component, residual | Mader (2003), complete ODE system | Kolie Moore, proprietary variant |
| **Input** | MMP curve + PD model from intervals.icu | 2–4 maximal tests (sprint + endurance) | Complete historical MMP |
| **Calibration** | $K = 6.3$ from a single lactate test | Optional blood lactate, multi-test | Regression on a large dataset (R² ≈ 0.95) |
| **τ_VO₂** | Fixed 30 s | Estimated from test data | Estimated from MMP |
| **τ_PCr** | Fixed 23 s | Estimated (≈24 s default) | Proprietary |
| **Expected accuracy** | ±15-20% without individual calibration | ±5-10% with the complete protocol | ±5-8% with a broad MMP |

### VLaMax classification

| VLaMax (mmol/L/s) | Classification | Typical profile |
|---|---|---|
| ≥ 0.80 | Very High | Pure sprinter (track, sprinters) |
| 0.60–0.79 | High | Explosive (criterium, CX) |
| 0.45–0.59 | Moderate | All-rounder (road) |
| 0.30–0.44 | Low | Endurance (gran fondo, triathlon) |
| < 0.30 | Very Low | Ultra-endurance (Ironman, ultra) |

Thresholds consistent with the INSCYD classifications and with the data published by Olbrecht (2000) and San Millán (2018).

> **Olbrecht (2000)**. *The Science of Winning.* Luton: F&G Partners.
>
> **San Millán & Brooks (2018)**. *Assessment of metabolic flexibility by means of measuring blood lactate, fat, and carbohydrate oxidation responses to exercise in professional endurance athletes and less-fit individuals.* Sports Med, 48(2), 467–479.

---

## 3. Energy System Contribution (breakdown)

### Model

Percentage distribution of energy for durations from 1 s to 2 h, computed as:

$$
\%_{aer}(t) = \frac{P_{aer}(t)}{P_{total}(t)} \times 100
$$

$$
\%_{PCr}(t) = \frac{P_{PCr}(t)}{P_{total}(t)} \times 100
$$

$$
\%_{glyc}(t) = 100 - \%_{aer}(t) - \%_{PCr}(t)
$$

### Reference literature

| Reference | Contribution |
|---|---|
| **Gastin (2001)**. *Energy system interaction and relative contribution during maximal exercise.* Sports Med, 31(10), 725–741. | **Fundamental review.** Quantifies the energy contributions for durations from 1 s to 30 min. Confirms: (a) PCr dominant < 6 s, (b) glycolytic peak at 15–30 s, (c) aerobic > 75% beyond 75 s. Our profiles are consistent with Figures 3–4. |
| **Spencer & Gastin (2001)**. *Energy system contribution during 200- to 1500-m running in highly trained athletes.* MSSE, 33(1), 157–162. | Direct measurements (EPOC + blood lactate) during competition: aerobic already ~30% in the 200 m and ~77% in the 800 m. |
| **Duffield et al. (2005)**. *Energy system contribution to 100-m and 200-m track running events.* J Sci Med Sport, 8(1), 62–69. | Contributions measured via indirect calorimetry + lactate. Confirms the three-component framework. |

### Note on validity

The percentage contributions are a **model estimate**, not a direct measurement. The physiological reality is more nuanced:

- The three systems are not sequential but **simultaneous** from the start (Gastin, 2001)
- The "residual" glycolytic contribution includes both true anaerobic glycolysis and modelling artefacts
- For durations > 5 min the anaerobic contribution becomes negligible and the decomposition loses practical meaning

---

## 4. `get_recovery_index` — Recovery & Readiness

Since version 0.3.0 the RI is no longer the basis of decisions in the prompts and in the skill: the reference is the intervals.icu readiness, read with the rule of section 4bis. From the RI only the serious alarms are used (z-score of HRV or resting HR below −2, SpO₂ below 93%).

### Model

A composite recovery index based on **individual z-scores** of the physiological metrics relative to the 30-day rolling baseline, combined by a weighted mean + sigmoid mapping.

#### Inputs (from the intervals.icu wellness API)

**Objective metrics** (from device/wearable):

| Metric | API field | Direction | Weight | Rationale |
|---|---|---|---|---|
| HRV (rMSSD) | `hrv` | ↑ = better | 3 | Gold standard for vagal tone (Plews et al., 2013) |
| Resting HR | `restingHR` | ↓ = better | 2 | Inversely correlated with recovery (Buchheit, 2014) |
| Avg Sleeping HR | `avgSleepingHR` | ↓ = better | 2 | More stable than the morning resting HR |
| Sleep Duration | `sleepSecs` | ↑ = better | 2 | Dose-response effect on recovery (Mah et al., 2011) |
| Sleep Score | `sleepScore` | ↑ = better | 2 | Device composite (duration + stages + disturbances) |
| Baevsky Stress Index | `baevskySI` | ↓ = better | 2 | Sympathetic activation (Baevsky & Berseneva, 2008). **Only z-score vs the personal baseline**: the absolute scale depends on the device (in the verified data 2.5–8, not 50–500) |
| SpO₂ | `spO2` | ↑ = better | 1 | Overtraining/altitude flag |
| Respiratory Rate | `respiration` | ↓ = better | 1 | Elevated with stress/fatigue (Nicolò et al., 2020) |

**Subjective metrics** (filled in by the athlete on intervals.icu, scale 1-4 where **1 is the best state**: mood 1 = Great, motivation 1 = Extreme, sleepQuality 1 = Great, fatigue/soreness/stress/injury 1 = Low/None):

| Metric | API field | Direction | Weight | Rationale |
|---|---|---|---|---|
| Mood | `mood` | ↓ = better | 1 | General emotional state |
| Motivation | `motivation` | ↓ = better | 1 | Desire to train |
| Sleep quality | `sleepQuality` | ↓ = better | 1 | Perceived sleep quality |
| Fatigue | `fatigue` | ↓ = better | 1 | Perceived residual fatigue |
| Soreness | `soreness` | ↓ = better | 1 | Muscle/joint pain |
| Stress | `stress` | ↓ = better | 1 | Perceived stress (work, life) |
| Injury | `injury` | ↓ = better | 1 | Ongoing discomfort/injuries |

**Graceful degradation**: if the subjective fields are not filled in, they are simply ignored. The index works just the same with only the device's objective data. When the subjective data are present, they add 6 points of collective weight (individual weight 1 × 6 metrics) to the calculation, for a significant but not dominant overall contribution relative to the physiological data (Saw et al., 2016).

#### Individual z-score

For each metric, on day $d$:

$$
z_{raw}(d) = \frac{x(d) - \bar{x}_{30}}{s_{30}}
$$

where $\bar{x}_{30}$ and $s_{30}$ are the mean and standard deviation of the previous 30 days (excluding the current day). For HRV the z-score is computed on $\ln(\text{rMSSD})$, because rMSSD has a log-normal distribution (Plews et al. 2012); `baseline_mean` is reported in ms (geometric mean).

For metrics where "lower is better" (restingHR, avgSleepingHR, baevskySI, respiration and all the subjective ones):

$$
z(d) = -z_{raw}(d)
$$

So $z > 0$ = always "better than usual", $z < 0$ = "worse than usual".

#### Per-metric traffic light

| z-score | Status |
|---|---|
| ≥ −0.5 | 🟢 Green (normal or above) |
| −1.5 to −0.5 | 🟡 Amber (below normal) |
| < −1.5 | 🔴 Red (significantly below) |

#### Composite Recovery Index (0–100)

Weighted mean → sigmoid mapping:

$$
\bar{z}_w = \frac{\sum_i w_i \cdot z_i}{\sum_i w_i}
$$

$$
\text{Recovery Index} = \frac{100}{1 + e^{-1.2 \cdot (\bar{z}_w + 0.5)}}
$$

The sigmoid is centred at $\bar{z}_w = -0.5$ (not at zero) to give RI ≈ 70 when everything is normal, RI ≈ 95 when everything is above the mean, and RI ≈ 30 when strongly below. The useful range is ~20–95.

| Recovery Index | Classification |
|---|---|
| ≥ 80 | Recovered — ready for intensity |
| 55–79 | Moderate — carry out the weekly plan |
| 40–54 | Strained — an isolated day does not change the plan; ≥3 days with ≥2 independent converging metrics: reduce the intensity |
| < 40 | At risk — active rest or a short Z1 session |

The bands are used only to describe the RI: decisions follow the readiness rule of section 4bis. Since version 0.4.0 the response no longer contains `interpretation_guidance`, which gave decision rules on the RI; in its place a `decision_basis` field points to `get_readiness_check`.

#### Red flags (alarms)

Conditions that generate an alert regardless of the RI:

| Condition | Threshold |
|---|---|
| HRV crash | z < −2.0 |
| Resting HR spike | z < −2.0 |
| Elevated Baevsky SI | z < −1.5 |
| Critical SpO₂ | < 93% (absolute value; 93–94% appears as "Low" in the reference_ranges, without a flag) |
| Systolic pressure | > 140 mmHg |
| Diastolic pressure | > 90 mmHg |

#### Trend (arrows)

7-day trend computed by comparing the mean of the first half vs the second half of the period:

$$
\Delta = \frac{\bar{x}_{second} - \bar{x}_{first}}{s_{30}}
$$

- $|\Delta| > 0.3$ in a favourable direction → ↑ (improvement)
- $|\Delta| > 0.3$ in an unfavourable direction → ↓ (worsening)
- Otherwise → → (stable)

### Reference literature

| Reference | Contribution |
|---|---|
| **Plews et al. (2013)**. *Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring.* Sports Med, 43(9), 773–781. | **Adopted approach.** HRV must be interpreted as a deviation from the individual baseline, not as an absolute value. The rolling mean and the coefficient of variation (CV) of HRV predict overreaching. |
| **Plews et al. (2012)**. *Heart rate variability in elite triathletes, is variation in variability the key to effective training?* Eur J Appl Physiol, 112(11), 3729–3741. | An increase in the CV of HRV (greater day-to-day variability) is a marker of cumulative fatigue, not only the drop in the mean. |
| **Buchheit (2014)**. *Monitoring training status with HR measures: do all roads lead to Rome?* Front Physiol, 5, 73. | Review: resting HR, HRV, HR recovery are complementary markers. Resting HR is less sensitive than HRV but more robust. A multi-metric approach is preferable. |
| **Baevsky & Berseneva (2008)**. *Methodical recommendations: use of kardivar system for determination of the stress level.* Moscow: IBMP. | Baevsky Stress Index (SI) = tension integral computed from the RR distribution. In the classic formulation SI > 150 = elevated sympathetic stress, but consumer devices report it on different scales: the tool applies no absolute thresholds. |
| **Nicolò et al. (2020)**. *Respiratory frequency as a marker of physical effort during high-intensity interval training.* Front Physiol, 11, 575. | The resting respiratory rate is a marker of autonomic stress. Elevated with residual fatigue and chronic sympathetic activation. |
| **Mah et al. (2011)**. *The effects of sleep extension on the athletic performance of collegiate basketball players.* Sleep, 34(7), 943–950. | Dose-response effect: extending sleep improves performance and reaction times. Chronic deprivation (< 7 h) compromises recovery and adaptation. |
| **Saw et al. (2016)**. *Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures.* Br J Sports Med, 50(5), 281–291. | Systematic review: subjective measures (mood, fatigue, soreness) are more sensitive to changes in training load than single objective measures. The combined approach is optimal. |

### Critical context

#### Differences from WHOOP Recovery

| | **Our implementation** | **WHOOP** |
|---|---|---|
| **Model** | Individual z-scores + weighted sigmoid | Proprietary (probably gradient boosting on a dataset of > 500k users) |
| **Input** | 8 metrics from device sync via intervals.icu | HRV, resting HR, respiratory rate, skin temperature, SpO₂, sleep stages |
| **Baseline** | 30-day rolling | Rolling (duration not public) |
| **Calibration** | None — purely individual statistics | Calibrated on outcomes (performance, illness, injury report) |
| **Skin temp** | Not available | Available (deviation = stress/illness) |
| **Sleep stages** | Only the composite score from the device | Deep, REM, light, awake (direct scoring) |

#### Strengths of our approach

1. **Total transparency**: every component is visible (z-score, weight, threshold). WHOOP is a black box.
2. **The device's `readiness` field** is included in the response as a comparison — the user can verify the correlation with our RI.
3. **Baevsky SI**: a metric not used by WHOOP, but well validated in the space medicine literature and then transferred to sport (Dong, 2016).

#### Limitations

1. **Subjective weights**: the weights (HRV=3, sleep=2, SpO₂=1) are based on relative clinical relevance in the literature, not calibrated on outcomes. A data-driven approach (e.g. regression on subsequent performance) would be more robust but requires a longitudinal dataset.
2. **Skin temperature missing**: an early marker of infection and overreaching, not available in the API.
3. **Arbitrary sigmoid**: the parameters (1.2, +0.5) are chosen to give an intuitive range of 20–95. There is no external validation.
4. **Optional subjective fields**: the fields `mood`, `motivation`, `fatigue`, `soreness`, `stress`, `injury` are now integrated (weight 1 each) with graceful degradation. If the athlete does not fill them in, the RI works just the same with only the objective data. When present, they improve predictivity (Saw et al., 2016).

> **Dong (2016)**. *The role of heart rate variability in sports physiology.* Exp Ther Med, 11(5), 1531–1536.

---

## 4bis. `get_readiness_check` — Readiness rule

### Purpose

intervals.icu is the main reference: the rule works only on values that intervals shows (readiness imported from the device, HRV, resting HR, CTL, ATL) and introduces no new index. It is the same rule as the training dashboard, implemented in `src/analytics/readiness.ts`; a comparison on 2000 random series with the dashboard's code gave the same case every time.

### Model

For readiness, HRV and resting HR, referred to the last day with data $d$:

- 7-day mean $\bar{x}_7$ over the days $d-6 \ldots d$, with at least 4 values;
- normal band $[\mu_{60} - s_{60}/2,\ \mu_{60} + s_{60}/2]$, with $\mu_{60}$ and $s_{60}$ (sample standard deviation) over the days $d-60 \ldots d-1$, with at least 30 values;
- the mean and the band limits are rounded to 0.1 before the comparison; position: below, within the band, above.

TSB $= \text{CTL} - \text{ATL}$ of day $d$, rounded to 0.1.

| Case | Condition (the first one applies) | Code |
|---|---|---|
| 1 | HRV below and resting HR above the band | `low`: low intensity |
| 2 | TSB below −30 | `tired`: consider a recovery day |
| 3 | At least one signal: HRV below, resting HR above or readiness below | `watch`: plan without adding intensity |
| 4 | Otherwise | `ok`: no contrary signal |

Values better than usual (HRV above, resting HR below, readiness above) are not signals. The tool adds the serious alarms of the same day's RI, which justify a change of session whatever the case.

### Critical context

1. **The 7-day mean** follows the indication to read HRV over windows of several days and not on the single value (Plews et al., 2012).
2. **The band of ± half a standard deviation** and the TSB threshold of −30 are conventions of use, not thresholds validated on outcomes (performance, illness, injury): the rule must be read as a signal of deviation from the individual norm, not as a prediction.
3. **Readiness** is a proprietary value of the device or the connected app; the rule compares it only with its own history, without interpreting its scale.
4. **Order of the cases**: case 1 precedes TSB, so a double autonomic signal prevails over load fatigue alone; it is a choice of priority, not an empirical result.

---

## 5. `get_training_load_risk` — Monotony, Strain, ACWR

### Model

#### Monotony and Strain (Foster 1998)

Computed on a rolling 7 days of load (daily TSS):

$$
\text{Monotony} = \frac{\bar{L}_{7d}}{\sigma_{L_{7d}}}
$$

$$
\text{Strain} = L_{week} \times \text{Monotony}
$$

- **Monotony** measures the uniformity of the load: an identical load every day (no recovery day) gives high monotony → illness/injury risk
- **Strain** = total load amplified by monotony

| Monotony | Risk |
|---|---|
| > 2.0 | High — excessive uniformity, associated with more illness (Foster 1998) |
| 1.5–2.0 | Moderate |
| < 1.5 | Low — well-varied load |

If the load is identical on all 7 days (standard deviation 0) the monotony is set to 10 (maximum), not to 0.

#### ACWR — Acute:Chronic Workload Ratio

Two versions in the output:

$$
ACWR_{EWMA} = \frac{ATL}{CTL} \qquad ACWR_{7:28} = \frac{\bar{L}_{7d}}{\bar{L}_{28d}}
$$

- `acwr`: ATL/CTL EWMA from intervals.icu (7- and 42-day constants), less subject to mathematical coupling (Lolli et al. 2019)
- `acwr_rolling_7_28`: Gabbett's original definition, for comparison with the literature

| ACWR | Zone | Meaning |
|---|---|---|
| < 0.80 | Undertraining | Deconditioning |
| 0.80–1.30 | **Sweet spot** | Acute load in line with the chronic |
| 1.30–1.50 | Danger zone | Acute load above usual |
| > 1.50 | Spike | Sudden increase |

The thresholds come from team sports and the predictive value of ACWR for injuries is contested (Impellizzeri et al. 2020): the tool no longer reports risk multipliers ("2×", "3-5×"), only the zone.

### Reference literature

| Reference | Contribution |
|---|---|
| **Foster (1998)**. *Monitoring training in athletes with reference to overtraining syndrome.* MSSE, 30(7), 1164–1168. | **Adopted model.** Monotony > 2.0 + elevated Strain predicts upper respiratory tract infections (URTI) with ~70% sensitivity in the following week. |
| **Foster et al. (2001)**. *Differences in perceptions of training by coaches and athletes.* South Afr J Sports Med, 8(2), 3–7. | Validation: Monotony + Strain as predictors of illness in 25 athletes over 6 months. |
| **Gabbett (2016)**. *The training—injury prevention paradox: should athletes be training smarter and harder?* Br J Sports Med, 50(5), 273–280. | **Adopted model.** ACWR on cricket, rugby, soccer data: the sweet spot 0.8-1.3 minimises the risk. Spiking > 1.5 increases the risk 2-4×. |
| **Hulin et al. (2014)**. *The acute:chronic workload ratio predicts injury: high chronic workload may decrease injury risk in elite rugby league players.* Br J Sports Med, 48(9), 708–712. | Validation on elite rugby: ACWR > 1.5 doubles the injury risk, but a high CTL (good fitness) is protective. |
| **Impellizzeri et al. (2020)**. *Acute:chronic workload ratio: conceptual issues and fundamental pitfalls.* Int J Sports Physiol Perform, 15(6), 907–913. | **Critique.** The rolling ratio (7d/28d) has spurious mathematical coupling. The EWMA (used by intervals.icu and by our implementation) reduces this bias. |
| **Lolli et al. (2019)**. *Mathematical coupling causes spurious correlation within the conventional acute-to-chronic workload ratio calculations.* Br J Sports Med, 53(15), 921–922. | Formal demonstration of the coupling. Recommends EWMA or alternative models. |

### Critical context

1. **ACWR is not universal**: originally validated on contact sports (rugby, cricket). Transferability to cycling (a non-contact sport) is less studied. The injury mechanisms in cycling are different (muscle-tendon overuse, not impact).

2. **The 0.8-1.3 thresholds are not absolute**: Gabbett himself (2020) clarified that they are guidelines, not rigid cut-offs. An athlete with a high CTL tolerates higher ACWRs (protective effect of fitness).

3. **Monotony requires interpretation**: a block of constant load (e.g. a training camp with 5 identical sessions) can have monotony > 2.0 and be intentional. The flag is a warning, not a prohibition.

> **Gabbett (2020)**. *Debunking the myths about training load, injury and performance: empirical evidence, hot topics and recommendations for practitioners.* Br J Sports Med, 54(1), 58–66.

---

## 6. `get_aerobic_decoupling` — Pw:Hr Drift

### Model

Comparison of the Efficiency Factor (EF) between the first and second half of a steady-state activity:

$$
EF = \frac{\bar{P}}{\overline{HR}}
$$

$$
\text{Decoupling (\%)} = \frac{EF_{1st\ half} - EF_{2nd\ half}}{EF_{1st\ half}} \times 100
$$

A positive decoupling indicates that in the second half HR rose (or power fell) relative to the first half → **cardiovascular drift** from aerobic fatigue or dehydration.

| Decoupling | Assessment |
|---|---|
| ≤ −3% | Negative drift — long warm-up, cooling or data to verify |
| −3% to < 3% | Excellent — solid aerobic base |
| 3–5% | Good — adequate base |
| 5–8% | Moderate — aerobic base to improve |
| ≥ 8% | Significant — aerobic fitness, pacing, heat or dehydration |

### Implementation

- **Warm-up/cool-down**: excludes the first 10 min and the last 5 min (configurable). For this reason the value may differ from that of intervals.icu, which uses the whole activity: the output reports both (`decoupling_pct`, `intervals_icu_decoupling_pct`). Verified on real data: with 0/0 exclusion the two values coincide within ~1-2 points.
- **Filter**: discards points with HR ≤ 0 or power ≤ 0
- **Validity**: warning if the Variability Index (NP/average power) > 1.05 or the analysed window < 60 min
- **EF curve**: rolling 30 s to visualise the drift over time

### Reference literature

| Reference | Contribution |
|---|---|
| **Friel (2009)**. *The Cyclist's Training Bible.* 4th ed. VeloPress. | Popularisation of the concept: decoupling < 5% as an indicator of an adequate aerobic base for endurance. Standard practice in structured coaching. |
| **Achten & Jeukendrup (2003)**. *Heart rate monitoring: applications and limitations.* Sports Med, 33(7), 517–538. | Review: the steady-state HR drift reflects thermoregulation, dehydration and muscle glycogen depletion. It is not a single mechanism. |
| **Coyle & González-Alonso (2001)**. *Cardiovascular drift during prolonged exercise: new perspectives.* Exerc Sport Sci Rev, 29(2), 88–92. | Cardiovascular drift is caused primarily by the reduction in stroke volume (not only by thermoregulation). HR compensates to maintain cardiac output. |
| **Coggan (2003)**. *Training and racing with a power meter.* Course. | EF = NP/HR as a metric of aerobic efficiency. The longitudinal trend (rising EF at the same power) indicates peripheral and central adaptation. |

### Critical context

1. **It is not specific**: a high decoupling may indicate (a) a poor aerobic base, (b) dehydration, (c) high ambient temperature, (d) a start that was too intense. The test is sensitive but not specific.
2. **Valid only in steady state**: in activities with many power variations (intervals, races), decoupling loses meaning. The tool should be used on constant Z2/Z3 rides.
3. **5% threshold**: empirical, from coaching, not from randomised studies. It is a useful convention but not a scientifically validated cut-off.

---

## 7. Coggan Power Profile and Fatigue Resistance Index

### Coggan Power Profile (Allen & Coggan 2010)

Classification of relative power (W/kg) at 4 key durations. The tool uses the published extremes of the table (Untrained minimum, World Class maximum), distinguished by sex (`sex` of the athlete profile), and divides the range into 8 equal bands, because the original table is nearly linear:

| Duration | Men min–max | Women min–max |
|---|---|---|
| 5 s | 10.17 – 24.04 | 8.17 – 19.42 |
| 1 min | 5.64 – 11.50 | 4.70 – 9.29 |
| 5 min | 2.33 – 7.60 | 1.87 – 6.61 |
| FTP | 1.86 – 6.40 | 1.50 – 5.69 |

The computed thresholds are in the output (`coggan_table`). The previous version used wrong values, especially at 5 s (6.3–17.1 W/kg), which clearly overestimated the sprint category.

> **Allen & Coggan (2010)**. *Training and Racing with a Power Meter.* 2nd ed. VeloPress. Table 3.3.

**Critical context**: the Coggan table is **the most used classification system in the world** in amateur and professional cycling. Limitations:
- Based on pre-2010 data, when power meters were less widespread → possible bias towards more trained athletes in the original dataset
- Not stratified by age or sex (separate women's tables exist)
- The "World Class" thresholds have been criticised as too low for modern professional cycling
- Does not distinguish between specialities (road, track, MTB)

### Fatigue Resistance Index (Pinot & Grappe 2015)

$$
FRI = \frac{FTP}{MAP} \times 100
$$

Measures the fraction of maximal aerobic power sustainable over time. It is an indicator of **sustainability** — complementary to VLaMax, which measures explosive capacity.

| FRI (%) | Classification | Profile |
|---|---|---|
| ≥ 82 | Excellent | GC contender, time-trial specialist |
| 78–81 | Good | Strong endurance |
| 74–77 | Moderate | Balanced |
| 70–73 | Low | Explosive, less sustainable |
| < 70 | Very low | Sprinter/puncheur |

> **Pinot & Grappe (2015)**. *A six-year monitoring case study of a top-10 cycling Grand Tour finisher.* J Sports Sci, 33(9), 907–914.
>
> **Pinot & Grappe (2011)**. *The record power profile to assess performance in elite cyclists.* Int J Sports Med, 32(11), 839–844.

**Relationship with VLaMax**: FRI and VLaMax are inversely correlated. An athlete with a low VLaMax (endurance) will have a high FRI (can sustain a greater fraction of MAP), and vice versa. Reporting both gives a dual view:
- VLaMax = glycolytic capacity (how much you can "push" above threshold)
- FRI = sustainability (how long you can hold the maximal aerobic power)

---

## Appendix: Power-Duration Model

The CP/W'/Pmax parameters come from the PD models of intervals.icu, not computed locally. The 4 available models:

| Model | Equation | Reference |
|---|---|---|
| MS_2P | $P = CP + W'/t$ | Monod & Scherrer (1965) |
| MORTON_3P | $P = CP + W'/(t + W'/(P_{max}-CP))$ | Morton (1996) |
| FFT_CURVES | FFT smoothing on MMP then fit | intervals.icu proprietary |
| ECP | Multi-component Extended CP | intervals.icu proprietary |

> The choice of PD model is decisive: MORTON_3P includes an explicit Pmax (useful for VLaMax), while MS_2P and FFT_CURVES may not expose it. The tool's toggle makes it possible to compare the effect of each model on the final estimate.

---

## 8. `get_fatigue_resistance` — Durability / FRS

### Model

Comparison between the power curve in **fresh** conditions and the power curve in **fatigued** conditions (after a certain amount of kJ of work), to quantify **durability** — the ability to maintain performance under prolonged fatigue.

$$
FRS = \frac{1}{n} \sum_{i=1}^{n} \frac{P_{fatigued}(t_i)}{P_{fresh}(t_i)} \times 100
$$

Where $t_i$ are 7 key durations: 5 s, 15 s, 1 min, 5 min, 10 min, 20 min, 60 min.

For each duration:

$$
\Delta\%(t) = \frac{P_{fatigued}(t) - P_{fresh}(t)}{P_{fresh}(t)} \times 100
$$

#### Key durations and energy systems

| Duration | Energy system | Meaning |
|---|---|---|
| 5 s | Neuromuscular (PCr) | Sprint capability under fatigue |
| 15 s | Anaerobic alactic | Residual explosive capacity |
| 1 min | Anaerobic capacity | Glycolysis under fatigue |
| 5 min | VO₂max | Residual maximal aerobic power |
| 10 min | Threshold | Sustainability of high intensity |
| 20 min | FTP | Functional power under fatigue |
| 60 min | Endurance | Durability proper |

#### FRS classification

| FRS (%) | Classification | Meaning |
|---|---|---|
| ≥ 95 | Excellent | Minimal loss under fatigue — strong endurance |
| 90–95 | Good | Acceptable fade, well-adapted musculature |
| 85–90 | Moderate | Room for improvement in fatigue resistance |
| < 85 | Low | Significant loss — work on the aerobic base |

### Implementation

- **Fresh curves**: `GET /athlete/{id}/power-curves?type={sport}&curves={period}`
- **Fatigued curves**: `GET /athlete/{id}/power-curves?type={sport}&curves={period}&fatigue=kj0`
- **Interpolation**: for durations not exactly present in the curve, linear interpolation between the two nearest points
- **VO₂max retention**: computed specifically at 5 min as a proxy of the residual maximal aerobic power

### Origin and literature

| Reference | Contribution |
|---|---|
| **Maunder et al. (2021)**. *The case for "durability" in endurance exercise performance.* J Appl Physiol, 131(3), 1226–1233. | **Adopted framework.** Defines durability as "time of onset and magnitude of deterioration of physiological profiling markers over time". Proposes the systematic study of the performance decline under progressive fatigue. |
| **Van Erp et al. (2021)**. *Pacing and power output during professional cycling.* Int J Sports Physiol Perform, 16(3), 349–355. | Race data: professional cyclists show a 5-15% drop in maximal power in the last hours of a stage. |
| **Clark et al. (2019)**. *The effect of prior exercise on O₂ uptake kinetics during high-intensity cycling.* Med Sci Sports Exerc, 51(2), 343–351. | VO₂ kinetics slow down after prolonged exercise, contributing to the drop in maximal aerobic power. |

### Critical context

1. **Definition of "fatigued"**: intervals.icu uses predefined kJ thresholds (kj0, kj1, kj2) that are not personalised to the individual. A 90 kg cyclist and a 60 kg one reach the same kJ threshold with very different relative efforts.

2. **It is not a direct test**: the MMP curves are built from historical training/race data, not from a controlled protocol. The composition of the activities (intensity, duration, weather) influences the result.

3. **Negative delta ≠ always "fatigue"**: a delta close to 0% or positive for very short durations (5 s) is normal — sprints do not degrade significantly after moderate aerobic work.

---

## 9. `get_dfa_alpha1` — DFA α1 Threshold Detection

> **Not implemented in the server.** The code, never registered as a tool, was removed in version 0.4.0 and can be recovered from commit `2af8bb6` (`src/analytics/dfa-alpha1.ts`). The section remains as a reference in case beat-to-beat RR intervals become available.

### Model

**DFA α1** (Detrended Fluctuation Analysis, exponent alpha1) measures the fractal correlation properties of the beat-to-beat RR intervals during exercise.

The DFA analysis computes the mean fluctuation $F(n)$ of the detrended RR signal at different time scales $n$, then estimates the exponent $\alpha_1$ from the relation:

$$
F(n) \propto n^{\alpha_1}
$$

Where $\alpha_1$ is estimated as the slope of the linear fit of $\log F(n)$ vs $\log n$ for short scales (4-16 beats).

#### Physiological meaning

| α1 | State | Physiological meaning |
|---|---|---|
| > 1.0 | Rest / very low intensity | Correlated cardiac dynamics, vagal dominance |
| 0.75 | **Aerobic threshold (VT1/AeT)** | Transition from correlated to random dynamics |
| 0.50–0.75 | Moderate-high intensity | Between aerobic and anaerobic threshold |
| 0.50 | **Anaerobic threshold (VT2/AnT)** | Transition towards anti-correlated dynamics |
| < 0.50 | Severe intensity | Above the anaerobic threshold |

#### Data source

1. **RR intervals** (`hrv` stream of intervals.icu, beat-to-beat ms): α1 computed by the tool. 120 s windows every 15 s, scales of 4–16 beats (Peng 1995), at least 100 beats per window. Artefacts: discard of RR < 250 or > 2000 ms and of beats that differ > 20% from the local median; windows with > 5% artefacts excluded (Rogers et al. 2021).
2. **Precomputed `dfa_a1` stream**, if present.

#### Threshold detection

As in Rogers et al. (2021): linear regression of HR (and power) on α₁ for the windows with 0.3 ≤ α₁ ≤ 1.25, then reading the value at α₁ = 0.75 (HRVT1) and α₁ = 0.50 (HRVT2). No extrapolation: if the activity does not cross the target value the threshold is not reported.

#### Confidence

From the r² of the HR–α₁ regression: ≥ 0.7 high, 0.4–0.7 medium, < 0.4 low. On non-ramp rides r² is typically low: the thresholds must be read as indicative.

Verified: white noise → α₁ ≈ 0.5, random walk → α₁ ≈ 1.5 (automatic tests).

### Device requirements

DFA α1 requires the **beat-to-beat RR intervals** recorded in the FIT file during exercise. intervals.icu exposes them as the `hrv` stream.

| Device | Compatible | Notes |
|---|---|---|
| Chest strap with RR (Polar H10, Garmin HRM-Pro/Dual, Wahoo TICKR) + a device that records RR | ✅ | On Garmin enable "Log HRV" |
| Polar H10 + apps that export RR in the FIT | ✅ | Gold standard for RR accuracy |
| Movesense + compatible app | ✅ | |
| **Apple Watch** | ❌ | No beat-to-beat RR in workouts |
| Optical wrist/arm sensors | ❌ | RR precision insufficient under effort |

### Origin and literature

| Reference | Contribution |
|---|---|
| **Rogers et al. (2021)**. *An evaluation of the relationship between heart rate variability and aerobic and anaerobic thresholds.* J Sports Sci Med, 20(2), 303–311. | **Adopted model.** Validates α1 = 0.75 as a proxy of ventilatory threshold VT1 and α1 = 0.50 as a proxy of VT2, comparing with lactate and spirometric tests. |
| **Gronwald et al. (2019)**. *Correlation properties of heart rate variability during endurance exercise.* Front Physiol, 10, 1202. | Theoretical framework: DFA α1 as a continuous measure of autonomic stress during exercise. |
| **Gronwald et al. (2020)**. *Dual or single? Physiological mapping based on DFA α1.* Int J Sports Med, 41(14), 1027–1035. | Proposes "DFA α1 physiological mapping" as an alternative to traditional tests to identify the intensity domains. |
| **Peng et al. (1995)**. *Quantification of scaling exponents and crossover phenomena in nonstationary heartbeat time series.* Chaos, 5(1), 82–87. | Original DFA methodology applied to RR series. |

### Critical context

1. **Ideal protocol**: DFA α1 is more reliable during a **ramp test** with gradual power increments. Steady-state activities or ones with intervals may not show clean crossings.

2. **Artefacts**: movement, loss of strap contact, and cardiac arrhythmias can generate spurious α1 values. The tool filters values 0 < α1 < 2.0 and requires at least 30 valid points.

3. **Day-to-day variability**: the DFA thresholds vary with recovery state, caffeine, temperature, and other factors. A single test is not definitive — better to repeat it 2-3 times.

4. **Not validated for running**: most DFA α1 studies are on cycling. In running, movement artefacts are more significant.

---

## 10. `get_polarization_analysis` — Training Intensity Distribution

### Model

Aggregates the time in the intensity zones across all activities of a period and sport, computing the distribution between low, medium and high intensity.

#### Intensity groups (Seiler's 3-zone model)

$$
\text{Low} = Z1 + Z2 \ (< LT1) \qquad \text{Mid} = Z3 + Z4 \ (LT1\text{–}LT2) \qquad \text{High} = Z5+ \ (> LT2)
$$

Mapping valid for the 7 Coggan power zones (Z4 = threshold 91–105% FTP) and the 7 Friel HR zones (Z5a starts at LTHR). The previous version put Z4 (threshold) in the high zone, overestimating the high intensity.

#### Polarization Index (Treff et al. 2019)

$$
PI = \log_{10}\left(\frac{f_1}{f_2} \cdot f_3 \cdot 100\right)
$$

with $f_i$ the fractions of time in the 3 zones; $f_2 = 0$ replaced by 0.01; PI not computable if $f_3 = 0$. **PI > 2.00 = polarized.**

#### Distribution models

| Model | Condition |
|---|---|
| **Polarized** | $f_1 > f_3 > f_2$ and PI > 2.00 |
| **Pyramidal** | $f_1 > f_2 > f_3$ |
| **Threshold** | $f_2$ maximum |
| **HIIT** | $f_3$ maximum |
| **Base** | Everything else (low intensity dominant) |

### Origin and literature

| Reference | Contribution |
|---|---|
| **Seiler (2010)**. *What is best practice for training intensity and duration distribution in endurance athletes?* Int J Sports Physiol Perform, 5(3), 276–291. | **Adopted framework.** Fundamental review: elite endurance athletes converge on a ~80/20 distribution (low/high intensity) with minimal Z3. |
| **Stöggl & Sperlich (2015)**. *Polarized training has greater impact on key endurance variables than threshold, high-intensity, or high-volume training.* Front Physiol, 6, 295. | Controlled study on 48 athletes: the polarized model produces the greatest increase in VO₂max and TTE compared with threshold, HIIT and volume training. |
| **Hydren & Cohen (2015)**. *Current scientific evidence for a polarized cardiovascular endurance training model.* J Strength Cond Res, 29(12), 3523–3530. | Systematic review: moderate evidence in favour of the polarized model, but the optimal distribution varies with the athlete's level and the phase of the season. |
| **Muñoz et al. (2014)**. *Does polarized training improve performance in recreational runners?* Int J Sports Physiol Perform, 9(2), 265–272. | Benefits of polarization also in recreational runners, not only elite. |

### Critical context

1. **Different zones per sport**: the tool uses power zones for cycling and HR zones for running. HR zones are less precise (lag, drift, day-to-day variability).

2. **80/20 is not universal**: the optimal distribution depends on the training phase (base → more Z2, build → more Z4), on the athlete's level, and on the sport. The pyramidal distribution is just as effective for many athletes (Stöggl & Sperlich, 2015).

3. **Z3 is not always a "black hole"**: for cyclists with a high FTP, time in Z3 (sweet spot) is a legitimate strategy to maximise the stimulus with limited time. The criticism of Z3 is more relevant for athletes with > 12 h/week of training.

4. **Zone rounding**: the zones in intervals.icu may have 5, 6 or 7 levels depending on the settings. The tool normalises to Z1-Z7 with zero-padding.

---

## 11. `get_longitudinal_trends` — Trend Analysis + HRR

### Model

Linear regression on time series of key metrics to detect **trends of progression, stagnation or overtraining** in the analysed period.

For each metric, given $n$ points $(d_i, v_i)$ where $d_i$ is the offset in days from the start date:

$$
v = \beta_0 + \beta_1 \cdot d
$$

$$
\beta_1 = \frac{n \sum d_i v_i - \sum d_i \sum v_i}{n \sum d_i^2 - (\sum d_i)^2}
$$

The weekly trend is $\beta_1 \times 7$.

#### Tracked metrics

**From activities**:

| Metric | Source | Direction | Meaning |
|---|---|---|---|
| Efficiency Factor | `icu_efficiency_factor` (NP/average HR from intervals.icu), otherwise `icu_weighted_avg_watts / average_heartrate` | ↑ = better | Aerobic efficiency (Coggan, 2003) |
| Heart Rate Recovery | `icu_hrr.hrr` (object, HR drop in bpm) | ↑ = better | Post-effort parasympathetic reactivation |
| Average Power | `icu_average_watts` | ↑ = better | Average power per session |
| Normalized Power | `icu_weighted_avg_watts` | ↑ = better | Normalized power |
| Decoupling | `decoupling` | ↓ = better | Cardiovascular drift |
| Training Load | `icu_training_load` | neutral | Load per session (TSS) |

**From wellness**:

| Metric | Source | Direction | Meaning |
|---|---|---|---|
| CTL (Fitness) | `ctl` | ↑ = better | Chronic load, fitness proxy |
| ATL (Fatigue) | `atl` | neutral | Acute load |
| TSB (Form) | `ctl - atl` | neutral | Fitness/fatigue balance |
| HRV (rMSSD) | `hrv` | ↑ = better | Heart rate variability |
| Resting HR | `restingHR` | ↓ = better | Resting heart rate |
| Weight | `weight` | neutral | Body weight |
| Sleep | `sleepSecs / 3600` | ↑ = better | Hours of sleep |

#### Direction determination

- **Stable**: |slope_per_week| < 1% of the mean, **or r² < 0.1** (the line explains less than 10% of the variance: noise)
- **Improving/Declining**: based on the direction of the slope relative to the metric's `betterDirection`
- **change_abs / change_pct**: change between the start and end **of the regression line** (not between two single points). `change_pct` is `null` for metrics that can be ≤ 0 (decoupling, TSB)
- **Sport**: "Ride" includes VirtualRide, GravelRide, MountainBikeRide; "Run" includes VirtualRun, TrailRun

#### Automatic flags

The tool generates contextual alerts:

| Condition | Flag |
|---|---|
| CTL ↑ > 10% | "Fitness trending up — good progression" |
| HRV ↓ > 15% | "HRV declining — monitor recovery, possible overreaching" |
| Resting HR ↓ > 5% | "Cardiovascular fitness improving" |
| HRR ↑ | "Better parasympathetic reactivation" |
| HRR ↓ | "Possible fatigue accumulation or detraining" |
| EF ↑ > 5% | "Aerobic base developing well" |

### Heart Rate Recovery (HRR) — Focus

HRR measures the drop in heart rate in the 60 seconds after the end of an effort. A higher HRR (faster drop) indicates better parasympathetic reactivation.

$$
HRR_{60s} = HR_{peak} - HR_{60s\ post}
$$

intervals.icu computes HRR automatically (`icu_hrr`) for activities that have an identifiable cool-down.

| HRR (bpm) | Classification |
|---|---|
| > 40 | Excellent — very good vagal reactivation |
| 30–40 | Good |
| 20–30 | Normal |
| < 20 | Low — possible residual fatigue, overtraining, or deconditioning |

### Origin and literature

| Reference | Contribution |
|---|---|
| **Daanen et al. (2012)**. *Systematic review on heart rate recovery to monitor changes in training status in athletes.* Int J Sports Physiol Perform, 7(3), 251–260. | **Adopted HRR framework.** Systematic review: post-exercise HRR is a reliable marker of aerobic fitness and responds quickly to changes in training load. A drop in HRR over time signals overreaching. |
| **Lamberts et al. (2009)**. *Day-to-day changes in heart rate, RPE and performance during a 2-week overload period in endurance cyclists.* Br J Sports Med, 43(11), 813–817. | The Lamberts Sub-Maximal Cycling Test (LSCT) uses HRR as the primary indicator: a drop > 3 bpm/week predicts functional overreaching. |
| **Buchheit (2014)**. *Monitoring training status with HR measures.* Front Physiol, 5, 73. | Review: HRR, sub-maximal HR and HRV are complementary markers for training monitoring. HRR is more sensitive than sub-maximal HR in detecting overreaching. |
| **Cole et al. (1999)**. *Heart-rate recovery immediately after exercise as a predictor of mortality.* N Engl J Med, 341(18), 1351–1357. | Landmark study: HRR < 12 bpm at the 1st minute post-exercise is an independent predictor of mortality (even in asymptomatic subjects). |

### Critical context

1. **Linear regression**: it is the simplest model and may miss non-linear trends (e.g. a plateau followed by a decline). For periods > 6 months, a segmented model would be more appropriate.

2. **Auto-calculated HRR**: the `icu_hrr` field of intervals.icu depends on the automatic identification of the end-of-effort point, which may be imprecise for activities with poorly defined cool-downs.

3. **Seasonality**: metrics such as weight, HRV and CTL have seasonal components. An apparent trend over 90 days may simply reflect a phase transition (e.g. base → build).

4. **Confounders**: average power per session may rise because more intervals are done (not because one is stronger). EF is a more robust indicator of true efficiency.

5. **Minimum threshold**: the tool requires ≥ 3 data points per metric to compute a trend. With fewer points, the metric is omitted.

---

## 12. `get_cp_history` — CP, W' and Pmax month by month

### Model

For each calendar month of the window (12 by default, the current month up to today) the tool asks intervals.icu for the power curve of that period only (`r.YYYY-MM-01.YYYY-MM-end`) in a single call. For each curve intervals.icu returns the power-duration models already fitted: MS_2P (CP and W'), MORTON_3P (CP, W', Pmax), FFT_CURVES and ECP. For each month the tool reports the chosen model (MORTON_3P by default) and all the others, the peaks at 5 s, 1 min, 5 min and 20 min, the number of activities that make up the curve and the change in CP, W' and Pmax between the first and last month with data. Months without rides do not appear in intervals.icu's response: the tool matches the curves by `id` and lists them as months without data.

### Critical context

1. **A month is fitted only on its own best efforts.** If the month lacks maximal efforts between about 3 and 20 minutes, the CP comes out lower than the real one; W' and Pmax require short all-out efforts. A low CP in a month of only Z2 work describes the training done, not a loss of form: it must be read together with the peaks and the number of activities.
2. **The models diverge** especially on W' (in the same month MS_2P and ECP may differ by thousands of joules), because they use different points of the curve. Comparison over time makes sense only with the same model.
3. **No laboratory test**: the values are estimates from training and race data, like intervals.icu's eFTP.
