import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { daysAgo, today } from "./helpers.js";

export function registerPrompts(server: McpServer): void {
  const PROMPT_SUFFIX =
    "Interpreta ogni valore usando i reference_ranges della risposta — indica la fascia e il significato per l'atleta. No emoji.";

  // The readiness rule follows intervals.icu values and matches the training dashboard; keep it identical to
  // skills/intervals-coach/references/readiness-rule.md
  const READINESS_RULE = `Per readiness, HRV e FC a riposo di intervals.icu, riferite all'ultimo giorno con dati (indica la data):
- media degli ultimi 7 giorni, quel giorno compreso (almeno 4 valori, altrimenti "dato insufficiente");
- fascia normale: media dei 60 giorni precedenti, quel giorno escluso, più o meno metà della deviazione standard campionaria (almeno 30 valori, altrimenti nessuna fascia);
- posizione della media a 7 giorni: sotto, nella fascia, sopra.
TSB = CTL − ATL dell'ultimo giorno.

Regola, in ordine, decide la prima che vale:
1. HRV sotto e FC a riposo sopra la fascia: "oggi tieni l'intensità bassa".
2. TSB sotto −30: "la fatica accumulata è alta: valuta un giorno di scarico".
3. Almeno un segnale fuori fascia (HRV sotto, FC a riposo sopra o readiness sotto): "segui il piano senza aggiungere intensità".
4. Altrimenti: "nessun segnale contrario al piano di oggi".`;

  server.prompt(
    "morning_check",
    "Check mattutino: confronta readiness, HRV e FC a riposo di intervals.icu con la loro fascia normale e dice se qualcosa giustifica uno scostamento dal piano settimanale",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Check mattutino rapido. Il riferimento sono i valori di intervals.icu. Non è uno strumento decisionale quotidiano: dice solo se qualcosa giustifica uno scostamento dal piano settimanale già stabilito.

1. Chiama get_wellness_data con days=67 e fields ["id","readiness","hrv","restingHR","ctl","atl"].
2. Applica la regola:

${READINESS_RULE}

3. Chiama get_recovery_index solo per gli allarmi gravi di oggi: HRV o FC a riposo con z-score sotto −2, SpO₂ sotto il 93%. Un allarme grave è l'unica eccezione che giustifica un cambio di seduta oltre alla regola; con SpO₂ sotto il 93% suggerisci di sentire un medico. Il Recovery Index è un indice di questo server, non di intervals: non usarlo per decidere e non riportarlo al posto della readiness.

Output:
- Data dei dati, readiness di oggi e TSB.
- HRV, FC a riposo e readiness: media a 7 giorni, fascia normale, posizione.
- La frase della regola.
- Allarmi gravi, se ce ne sono.
- Solo se la regola non è la 4 o c'è un allarme grave: una modifica specifica e reversibile della seduta di oggi.

No emoji.`,
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
            text: `Review settimanale dal ${daysAgo(6)} al ${today()}.

Questo è lo strumento PRIMARIO di decisione. Le scelte di volume, intensità e distribuzione si fanno qui, non nei check giornalieri.

PARTE 1 — ANALISI SETTIMANA CONCLUSA:
- Volume per sport (ore, km, TSS)
- Carico: CTL/ATL/TSB trend, ACWR, Monotony/Strain
- Recupero, sui valori di intervals.icu: readiness, HRV e FC a riposo, con la media a 7 giorni e la fascia normale come nel morning_check, all'inizio e alla fine della settimana (chiama get_wellness_data con days=74 e fields ["id","readiness","hrv","restingHR","ctl","atl"]); allarmi gravi della settimana da get_recovery_index (HRV o FC a riposo con z sotto −2, SpO₂ sotto il 93%). Il Recovery Index non è un valore di intervals: non usarlo per decidere
- Aderenza al piano: sessioni completate vs pianificate, scostamenti e motivi
- Trend longitudinali: EF, HRR, potenza se disponibili

PARTE 2 — PIANIFICAZIONE PROSSIMA SETTIMANA:
- Stato attuale di forma (TSB) e tendenza CTL
- Settimana di carico, mantenimento o scarico? Giustifica con i dati
- Volume target (ore/TSS) e distribuzione intensità (polarizzata: 80/20 o piramidale)
- Sessioni chiave raccomandate con obiettivo fisiologico
- Criteri di intervento giornaliero: definisci soglie specifiche per questa settimana che giustificherebbero uno scostamento dal piano (es. "se il morning_check dà 'intensità bassa' per 2 o più giorni, sostituire la Z4 di giovedì con Z2")

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
    "load_tracker",
    "Load Tracker: TSS settimanale della settimana precedente, di quella attuale e dei prossimi 3 mesi; nuoto, bici, corsa e palestra si sommano ogni giorno contro il target",
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Load Tracker, oggi è ${today()}.

1. Chiama get_load_tracker con i valori predefiniti (settimana precedente, attuale e le 11 successive).
2. Disegna il grafico seguendo chart_hint: colonne verticali impilate, la prima è la settimana precedente, poi l'attuale (da evidenziare), poi le successive. Segmenti colorati con actual_tss_by_sport (nuoto, bici, corsa, palestra) e legenda, target_tss come contorno o marcatore. Le settimane senza target (target_tss null) restano vuote: è normale quando il piano non è ancora stato creato, non chiedere i valori e non inventarli. Per la settimana attuale aggiungi il profilo giornaliero (cumulative_tss) e i TSS al giorno che servono per chiuderla (tss_per_day_needed).
3. Sotto il grafico, al massimo tre righe: stato della settimana attuale rispetto ai giorni trascorsi e quante settimane sono ancora senza target.

Conta solo nuoto, bici, corsa e palestra: ogni altra attività è rumore e vale 0, non menzionarla. Non fare valutazioni di rischio o consigli di allenamento: questo è un tracker, non un'analisi. Non usare il recovery index. No emoji.`,
          },
        },
      ],
    }),
  );
}
