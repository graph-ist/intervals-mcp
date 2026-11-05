# Modelli Matematici — Riferimenti e Scelte Implementative

Documentazione sintetica dei modelli fisiologici implementati nei tool custom `get_activity_dfrc`, `get_metabolic_profile`, `get_recovery_index`, `get_training_load_risk`, `get_aerobic_decoupling`, `get_fatigue_resistance`, `get_dfa_alpha1`, `get_polarization_analysis` e `get_longitudinal_trends`, con riferimenti alla letteratura scientifica e contestualizzazione critica.

---

## 1. `get_activity_dfrc` — W'bal (dFRC)

### Modello

Balance istantaneo della capacità di lavoro anaerobico (W') durante un'attività, noto come **W'bal** o **dFRC** (differential Functional Reserve Capacity).

$$
W'_{bal}(t) = \begin{cases}
W'_{bal}(t-1) - (P - CP) \cdot \Delta t & \text{se } P > CP \\[6pt]
W' - (W' - W'_{bal}(t_{prev})) \cdot e^{-(CP - P) \cdot \Delta t / W'} & \text{se } P \leq CP
\end{cases}
$$

- **Deplezione** (sopra CP): lineare, proporzionale alla potenza in eccesso
- **Ricostituzione** (sotto CP): esponenziale, con τ effettivo dipendente da $(CP - P)$

### Origine e letteratura

| Riferimento | Contributo |
|---|---|
| **Monod & Scherrer (1965)**. *The work capacity of a synergic muscular group.* Ergonomics, 8(3), 329–338. | Modello originale CP a 2 parametri: $W = CP \cdot t + W'$. Relazione iperbolica potenza-durata per esercizio massimale. |
| **Morton (1996)**. *A 3-parameter critical power model.* Ergonomics, 39(4), 611–619. | Estensione a 3 parametri con $P_{max}$: $P(t) = CP + W'/(t + \tau)$, dove $\tau = W'/(P_{max} - CP)$. Incorpora la potenza istantanea massima. |
| **Skiba et al. (2012)**. *Modeling the expenditure and reconstitution of work capacity above critical power.* MSSE, 44(8), 1526–1532. | **Modello adottato.** Introduce W'bal con ricostituzione esponenziale. Validato su protocolli intermittenti in laboratorio ($r$ = 0.86 vs misurazioni di esaurimento). |
| **Skiba et al. (2015)**. *Validation of a novel intermittent W' model for cycling using field data.* Int J Sports Physiol Perform, 10(6), 692–698. | Validazione su dati di campo (garmin/SRM). Conferma accuratezza del modello differenziale in condizioni reali. |

### Contesto critico

Il modello Skiba (2012) è il più usato nelle piattaforme (WKO5, GoldenCheetah, intervals.icu) ma presenta **limitazioni note**:

- **Ricostituzione sovrastimata**: studi recenti (Caen et al., 2019; Chorley et al., 2020) mostrano che il recupero reale di W' è più lento e incompleto rispetto all'esponenziale puro, specialmente dopo deplezioni profonde.
- **τ costante**: il modello assume una cinetica di recovery fissa. Caen et al. (2021) propongono un τ variabile dipendente dalla deplezione accumulata e dalla durata dell'esercizio precedente.
- **Indipendenza dal dominio**: il modello non distingue tra heavy e severe domain. La ricostituzione nel severe domain è significativamente più lenta (Vinetti et al., 2020).

> **Caen et al. (2019)**. *Reconstitution of W' depends on both work and recovery characteristics.* MSSE, 51(8), 1745–1751.
>
> **Chorley et al. (2020)**. *Methodological considerations for the determination of the reconstitution of W'.* Int J Sports Physiol Perform, 15(10), 1441–1448.

**Scelta implementativa**: adottiamo Skiba (2012) perché (a) è il gold standard de facto nelle piattaforme di analisi, (b) permette confronto diretto con i grafici di WKO5 e intervals.icu, (c) i modelli alternativi richiedono parametri individuali non disponibili via API.

### Parametri

| Parametro | Fonte | Note |
|---|---|---|
| CP | PD model da intervals.icu (`criticalPower`), altrimenti FTP da sport settings | W' va accoppiato al CP con cui è stato stimato: usare FTP al posto di CP sovrastima la deplezione |
| W' (= FRC) | PD model (`wPrime`) o sport settings | Disponibili 4 modelli PD: MS_2P, MORTON_3P, FFT_CURVES, ECP |
| Streams | API `/activity/{id}/streams` | Power array + time array |

L'output include anche `intervals_icu_max_wbal_depletion_joules`, il valore calcolato da intervals.icu con i propri parametri, come riferimento: le differenze vengono dalla scelta di CP/W', non dalla formula.

I 4 modelli PD di intervals.icu differiscono nella stima di W':

| Modello | Formulazione | Tipica W' |
|---|---|---|
| **MS_2P** | $P = CP + W'/t$ (Monod-Scherrer) | Conservativo |
| **MORTON_3P** | $P = CP + W'/(t + \tau)$ con $P_{max}$ | Include potenza istantanea |
| **FFT_CURVES** | Fit su curve MMP con FFT smoothing (proprietario intervals.icu) | Default UI intervals.icu |
| **ECP** | Extended CP — modello multi-componente | Tipicamente W' più alto |

---

## 2. `get_metabolic_profile` — VLaMax (Mader)

### Modello

Decomposizione tricomponenziale dell'energia prodotta durante sforzo massimale, derivata dal modello bienergetico di **Mader (2003)**:

$$
P_{total}(t) = P_{aer}(t) + P_{PCr}(t) + P_{glyc}(t)
$$

#### Componente aerobica (fosforilazione ossidativa)

$$
P_{aer}(t) = MAP \cdot \left(1 - e^{-t/\tau_{VO_2}}\right)
$$

Cinetica mono-esponenziale dell'uptake di O₂. $MAP$ = Maximal Aerobic Power (potenza a 5 min dalla curva MMP).

#### Componente alacida (sistema PCr)

$$
P_{PCr}(t) = (P_{max} - MAP) \cdot e^{-t/\tau_{PCr}}
$$

Decadimento esponenziale della fosfocreatina. $P_{max}$ = potenza istantanea massima dal modello PD.

#### Componente glicolitica (lattacida) — residuo

$$
P_{glyc}(t) = P_{total}(t) - P_{aer}(t) - P_{PCr}(t)
$$

### Calcolo VLaMax

Per ogni durata di test $T \in \{10, 12, 15, 18, 20, 25, 30\}$ secondi:

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

Il VLaMax riportato è il massimo su tutti i $T$.

### Origine e letteratura

