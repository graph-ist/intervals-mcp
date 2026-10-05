import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { daysAgo, today } from "./helpers.js";

export function registerPrompts(server: McpServer): void {
  const PROMPT_SUFFIX =
    "Interpreta ogni valore usando i reference_ranges della risposta — indica la fascia e il significato per l'atleta. No emoji.";

  server.prompt(
    "morning_check",
    "Check mattutino: red-flag scanner rapido — verifica se ci sono motivi per scostare dal piano settimanale",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Check mattutino rapido. Questo NON è uno strumento decisionale quotidiano — serve solo a identificare red-flag che giustificano uno scostamento dal piano settimanale già stabilito.

Regola operativa: se il Recovery Index è tra 55 e 80 e non ci sono anomalie multigiorno (≥3 giorni consecutivi di trend negativo su indicatori indipendenti), il piano settimanale si esegue come previsto. Il rumore giornaliero dell'HRV (±15-20% intra-individuale, Plews et al. 2012) NON è motivo per modificare la sessione.

Intervieni solo se:
1. RI < 40 oggi
2. Pattern multigiorno: ≥3 giorni consecutivi sotto baseline su ≥2 metriche indipendenti (autonomico + strutturale)
3. Red flag singolo severo: HRV z < -2.0, RHR z < -2.0, SpO₂ < 93%

Output richiesto:
- RI di oggi con stato
- Eventali red flag (se nessuna, scrivi "Nessuna anomalia — esegui il piano")
- Solo se ci sono red flag: suggerimento di modifica specifico e reversibile

${PROMPT_SUFFIX}`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "weekly_review",
    "Review settimanale e pianificazione: strumento PRIMARIO di decisione. Analisi della settimana conclusa + impostazione della prossima.",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review settimanale dal ${daysAgo(7)} al ${today()}.

Questo è lo strumento PRIMARIO di decisione. Le scelte di volume, intensità e distribuzione si fanno qui, non nei check giornalieri.

PARTE 1 — ANALISI SETTIMANA CONCLUSA:
- Volume per sport (ore, km, TSS)
- Carico: CTL/ATL/TSB trend, ACWR, Monotony/Strain
- Recupero: RI medio della settimana, trend, giorni con red flag
- Aderenza al piano: sessioni completate vs pianificate, scostamenti e motivi
- Trend longitudinali: EF, HRR, potenza se disponibili

PARTE 2 — PIANIFICAZIONE PROSSIMA SETTIMANA:
- Stato attuale di forma (TSB) e tendenza CTL
- Settimana di carico, mantenimento o scarico? Giustifica con i dati
- Volume target (ore/TSS) e distribuzione intensità (polarizzata: 80/20 o piramidale)
- Sessioni chiave raccomandate con obiettivo fisiologico
- Criteri di intervento giornaliero: definisci soglie specifiche per questa settimana che giustificherebbero uno scostamento dal piano (es. "se RI < 45 per 2+ giorni, sostituire la Z4 di giovedì con Z2")

Principio guida: la varianza giornaliera è rumore (Plews et al. 2012). Solo pattern multigiorno su indicatori indipendenti sono segnale. I check giornalieri servono solo come trigger per eccezioni definite qui.

${PROMPT_SUFFIX}`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "activity_review",
    "Analisi post-attivita: trova automaticamente l'ultima Ride/Run/Swim di oggi e la analizza in dettaglio",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Analisi post-attività.

1. Cerca le attività di oggi con get_recent_activities (days=1). Filtra solo tipo Ride, Run, VirtualRide, VirtualRun o Swim. Ignora WeightTraining, Pilates, Yoga e simili. Prendi la più recente.
2. Se non trovi nulla oggi, cerca ieri (days=2).
3. Se non trovi nulla, rispondi "Nessuna attività Ride/Run/Swim trovata negli ultimi 2 giorni."

Per l'attività trovata, analizza in dettaglio:
- Riepilogo e metriche chiave
- Laps/split e zone
- Se ha dati di potenza: decoupling aerobico e dFRC
- Punti di forza e cosa migliorare

${PROMPT_SUFFIX}`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "weekly_load_tracker",
    "Tracker TSS: i prossimi 3 mesi in colonne settimanali, la prima è la settimana attuale; nuoto, bici e corsa si sommano ogni giorno contro il target",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Tracker del carico settimanale (TSS), oggi è ${today()}.

1. Chiama get_weekly_load_tracker con i valori predefiniti (12 settimane da quella attuale).
2. Disegna il grafico seguendo chart_hint: colonne verticali, la prima è la settimana attuale, poi le successive. Segmenti colorati con actual_tss_by_sport (nuoto, bici, corsa) e legenda, target_tss come contorno o marcatore, other_tss_not_counted in grigio separato. Le settimane senza target (target_tss null) restano vuote: è normale quando il piano non è ancora stato creato, non chiedere i valori e non inventarli. Per la settimana attuale aggiungi il profilo giornaliero (cumulative_tss) e i TSS al giorno che servono per chiuderla (tss_per_day_needed).
3. Sotto il grafico, al massimo tre righe: stato della settimana attuale rispetto ai giorni trascorsi, quante settimane sono ancora senza target, e l'attività non conteggiata solo se rilevante.

Non fare valutazioni di rischio o consigli di allenamento: questo è un tracker, non un'analisi. Non usare il recovery index. No emoji.`,
          },
        },
      ],
    }),
  );
}
