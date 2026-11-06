import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { daysAgo, daysFromNow, today } from "./helpers.js";

/*
 * Entry points for the protocols of the intervals-coach skill (skills/intervals-coach). The rules live in the skill;
 * each prompt only names the tools, fills in the dates in the athlete's time zone and keeps a minimal fallback for
 * clients without the skill. Do not copy protocol rules here.
 */
function prompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "morning_check",
    "Check mattutino sui valori di intervals.icu (protocollo Morning check della skill)",
    async () =>
      prompt(
        `Check mattutino. Chiama get_readiness_check senza argomenti e segui il protocollo «Morning check» della skill intervals-coach.
Senza la skill: riporta il caso della regola e la sua frase, le medie a 7 giorni con la fascia normale e gli allarmi gravi; proponi una modifica specifica e reversibile solo se il caso non è il 4 o c'è un allarme grave. No emoji.`,
      ),
  );

  server.prompt(
    "weekly_review",
    "Review della settimana e piano della prossima (protocollo Weekly review della skill)",
    async () => {
      const from = daysAgo(6);
      const to = today();
      return prompt(
        `Review settimanale dal ${from} al ${to} e piano della prossima settimana. Segui il protocollo «Weekly review» della skill intervals-coach.
Strumenti: get_fitness_summary (oldest ${from}, newest ${to}), get_training_load_risk, get_readiness_check con date=${from} e poi senza argomenti, get_load_tracker con weeks_before=1 e weeks_after=1 (plan_compliance), get_polarization_analysis con days=28, get_longitudinal_trends, get_events dal ${daysFromNow(1)} al ${daysFromNow(7)}.
Scrivi in calendario solo dopo la mia conferma. No emoji.`,
      );
    },
  );

  server.prompt(
    "activity_review",
    "Analisi dell'ultima Ride, Run o Swim (protocollo Activity review della skill)",
    async () =>
      prompt(
        `Analisi post-attività. Trova con get_recent_activities (days=1, poi days=2) l'ultima Ride, VirtualRide, Run, VirtualRun o Swim e segui il protocollo «Activity review» della skill intervals-coach: get_activity_detail, get_activity_intervals con il confronto tra ripetute WORK, e get_aerobic_decoupling e get_activity_dfrc se c'è potenza. No emoji.`,
      ),
  );

  server.prompt(
    "load_tracker",
    "TSS settimanale per sport contro l'obiettivo (protocollo Load tracker della skill)",
    async () =>
      prompt(
        `Load tracker, oggi è ${today()}. Chiama get_load_tracker con i valori predefiniti, disegna il grafico come indica chart_hint e segui il protocollo «Load tracker» della skill intervals-coach. Le settimane senza obiettivo restano vuote. No emoji.`,
      ),
  );
}