| Riferimento | Contributo |
|---|---|
| **Mader (2003)**. *Glycolysis and oxidative phosphorylation as a function of cytoplasmic phosphorylation state and power output of the muscle cell.* Eur J Appl Physiol, 88(4–5), 317–338. | **Modello fondante.** Sistema di equazioni differenziali accoppiate per metabolismo glicolitico e ossidativo. Definisce VLaMax come tasso massimo di produzione di lattato della fibra muscolare. |
| **Heck & Schulz (2002)**. *Methoden der anaeroben Leistungsdiagnostik.* Deutsche Zeitschrift für Sportmedizin, 53(7–8), 202–212. | Relazione VLaMax ↔ performance: VLaMax determina la capacità anaerobica ma anche il punto di sopra-soglia in cui il lattato si accumula. |
| **Mader & Heck (1986)**. *A theory of the metabolic origin of anaerobic threshold.* Int J Sports Med, 7(S1), 45–65. | Framework originale: la soglia anaerobica è il punto di equilibrio tra produzione (VLaMax) ed eliminazione (VO₂max) di lattato. Dualità VLaMax/VO₂max. |
| **Rossiter et al. (2002)**. *Dynamic asymmetry of phosphocreatine concentration and O₂ uptake between the on- and off-transients of moderate- and high-intensity exercise.* J Physiol, 541(3), 991–1002. | τ_VO₂ ≈ 25–40s per soggetti allenati. Conferma cinetica mono-esponenziale on-transient. |
| **Haseler et al. (1999)**. *Phosphocreatine hydrolysis during submaximal exercise: the effect of FI_O₂.* J Appl Physiol, 87(6), 2013–2018. | τ_PCr ≈ 20–30s (NMR ³¹P). Conferma decadimento esponenziale PCr. |
| **Sundberg & Fitts (2019)**. *Bioenergetic basis of skeletal muscle fatigue.* Curr Opin Physiol, 10, 118–127. | Review moderna: conferma validità del framework tricomponenziale per l'analisi energetica dell'esercizio. |

### Contesto critico

#### Sulla validità del modello Mader

Il modello Mader (2003) è **il framework bienergetico più citato** per la stima di VLaMax, adottato da:
- **INSCYD** (piattaforma commerciale, modello proprietario basato su Mader)
- **WKO5** (modello Kolie Moore, variante calibrata su campioni ematici, R² ≈ 0.95)
- Numerosi team WorldTour e programmi olimpici

Limitazioni principali:

1. **Semplificazione mono-compartimentale**: il modello tratta il muscolo come compartimento unico. In realtà, il reclutamento delle fibre (tipo I vs tipo II) e la distribuzione del flusso ematico influenzano la cinetica locale del lattato (Grassi & Quaresima, 2016).

2. **Residuo come proxy**: $P_{glyc}$ è calcolato come residuo, quindi errori in $P_{aer}$ o $P_{PCr}$ si propagano interamente sulla stima glicolitica. Se il τ_VO₂ è sottostimato, VLaMax sarà sovrastimato.

3. **Dipendenza da Pmax**: la stima è estremamente sensibile a $P_{max}$. Senza sforzi massimali recenti nel MMP (sprint 5–15s all-out), la curva potenza-durata sottostima Pmax e di conseguenza VLaMax viene distorto.

4. **Non validato individualmente**: a differenza di INSCYD (che richiede 2–4 test massimali specifici + eventuale lattato ematico), la nostra implementazione non ha calibrazione individuale sui lattati. Il valore di $K$ è stato calibrato su un singolo test di campo.

> **Grassi & Quaresima (2016)**. *Near-infrared spectroscopy and skeletal muscle oxidative function in vivo in health and disease.* Biomed Opt Express, 7(8), 3151–3172.

#### Sui valori delle costanti temporali

| Costante | Valore adottato | Range letteratura | Giustificazione |
|---|---|---|---|
| $\tau_{VO_2}$ | **30 s** | 20–45 s | Centro del range per ciclisti allenati (Rossiter et al., 2002; Whipp et al., 2002). Soggetti molto allenati → 20–25s; meno allenati → 35–45s. |
| $\tau_{PCr}$ | **23 s** | 15–30 s | NMR studies: 23s è mediana per esercizio severo (Haseler et al., 1999; Forbes et al., 2009). Forbes riporta 15–25s per soggetti sani. |
| $K$ | **6.3** | — | **Costante di calibrazione empirica.** Calibrata sulla corrispondenza tra VLaMax stimato dal modello e VLaMax misurato da test lattacido di campo (baseline: 0.34 mmol/L/s, settembre 2024). Non è un valore universale. |

> **Whipp et al. (2002)**. *Pulmonary O₂ uptake during exercise: conflating muscular and cardiovascular responses.* MSSE, 34(9), 1518–1522.
>
> **Forbes et al. (2009)**. *Phosphocreatine recovery kinetics following low- and high-intensity exercise in human triceps surae and rat posterior hindlimb muscles.* AJP-Regul, 296(1), R161–R170.

### Confronto con implementazioni commerciali

| | **Nostra implementazione** | **INSCYD** | **WKO5** |
|---|---|---|---|
| **Modello base** | Mader (2003) 3-componenti, residuo | Mader (2003), sistema di ODE completo | Kolie Moore, variante proprietaria |
| **Input** | MMP curve + PD model da intervals.icu | 2–4 test massimali (sprint + endurance) | MMP storica completa |
| **Calibrazione** | $K = 6.3$ da singolo test lattacido | Lattato ematico opzionale, multi-test | Regressione su dataset ampio (R² ≈ 0.95) |
| **τ_VO₂** | Fisso 30s | Stimato da dati test | Stimato da MMP |
| **τ_PCr** | Fisso 23s | Stimato (≈24s default) | Proprietario |
| **Accuracy attesa** | ±15-20% senza calibrazione individuale | ±5-10% con protocollo completo | ±5-8% con MMP ampia |

### Classificazione VLaMax

| VLaMax (mmol/L/s) | Classificazione | Profilo tipico |
|---|---|---|
| ≥ 0.80 | Very High | Sprinter puro (pista, velocisti) |
| 0.60–0.79 | High | Esplosivo (criterium, CX) |
| 0.45–0.59 | Moderate | All-rounder (strada) |
| 0.30–0.44 | Low | Endurance (GF, triathlon) |
| < 0.30 | Very Low | Ultra-endurance (Ironman, ultra) |

Soglie coerenti con le classificazioni INSCYD e con i dati pubblicati da Olbrecht (2000) e San Millán (2018).

> **Olbrecht (2000)**. *The Science of Winning.* Luton: F&G Partners.
>
> **San Millán & Brooks (2018)**. *Assessment of metabolic flexibility by means of measuring blood lactate, fat, and carbohydrate oxidation responses to exercise in professional endurance athletes and less-fit individuals.* Sports Med, 48(2), 467–479.

---

## 3. Energy System Contribution (breakdown)

### Modello

Distribuzione percentuale dell'energia per durate da 1s a 2h, calcolata come:

$$
\%_{aer}(t) = \frac{P_{aer}(t)}{P_{total}(t)} \times 100
$$

$$
\%_{PCr}(t) = \frac{P_{PCr}(t)}{P_{total}(t)} \times 100
$$

$$
\%_{glyc}(t) = 100 - \%_{aer}(t) - \%_{PCr}(t)
$$

### Letteratura di riferimento

| Riferimento | Contributo |
|---|---|
| **Gastin (2001)**. *Energy system interaction and relative contribution during maximal exercise.* Sports Med, 31(10), 725–741. | **Review fondamentale.** Quantifica i contributi energetici per durate 1s–30min. Conferma: (a) PCr dominante < 6s, (b) glicolitico picco a 15–30s, (c) aerobico > 75% oltre 75s. I nostri profili sono coerenti con le Figure 3–4. |
| **Spencer & Gastin (2001)**. *Energy system contribution during 200- to 1500-m running in highly trained athletes.* MSSE, 33(1), 157–162. | Misurazioni dirette (EPOC + lattato ematico) durante competizione: aerobico già ~30% nei 200m e ~77% nei 800m. |
| **Duffield et al. (2005)**. *Energy system contribution to 100-m and 200-m track running events.* J Sci Med Sport, 8(1), 62–69. | Contributi misurati via calorimetria indiretta + lattato. Conferma il framework tricomponenziale. |

### Nota sulla validità

I contributi percentuali sono una **stima modellistica**, non una misura diretta. La realtà fisiologica è più sfumata:

- I tre sistemi non sono sequenziali ma **simultanei** dall'inizio (Gastin, 2001)
- Il contributo glicolitico "residuo" include sia la glicolisi anaerobica vera sia artefatti di modellizzazione
- Per durate > 5 min il contributo anaerobico diventa trascurabile e la decomposizione perde significato pratico

---

## 4. `get_recovery_index` — Recovery & Readiness

### Modello

Indice composito di recovery basato su **z-score individuali** delle metriche fisiologiche rispetto alla baseline rolling a 30 giorni, combinati tramite media pesata + mappatura sigmoidale.

#### Input (da wellness API intervals.icu)

**Metriche oggettive** (da device/wearable):

| Metrica | Campo API | Direzione | Peso | Razionale |
|---|---|---|---|---|
| HRV (rMSSD) | `hrv` | ↑ = meglio | 3 | Gold standard per tono vagale (Plews et al., 2013) |
| Resting HR | `restingHR` | ↓ = meglio | 2 | Inversamente correlato a recovery (Buchheit, 2014) |
| Avg Sleeping HR | `avgSleepingHR` | ↓ = meglio | 2 | Più stabile di resting HR mattutino |
| Sleep Duration | `sleepSecs` | ↑ = meglio | 2 | Effetto dose-risposta su recovery (Mah et al., 2011) |
| Sleep Score | `sleepScore` | ↑ = meglio | 2 | Composito device (durata + stadi + disturbances) |
| Baevsky Stress Index | `baevskySI` | ↓ = meglio | 2 | Attivazione simpatica (Baevsky & Berseneva, 2008). **Solo z-score vs baseline personale**: la scala assoluta dipende dal dispositivo (nei dati verificati 2.5–8, non 50–500) |
| SpO₂ | `spO2` | ↑ = meglio | 1 | Flag overtraining/altitudine |
| Respiratory Rate | `respiration` | ↓ = meglio | 1 | Elevata con stress/fatica (Nicolò et al., 2020) |

**Metriche soggettive** (compilate dall'atleta su intervals.icu, scala 1-4 dove **1 è lo stato migliore**: mood 1 = Great, motivation 1 = Extreme, sleepQuality 1 = Great, fatigue/soreness/stress/injury 1 = Low/None):

| Metrica | Campo API | Direzione | Peso | Razionale |
|---|---|---|---|---|
| Mood | `mood` | ↓ = meglio | 1 | Stato emotivo generale |
| Motivation | `motivation` | ↓ = meglio | 1 | Desiderio di allenarsi |
| Sleep quality | `sleepQuality` | ↓ = meglio | 1 | Qualità percepita del sonno |
| Fatigue | `fatigue` | ↓ = meglio | 1 | Percezione fatica residua |
| Soreness | `soreness` | ↓ = meglio | 1 | Dolori muscolari/articolari |
| Stress | `stress` | ↓ = meglio | 1 | Stress percepito (lavoro, vita) |
| Injury | `injury` | ↓ = meglio | 1 | Fastidi/infortuni in corso |

**Degradazione graceful**: se i campi soggettivi non sono compilati, vengono semplicemente ignorati. L'indice funziona ugualmente con i soli dati oggettivi del device. Quando i dati soggettivi sono presenti, aggiungono 6 punti di peso collettivo (peso individuale 1 × 6 metriche) al calcolo, per un contributo complessivo significativo ma non dominante rispetto ai dati fisiologici (Saw et al., 2016).

#### Z-score individuale

Per ogni metrica, il giorno $d$:

$$
z_{raw}(d) = \frac{x(d) - \bar{x}_{30}}{s_{30}}
$$

dove $\bar{x}_{30}$ e $s_{30}$ sono media e deviazione standard dei 30 giorni precedenti (escluso il giorno corrente). Per l'HRV lo z-score è calcolato su $\ln(\text{rMSSD})$, perché rMSSD ha distribuzione log-normale (Plews et al. 2012); `baseline_mean` è riportato in ms (media geometrica).

Per metriche dove "lower is better" (restingHR, avgSleepingHR, baevskySI, respiration e tutte le soggettive):

$$
z(d) = -z_{raw}(d)
$$

Così $z > 0$ = sempre "meglio del solito", $z < 0$ = "peggio del solito".

#### Semaforo per-metrica

| z-score | Status |
|---|---|
| ≥ −0.5 | 🟢 Green (nella norma o sopra) |
| −1.5 a −0.5 | 🟡 Amber (sotto la norma) |
| < −1.5 | 🔴 Red (significativamente sotto) |

#### Recovery Index composito (0–100)

Media pesata → mappatura sigmoidale:

$$
\bar{z}_w = \frac{\sum_i w_i \cdot z_i}{\sum_i w_i}
$$

$$
\text{Recovery Index} = \frac{100}{1 + e^{-1.2 \cdot (\bar{z}_w + 0.5)}}
$$

La sigmoide è centrata a $\bar{z}_w = -0.5$ (non a zero) per dare RI ≈ 70 quando tutto è nella norma, RI ≈ 95 quando tutto è sopra la media, e RI ≈ 30 quando fortemente sotto. Il range utile è ~20–95.

| Recovery Index | Classificazione |
|---|---|
| ≥ 80 | Recovered — pronto per intensità |
| 55–79 | Moderate — esegui il piano settimanale |
| 40–54 | Strained — un giorno isolato non cambia il piano; ≥3 giorni con ≥2 metriche indipendenti convergenti: ridurre l'intensità |
| < 40 | At risk — riposo attivo o sessione Z1 breve |

Le fasce coincidono con le regole di `interpretation_guidance` e del prompt `morning_check` (55–80 senza anomalie multigiorno: piano eseguito).

#### Red flags (allarmi)

Condizioni che generano alert indipendentemente dal RI:

| Condizione | Soglia |
|---|---|
| HRV crash | z < −2.0 |
| Resting HR spike | z < −2.0 |
| Baevsky SI elevato | z < −1.5 |
| SpO₂ critico | < 93% (valore assoluto; 93–94% compare come "Basso" nei reference_ranges, senza flag) |
| Pressione sistolica | > 140 mmHg |
| Pressione diastolica | > 90 mmHg |

#### Trend (frecce)

Trend a 7 giorni calcolato confrontando la media della prima metà vs la seconda metà del periodo:

$$
\Delta = \frac{\bar{x}_{second} - \bar{x}_{first}}{s_{30}}
$$

- $|\Delta| > 0.3$ in direzione favorevole → ↑ (miglioramento)
- $|\Delta| > 0.3$ in direzione sfavorevole → ↓ (peggioramento)
- Altrimenti → → (stabile)

### Letteratura di riferimento

| Riferimento | Contributo |
|---|---|
| **Plews et al. (2013)**. *Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring.* Sports Med, 43(9), 773–781. | **Approccio adottato.** L'HRV va interpretato come deviazione dalla baseline individuale, non come valore assoluto. La media rolling e il coefficiente di variazione (CV) dell'HRV predicono overreaching. |
| **Plews et al. (2012)**. *Heart rate variability in elite triathletes, is variation in variability the key to effective training?* Eur J Appl Physiol, 112(11), 3729–3741. | Un aumento del CV dell'HRV (maggiore variabilità giorno-giorno) è marker di affaticamento cumulativo, non solo il calo della media. |
| **Buchheit (2014)**. *Monitoring training status with HR measures: do all roads lead to Rome?* Front Physiol, 5, 73. | Review: resting HR, HRV, HR recovery sono marker complementari. Resting HR è meno sensibile di HRV ma più robusto. Approccio multi-metrica preferibile. |
| **Baevsky & Berseneva (2008)**. *Methodical recommendations: use of kardivar system for determination of the stress level.* Moscow: IBMP. | Baevsky Stress Index (SI) = integrale di tensione calcolato da distribuzione RR. Nella formulazione classica SI > 150 = stress simpatico elevato, ma i dispositivi consumer lo riportano su scale diverse: il tool non applica soglie assolute. |
| **Nicolò et al. (2020)**. *Respiratory frequency as a marker of physical effort during high-intensity interval training.* Front Physiol, 11, 575. | La frequenza respiratoria a riposo è marker di stress autonomico. Elevata con fatica residua e attivazione simpatica cronica. |
| **Mah et al. (2011)**. *The effects of sleep extension on the athletic performance of collegiate basketball players.* Sleep, 34(7), 943–950. | Effetto dose-risposta: estendere il sonno migliora performance e tempi di reazione. La deprivazione cronica (< 7h) compromette recovery e adattamento. |
| **Saw et al. (2016)**. *Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures.* Br J Sports Med, 50(5), 281–291. | Review sistematica: misure soggettive (mood, fatigue, soreness) sono più sensibili a cambiamenti di training load rispetto a misure oggettive singole. L'approccio combinato è ottimale. |

### Contesto critico

#### Differenze con WHOOP Recovery

| | **Nostra implementazione** | **WHOOP** |
|---|---|---|
| **Modello** | Z-score individuali + sigmoide pesata | Proprietario (probabilmente gradient boosting su dataset > 500k utenti) |
| **Input** | 8 metriche da device sync via intervals.icu | HRV, resting HR, respiratory rate, skin temperature, SpO₂, sleep stages |
| **Baseline** | Rolling 30 giorni | Rolling (durata non pubblica) |
| **Calibrazione** | Nessuna — puramente statistica individuale | Calibrato su outcome (performance, illness, injury report) |
| **Skin temp** | Non disponibile | Disponibile (deviazione = stress/illness) |
| **Sleep stages** | Solo score composito dal device | Deep, REM, light, awake (scoring diretto) |

#### Punti di forza del nostro approccio

1. **Trasparenza totale**: ogni componente è visibile (z-score, peso, soglia). WHOOP è una black box.
2. **Il campo `readiness`** dal device è incluso nella risposta come confronto — l'utente può verificare la correlazione con il nostro RI.
3. **Baevsky SI**: metrica non usata da WHOOP, ma ben validata nella letteratura di medicina spaziale e poi trasferita allo sport (Dong, 2016).

#### Limitazioni

1. **Pesi soggettivi**: i pesi (HRV=3, sleep=2, SpO₂=1) sono basati su rilevanza clinica relativa nella letteratura, non calibrati su outcome. Un approccio data-driven (es. regressione su performance successiva) sarebbe più robusto ma richiede un dataset longitudinale.
2. **Manca la temperatura cutanea**: marker precoce di infezione e overreaching, non disponibile nell'API.
3. **Sigmoide arbitraria**: i parametri (1.2, +0.5) sono scelti per dare un range intuitivo 20–95. Non c'è validazione esterna.
4. **Campi soggettivi opzionali**: i campi `mood`, `motivation`, `fatigue`, `soreness`, `stress`, `injury` sono ora integrati (peso 1 ciascuno) con degradazione graceful. Se l'atleta non li compila, il RI funziona ugualmente con i soli dati oggettivi. Quando presenti, migliorano la predittività (Saw et al., 2016).

> **Dong (2016)**. *The role of heart rate variability in sports physiology.* Exp Ther Med, 11(5), 1531–1536.

---

## 5. `get_training_load_risk` — Monotony, Strain, ACWR

### Modello

#### Monotony e Strain (Foster 1998)

Calcolati su rolling 7 giorni di load (TSS giornaliero):

$$
\text{Monotony} = \frac{\bar{L}_{7d}}{\sigma_{L_{7d}}}
$$

$$
\text{Strain} = L_{week} \times \text{Monotony}
$$

- **Monotony** misura l'uniformità del carico: un carico identico ogni giorno (nessun recovery day) dà monotony alta → rischio malattia/infortunio
- **Strain** = carico totale amplificato dalla monotonia

| Monotony | Rischio |
|---|---|
| > 2.0 | Alto — uniformità eccessiva, associata a più malattie (Foster 1998) |
| 1.5–2.0 | Moderato |
| < 1.5 | Basso — carico ben variato |

Se il carico è identico tutti i 7 giorni (deviazione standard 0) la monotony è fissata a 10 (massima), non a 0.

#### ACWR — Acute:Chronic Workload Ratio

Due versioni nell'output:

$$
ACWR_{EWMA} = \frac{ATL}{CTL} \qquad ACWR_{7:28} = \frac{\bar{L}_{7d}}{\bar{L}_{28d}}
$$

- `acwr`: ATL/CTL EWMA di intervals.icu (costanti 7 e 42 giorni), meno soggetto al coupling matematico (Lolli et al. 2019)
- `acwr_rolling_7_28`: definizione originale di Gabbett, per confronto con la letteratura

| ACWR | Zona | Significato |
|---|---|---|
| < 0.80 | Undertraining | Decondizionamento |
| 0.80–1.30 | **Sweet spot** | Carico acuto in linea con il cronico |
| 1.30–1.50 | Danger zone | Carico acuto sopra il solito |
| > 1.50 | Spike | Incremento brusco |

Le soglie vengono da sport di squadra e il valore predittivo dell'ACWR per gli infortuni è contestato (Impellizzeri et al. 2020): il tool non riporta più moltiplicatori di rischio ("2×", "3-5×"), solo la zona.

### Letteratura di riferimento

| Riferimento | Contributo |
|---|---|
| **Foster (1998)**. *Monitoring training in athletes with reference to overtraining syndrome.* MSSE, 30(7), 1164–1168. | **Modello adottato.** Monotony > 2.0 + Strain elevato predice upper respiratory tract infections (URTI) con sensibilità ~70% nella settimana successiva. |
| **Foster et al. (2001)**. *Differences in perceptions of training by coaches and athletes.* South Afr J Sports Med, 8(2), 3–7. | Validazione: Monotony + Strain come predittori di illness in 25 atleti su 6 mesi. |
| **Gabbett (2016)**. *The training—injury prevention paradox: should athletes be training smarter and harder?* Br J Sports Med, 50(5), 273–280. | **Modello adottato.** ACWR su dati di cricket, rugby, soccer: sweet spot 0.8-1.3 minimizza il rischio. Spiking > 1.5 aumenta il rischio 2-4×. |
| **Hulin et al. (2014)**. *The acute:chronic workload ratio predicts injury: high chronic workload may decrease injury risk in elite rugby league players.* Br J Sports Med, 48(9), 708–712. | Validazione su elite rugby: ACWR > 1.5 raddoppia il rischio infortunio, ma un CTL alto (buon fitness) è protettivo. |
| **Impellizzeri et al. (2020)**. *Acute:chronic workload ratio: conceptual issues and fundamental pitfalls.* Int J Sports Physiol Perform, 15(6), 907–913. | **Critica.** Il rolling ratio (7d/28d) ha coupling matematico spurio. L'EWMA (usato da intervals.icu e dalla nostra implementazione) riduce questo bias. |
| **Lolli et al. (2019)**. *Mathematical coupling causes spurious correlation within the conventional acute-to-chronic workload ratio calculations.* Br J Sports Med, 53(15), 921–922. | Dimostrazione formale del coupling. Raccomanda EWMA o modelli alternativi. |

### Contesto critico

1. **ACWR non è universale**: originariamente validato su sport di contatto (rugby, cricket). La trasferibilità al ciclismo (sport senza contatto) è meno studiata. I meccanismi di infortunio nel ciclismo sono diversi (overuse muscolo-tendinei, non impatto).

2. **Le soglie 0.8-1.3 non sono assolute**: Gabbett stesso (2020) ha chiarito che sono guideline, non cut-off rigidi. L'atleta con CTL alto tollera ACWR più elevati (effetto protettivo del fitness).

3. **Monotony richiede interpretazione**: un blocco di carico costante (es. camp di allenamento con 5 sessioni identiche) può avere monotony > 2.0 ed essere intenzionale. Il flag è un avviso, non un divieto.

> **Gabbett (2020)**. *Debunking the myths about training load, injury and performance: empirical evidence, hot topics and recommendations for practitioners.* Br J Sports Med, 54(1), 58–66.

---

## 6. `get_aerobic_decoupling` — Pw:Hr Drift

### Modello

Confronto dell'Efficiency Factor (EF) tra la prima e la seconda metà di un'attività steady-state:

$$
EF = \frac{\bar{P}}{\overline{HR}}
$$

$$
\text{Decoupling (\%)} = \frac{EF_{1st\ half} - EF_{2nd\ half}}{EF_{1st\ half}} \times 100
$$

Un decoupling positivo indica che nella seconda metà la HR è salita (o la potenza è calata) rispetto alla prima metà → **drift cardiovascolare** da fatica aerobica o disidratazione.

| Decoupling | Assessment |
|---|---|
| ≤ −3% | Drift negativo — warm-up lungo, raffreddamento o dati da verificare |
| −3% a < 3% | Eccellente — base aerobica solida |
| 3–5% | Buono — base adeguata |
| 5–8% | Moderato — base aerobica da migliorare |
| ≥ 8% | Significativo — fitness aerobico, pacing, caldo o disidratazione |

### Implementazione

- **Warm-up/cool-down**: esclude i primi 10 min e gli ultimi 5 min (configurabile). Per questo il valore può differire da quello di intervals.icu, che usa tutta l'attività: l'output li riporta entrambi (`decoupling_pct`, `intervals_icu_decoupling_pct`). Verificato su dati reali: con esclusione 0/0 i due valori coincidono entro ~1-2 punti.
- **Filtro**: scarta punti con HR ≤ 0 o potenza ≤ 0
- **Validità**: avviso se Variability Index (NP/potenza media) > 1.05 o finestra analizzata < 60 min
- **EF curve**: rolling 30s per visualizzare il drift nel tempo

### Letteratura di riferimento

| Riferimento | Contributo |
|---|---|
| **Friel (2009)**. *The Cyclist's Training Bible.* 4th ed. VeloPress. | Popolarizzazione del concetto: decoupling < 5% come indicatore di adeguata base aerobica per l'endurance. Pratica standard nel coaching strutturato. |
| **Achten & Jeukendrup (2003)**. *Heart rate monitoring: applications and limitations.* Sports Med, 33(7), 517–538. | Review: il drift HR in steady-state riflette termoregolazione, disidratazione e deplezione del glicogeno muscolare. Non è un singolo meccanismo. |
| **Coyle & González-Alonso (2001)**. *Cardiovascular drift during prolonged exercise: new perspectives.* Exerc Sport Sci Rev, 29(2), 88–92. | Il cardiovascular drift è causato primariamente dalla riduzione dello stroke volume (non solo dalla termoregolazione). La HR compensa per mantenere il cardiac output. |
| **Coggan (2003)**. *Training and racing with a power meter.* Corso. | EF = NP/HR come metrica di efficienza aerobica. Il trend longitudinale (EF crescente a stessa potenza) indica adattamento periferico e centrale. |

### Contesto critico

1. **Non è specifico**: un decoupling alto può indicare (a) base aerobica scarsa, (b) disidratazione, (c) temperatura ambientale elevata, (d) inizio troppo intenso. Il test è sensibile ma non specifico.
2. **Validità solo in steady-state**: in attività con molte variazioni di potenza (intervalli, gare), il decoupling perde significato. Il tool dovrebbe essere usato su uscite Z2/Z3 costanti.
3. **Soglia 5%**: empirica, dal coaching, non da studi randomizzati. È una convenzione utile ma non un cut-off validato scientificamente.

---

## 7. Coggan Power Profile e Fatigue Resistance Index

### Coggan Power Profile (Allen & Coggan 2010)

Classificazione della potenza relativa (W/kg) a 4 durate chiave. Il tool usa gli estremi pubblicati della tabella (Untrained minimo, World Class massimo), distinti per sesso (`sex` del profilo atleta), e divide l'intervallo in 8 fasce uguali, perché la tabella originale è quasi lineare:

| Durata | Uomini min–max | Donne min–max |
|---|---|---|
| 5s | 10.17 – 24.04 | 8.17 – 19.42 |
| 1 min | 5.64 – 11.50 | 4.70 – 9.29 |
| 5 min | 2.33 – 7.60 | 1.87 – 6.61 |
| FTP | 1.86 – 6.40 | 1.50 – 5.69 |

Le soglie calcolate sono nell'output (`coggan_table`). La versione precedente usava valori errati soprattutto sui 5 s (6.3–17.1 W/kg), che sovrastimavano nettamente la categoria degli sprint.

> **Allen & Coggan (2010)**. *Training and Racing with a Power Meter.* 2nd ed. VeloPress. Tabella 3.3.

**Contesto critico**: la tabella Coggan è **il sistema di classificazione più usato al mondo** nel ciclismo amatoriale e professionistico. Limitazioni:
- Basata su dati pre-2010, quando i power meter erano meno diffusi → possibile bias verso atleti più allenati nel dataset originale
- Non stratificata per età o sesso (esistono tabelle femminili separate)
- Le soglie "World Class" sono state criticate come troppo basse per il ciclismo professionistico moderno
- Non distingue tra specialità (strada, pista, MTB)

### Fatigue Resistance Index (Pinot & Grappe 2015)

$$
FRI = \frac{FTP}{MAP} \times 100
$$

Misura la frazione di potenza aerobica massima sostenibile nel tempo. È un indicatore di **sustainability** — complementare al VLaMax che misura la capacità esplosiva.

| FRI (%) | Classificazione | Profilo |
|---|---|---|
| ≥ 82 | Eccellente | GC contender, specialista crono |
| 78–81 | Buono | Endurance forte |
| 74–77 | Moderato | Bilanciato |
| 70–73 | Basso | Esplosivo, meno sostenibile |
| < 70 | Molto basso | Sprinter/puncheur |

> **Pinot & Grappe (2015)**. *A six-year monitoring case study of a top-10 cycling Grand Tour finisher.* J Sports Sci, 33(9), 907–914.
>
> **Pinot & Grappe (2011)**. *The record power profile to assess performance in elite cyclists.* Int J Sports Med, 32(11), 839–844.

**Relazione con VLaMax**: FRI e VLaMax sono inversamente correlati. Un atleta con VLaMax basso (endurance) avrà FRI alto (può sostenere una frazione maggiore del MAP), e viceversa. Riportarli entrambi dà una vista duale:
- VLaMax = capacità glicolitica (quanto puoi "spingere" sopra soglia)
- FRI = sostenibilità (quanto a lungo puoi tenere la potenza aerobica massima)

---

## Appendice: Modello Power-Duration

I parametri CP/W'/Pmax provengono dai modelli PD di intervals.icu, non calcolati localmente. I 4 modelli disponibili:

| Modello | Equazione | Riferimento |
|---|---|---|
| MS_2P | $P = CP + W'/t$ | Monod & Scherrer (1965) |
| MORTON_3P | $P = CP + W'/(t + W'/(P_{max}-CP))$ | Morton (1996) |
| FFT_CURVES | Smoothing FFT su MMP poi fit | Proprietario intervals.icu |
| ECP | Extended CP multi-componente | Proprietario intervals.icu |

> La scelta del modello PD è determinante: MORTON_3P include Pmax esplicito (utile per VLaMax), mentre MS_2P e FFT_CURVES potrebbero non esporlo. Il tool toggle permette di confrontare l'effetto di ciascun modello sulla stima finale.

---

## 8. `get_fatigue_resistance` — Durability / FRS

### Modello

Confronto tra la power curve in condizioni **fresche** e la power curve in condizioni **affaticate** (dopo un certo quantitativo di kJ di lavoro), per quantificare la **durability** — la capacità di mantenere la performance sotto fatica prolungata.

$$
FRS = \frac{1}{n} \sum_{i=1}^{n} \frac{P_{fatigued}(t_i)}{P_{fresh}(t_i)} \times 100
$$

Dove $t_i$ sono 7 durate chiave: 5s, 15s, 1min, 5min, 10min, 20min, 60min.

Per ogni durata:

$$
\Delta\%(t) = \frac{P_{fatigued}(t) - P_{fresh}(t)}{P_{fresh}(t)} \times 100
$$

#### Durate chiave e sistemi energetici

| Durata | Sistema energetico | Significato |
|---|---|---|
| 5s | Neuromuscolare (PCr) | Sprint capability sotto fatica |
| 15s | Anaerobico alacido | Capacità esplosiva residua |
| 1min | Capacità anaerobica | Glicolisi sotto fatica |
| 5min | VO₂max | Potenza aerobica massima residua |
| 10min | Soglia | Sostenibilità alta intensità |
| 20min | FTP | Potenza funzionale sotto fatica |
| 60min | Endurance | Durability vera e propria |

#### Classificazione FRS

| FRS (%) | Classificazione | Significato |
|---|---|---|
| ≥ 95 | Eccellente | Perdita minima sotto fatica — endurance forte |
| 90–95 | Buono | Fade accettabile, muscolatura ben adattata |
| 85–90 | Moderato | Margine di miglioramento nella resistenza alla fatica |
| < 85 | Basso | Perdita significativa — lavorare sulla base aerobica |

### Implementazione

- **Curve fresche**: `GET /athlete/{id}/power-curves?type={sport}&curves={period}`
- **Curve affaticate**: `GET /athlete/{id}/power-curves?type={sport}&curves={period}&fatigue=kj0`
- **Interpolazione**: per durate non esattamente presenti nella curva, interpolazione lineare tra i due punti più vicini
- **VO₂max retention**: calcolato specificamente a 5min come proxy della potenza aerobica massima residua

### Origine e letteratura

| Riferimento | Contributo |
|---|---|
| **Maunder et al. (2021)**. *The case for "durability" in endurance exercise performance.* J Appl Physiol, 131(3), 1226–1233. | **Framework adottato.** Definisce durability come "time of onset and magnitude of deterioration of physiological profiling markers over time". Propone lo studio sistematico del calo di performance sotto fatica progressiva. |
| **Van Erp et al. (2021)**. *Pacing and power output during professional cycling.* Int J Sports Physiol Perform, 16(3), 349–355. | Dati di gara: i ciclisti professionisti mostrano un calo del 5-15% nella potenza massimale nelle ultime ore di tappa. |
| **Clark et al. (2019)**. *The effect of prior exercise on O₂ uptake kinetics during high-intensity cycling.* Med Sci Sports Exerc, 51(2), 343–351. | La cinetica VO₂ rallenta dopo esercizio prolungato, contribuendo al calo della potenza aerobica massima. |

### Contesto critico

1. **Definizione di "fatigato"**: intervals.icu usa soglie predefinite di kJ (kj0, kj1, kj2) che non sono personalizzate sull'individuo. Un ciclista da 90kg e uno da 60kg raggiungono la stessa soglia kJ con sforzi relativi molto diversi.

2. **Non è un test diretto**: le curve MMP sono costruite da dati storici di allenamento/gara, non da un protocollo controllato. La composizione delle attività (intensità, durata, meteo) influenza il risultato.

3. **Delta negativo ≠ sempre "fatica"**: un delta vicino a 0% o positivo per durate molto brevi (5s) è normale — gli sprint non degradano significativamente dopo lavoro aerobico moderato.

---

## 9. `get_dfa_alpha1` — DFA α1 Threshold Detection

### Modello

**DFA α1** (Detrended Fluctuation Analysis, esponente alpha1) misura le proprietà di correlazione frattale degli intervalli RR battito-battito durante l'esercizio.

L'analisi DFA calcola la fluttuazione media $F(n)$ del segnale RR detrended a diverse scale temporali $n$, poi stima l'esponente $\alpha_1$ dalla relazione:

$$
F(n) \propto n^{\alpha_1}
$$

Dove $\alpha_1$ è stimato come pendenza del fit lineare di $\log F(n)$ vs $\log n$ per scale brevi (4-16 battiti).

#### Significato fisiologico

| α1 | Stato | Significato fisiologico |
|---|---|---|
| > 1.0 | Riposo / intensità molto bassa | Dinamica cardiaca correlata, dominanza vagale |
| 0.75 | **Soglia aerobica (VT1/AeT)** | Transizione da dinamica correlata a random |
| 0.50–0.75 | Intensità moderata-alta | Tra soglia aerobica e anaerobica |
| 0.50 | **Soglia anaerobica (VT2/AnT)** | Transizione verso dinamica anti-correlata |
| < 0.50 | Intensità severa | Sopra la soglia anaerobica |

#### Sorgente dei dati

1. **Intervalli RR** (stream `hrv` di intervals.icu, ms battito-battito): α1 calcolato dal tool. Finestre di 120 s ogni 15 s, scale 4–16 battiti (Peng 1995), almeno 100 battiti per finestra. Artefatti: scarto di RR < 250 o > 2000 ms e di battiti che differiscono > 20% dalla mediana locale; finestre con > 5% di artefatti escluse (Rogers et al. 2021).
2. **Stream `dfa_a1`** precalcolato, se presente.

#### Rilevamento soglie

Come in Rogers et al. (2021): regressione lineare di HR (e potenza) su α₁ per le finestre con 0.3 ≤ α₁ ≤ 1.25, poi lettura del valore a α₁ = 0.75 (HRVT1) e α₁ = 0.50 (HRVT2). Nessuna estrapolazione: se l'attività non attraversa il valore target la soglia non viene riportata.

#### Confidence

Da r² della regressione HR–α₁: ≥ 0.7 high, 0.4–0.7 medium, < 0.4 low. Su uscite non a rampa r² è tipicamente basso: le soglie vanno lette come indicative.

Verificato: rumore bianco → α₁ ≈ 0.5, passeggiata casuale → α₁ ≈ 1.5 (test automatici).

### Requisiti dispositivo

DFA α1 richiede gli **intervalli RR battito-battito** registrati nel file FIT durante l'esercizio. intervals.icu li espone come stream `hrv`.

| Dispositivo | Compatibile | Note |
|---|---|---|
| Fascia toracica con RR (Polar H10, Garmin HRM-Pro/Dual, Wahoo TICKR) + device che registra RR | ✅ | Su Garmin attivare "Log HRV" / Registra HRV |
| Polar H10 + app che esportano RR nel FIT | ✅ | Gold standard per accuratezza RR |
| Movesense + app compatibile | ✅ | |
| **Apple Watch** | ❌ | Nessun RR battito-battito negli allenamenti |
| Sensori ottici da polso/braccio | ❌ | Precisione RR insufficiente sotto sforzo |

### Origine e letteratura

| Riferimento | Contributo |
|---|---|
| **Rogers et al. (2021)**. *An evaluation of the relationship between heart rate variability and aerobic and anaerobic thresholds.* J Sports Sci Med, 20(2), 303–311. | **Modello adottato.** Valida α1 = 0.75 come proxy della soglia ventilatoria VT1 e α1 = 0.50 come proxy di VT2, confrontando con test lattacidi e spirometrici. |
| **Gronwald et al. (2019)**. *Correlation properties of heart rate variability during endurance exercise.* Front Physiol, 10, 1202. | Framework teorico: DFA α1 come misura continua dello stress autonomico durante esercizio. |
| **Gronwald et al. (2020)**. *Dual or single? Physiological mapping based on DFA α1.* Int J Sports Med, 41(14), 1027–1035. | Propone la "DFA α1 physiological mapping" come alternativa ai test tradizionali per identificare i domini di intensità. |
| **Peng et al. (1995)**. *Quantification of scaling exponents and crossover phenomena in nonstationary heartbeat time series.* Chaos, 5(1), 82–87. | Metodologia DFA originale applicata alle serie RR. |

### Contesto critico

1. **Protocollo ideale**: DFA α1 è più affidabile durante un **ramp test** con incrementi graduali di potenza. Attività in steady-state o con intervalli possono non mostrare crossing puliti.

2. **Artefatti**: movimenti, perdita di contatto della fascia, e aritmie cardiache possono generare valori α1 spuri. Il tool filtra valori 0 < α1 < 2.0 e richiede almeno 30 punti validi.

3. **Variabilità day-to-day**: le soglie DFA variano con lo stato di recupero, la caffeina, la temperatura, e altri fattori. Un singolo test non è definitivo — meglio ripetere 2-3 volte.

4. **Non validato per running**: la maggior parte degli studi DFA α1 è su ciclismo. Nel running, gli artefatti di movimento sono più significativi.

---

## 10. `get_polarization_analysis` — Training Intensity Distribution

### Modello

Aggrega il tempo nelle zone di intensità su tutte le attività di un periodo e sport, calcolando la distribuzione tra bassa, media e alta intensità.

#### Gruppi di intensità (modello a 3 zone di Seiler)

$$
\text{Low} = Z1 + Z2 \ (< LT1) \qquad \text{Mid} = Z3 + Z4 \ (LT1\text{–}LT2) \qquad \text{High} = Z5+ \ (> LT2)
$$

Mappatura valida per le 7 zone di potenza Coggan (Z4 = soglia 91–105% FTP) e le 7 zone FC Friel (Z5a inizia a LTHR). La versione precedente metteva Z4 (soglia) nella zona alta, sovrastimando l'alta intensità.

#### Polarization Index (Treff et al. 2019)

$$
PI = \log_{10}\left(\frac{f_1}{f_2} \cdot f_3 \cdot 100\right)
$$

con $f_i$ frazioni di tempo nelle 3 zone; $f_2 = 0$ sostituito da 0.01; PI non calcolabile se $f_3 = 0$. **PI > 2.00 = polarizzato.**

#### Modelli di distribuzione

| Modello | Condizione |
|---|---|
| **Polarizzato** | $f_1 > f_3 > f_2$ e PI > 2.00 |
| **Piramidale** | $f_1 > f_2 > f_3$ |
| **Threshold** | $f_2$ massimo |
| **HIIT** | $f_3$ massimo |
| **Base** | Tutto il resto (bassa intensità dominante) |

### Origine e letteratura

| Riferimento | Contributo |
|---|---|
| **Seiler (2010)**. *What is best practice for training intensity and duration distribution in endurance athletes?* Int J Sports Physiol Perform, 5(3), 276–291. | **Framework adottato.** Review fondamentale: gli atleti élite di endurance convergono su una distribuzione ~80/20 (bassa/alta intensità) con minimo Z3. |
| **Stöggl & Sperlich (2015)**. *Polarized training has greater impact on key endurance variables than threshold, high-intensity, or high-volume training.* Front Physiol, 6, 295. | Studio controllato su 48 atleti: il modello polarizzato produce il maggior incremento di VO₂max e TTE rispetto a threshold, HIIT e volume training. |
| **Hydren & Cohen (2015)**. *Current scientific evidence for a polarized cardiovascular endurance training model.* J Strength Cond Res, 29(12), 3523–3530. | Review sistematica: evidenza moderata a favore del modello polarizzato, ma la distribuzione ottimale varia con il livello dell'atleta e la fase della stagione. |
| **Muñoz et al. (2014)**. *Does polarized training improve performance in recreational runners?* Int J Sports Physiol Perform, 9(2), 265–272. | Benefici della polarizzazione anche nei runner amatoriali, non solo élite. |

### Contesto critico

1. **Zone diverse per sport**: il tool usa power zones per il ciclismo e HR zones per la corsa. Le zone HR sono meno precise (lag, drift, variabilità day-to-day).

2. **80/20 non è universale**: la distribuzione ottimale dipende dalla fase di allenamento (base → più Z2, build → più Z4), dal livello dell'atleta, e dallo sport. La distribuzione piramidale è altrettanto efficace per molti atleti (Stöggl & Sperlich, 2015).

3. **Z3 non è sempre "black hole"**: per ciclisti con FTP alto, il tempo in Z3 (sweet spot) è una strategia legittima per massimizzare lo stimulus con tempo limitato. La critica al Z3 è più rilevante per atleti con > 12h/settimana di allenamento.

4. **Arrotondamento zone**: le zone di intervals.icu possono avere 5, 6 o 7 livelli a seconda delle impostazioni. Il tool normalizza a Z1-Z7 con zero-padding.

---

## 11. `get_longitudinal_trends` — Trend Analysis + HRR

### Modello

Regressione lineare su serie temporali di metriche chiave per rilevare **trend di progressione, stagnazione o sovrallenamento** nel periodo analizzato.

Per ogni metrica, dati $n$ punti $(d_i, v_i)$ dove $d_i$ è l'offset in giorni dalla data di inizio:

$$
v = \beta_0 + \beta_1 \cdot d
$$

$$
\beta_1 = \frac{n \sum d_i v_i - \sum d_i \sum v_i}{n \sum d_i^2 - (\sum d_i)^2}
$$

Il trend settimanale è $\beta_1 \times 7$.

#### Metriche tracciate

**Da attività**:

| Metrica | Fonte | Direzione | Significato |
|---|---|---|---|
| Efficiency Factor | `icu_efficiency_factor` (NP/FC media di intervals.icu), altrimenti `icu_weighted_avg_watts / average_heartrate` | ↑ = meglio | Efficienza aerobica (Coggan, 2003) |
| Heart Rate Recovery | `icu_hrr.hrr` (oggetto, calo di FC in bpm) | ↑ = meglio | Riattivazione parasimpatica post-effort |
| Average Power | `icu_average_watts` | ↑ = meglio | Potenza media per sessione |
| Normalized Power | `icu_weighted_avg_watts` | ↑ = meglio | Potenza normalizzata |
| Decoupling | `decoupling` | ↓ = meglio | Drift cardiovascolare |
| Training Load | `icu_training_load` | neutro | Carico per sessione (TSS) |

**Da wellness**:

| Metrica | Fonte | Direzione | Significato |
|---|---|---|---|
| CTL (Fitness) | `ctl` | ↑ = meglio | Carico cronico, proxy fitness |
| ATL (Fatigue) | `atl` | neutro | Carico acuto |
| TSB (Form) | `ctl - atl` | neutro | Balance fitness/fatica |
| HRV (rMSSD) | `hrv` | ↑ = meglio | Variabilità cardiaca |
| Resting HR | `restingHR` | ↓ = meglio | FC a riposo |
| Weight | `weight` | neutro | Peso corporeo |
| Sleep | `sleepSecs / 3600` | ↑ = meglio | Ore di sonno |

#### Determinazione direzione

- **Stable**: |slope_per_week| < 1% della media, **oppure r² < 0.1** (la retta spiega meno del 10% della varianza: rumore)
- **Improving/Declining**: basato sulla direzione del slope rispetto al `betterDirection` della metrica
- **change_abs / change_pct**: variazione tra inizio e fine **della retta di regressione** (non tra due singoli punti). `change_pct` è `null` per metriche che possono essere ≤ 0 (decoupling, TSB)
- **Sport**: "Ride" include VirtualRide, GravelRide, MountainBikeRide; "Run" include VirtualRun, TrailRun

#### Flag automatici

Il tool genera alert contestuali:

| Condizione | Flag |
|---|---|
| CTL ↑ > 10% | "Fitness trending up — good progression" |
| HRV ↓ > 15% | "HRV declining — monitor recovery, possible overreaching" |
| Resting HR ↓ > 5% | "Cardiovascular fitness improving" |
| HRR ↑ | "Better parasympathetic reactivation" |
| HRR ↓ | "Possible fatigue accumulation or detraining" |
| EF ↑ > 5% | "Aerobic base developing well" |

### Heart Rate Recovery (HRR) — Focus

L'HRR misura il calo della frequenza cardiaca nei 60 secondi successivi alla fine di uno sforzo. Un HRR più alto (calo più rapido) indica una migliore riattivazione parasimpatica.

$$
HRR_{60s} = HR_{peak} - HR_{60s\ post}
$$

intervals.icu calcola HRR automaticamente (`icu_hrr`) per le attività che hanno un cool-down identificabile.

| HRR (bpm) | Classificazione |
|---|---|
| > 40 | Eccellente — ottima riattivazione vagale |
| 30–40 | Buono |
| 20–30 | Nella norma |
| < 20 | Basso — possibile fatica residua, overtraining, o decondizionamento |

### Origine e letteratura

| Riferimento | Contributo |
|---|---|
| **Daanen et al. (2012)**. *Systematic review on heart rate recovery to monitor changes in training status in athletes.* Int J Sports Physiol Perform, 7(3), 251–260. | **Framework HRR adottato.** Review sistematica: l'HRR post-esercizio è un marker affidabile di fitness aerobico e risponde rapidamente a cambiamenti nel carico di allenamento. Un calo dell'HRR nel tempo segnala overreaching. |
| **Lamberts et al. (2009)**. *Day-to-day changes in heart rate, RPE and performance during a 2-week overload period in endurance cyclists.* Br J Sports Med, 43(11), 813–817. | Il Lamberts Sub-Maximal Cycling Test (LSCT) usa HRR come indicatore primario: un calo > 3 bpm/settimana predice overreaching funzionale. |
| **Buchheit (2014)**. *Monitoring training status with HR measures.* Front Physiol, 5, 73. | Review: HRR, HR al sub-massimale e HRV sono marker complementari per il monitoraggio dell'allenamento. L'HRR è più sensibile del HR sub-massimale per rilevare overreaching. |
| **Cole et al. (1999)**. *Heart-rate recovery immediately after exercise as a predictor of mortality.* N Engl J Med, 341(18), 1351–1357. | Studio fondamentale: HRR < 12 bpm al 1° minuto post-esercizio è predittore indipendente di mortalità (anche in soggetti asintomatici). |

### Contesto critico

1. **Regressione lineare**: è il modello più semplice e potrebbe mancare trend non lineari (es. plateau seguito da calo). Per periodi > 6 mesi, un modello segmentato sarebbe più appropriato.

2. **HRR auto-calculated**: il campo `icu_hrr` di intervals.icu dipende dall'identificazione automatica del punto di fine sforzo, che può essere impreciso per attività con cool-down mal definiti.

3. **Stagionalità**: metriche come peso, HRV e CTL hanno componenti stagionali. Un trend apparente su 90 giorni potrebbe semplicemente riflettere una transizione di fase (es. base → build).

4. **Confounders**: la potenza media per sessione può salire perché si fanno più intervalli (non perché si è più forti). L'EF è un indicatore più robusto dell'efficienza vera.

5. **Soglia minima**: il tool richiede ≥ 3 data point per metrica per calcolare un trend. Con meno punti, la metrica viene omessa.
