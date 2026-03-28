# intervals-mcp

MCP server per [intervals.icu](https://intervals.icu) — 30 tool per accedere ai tuoi dati di allenamento da Claude.

## Setup

```bash
npm install
npm run build
```

Crea il file `.env`:

```bash
cp .env.example .env
```

Inserisci la tua API key di intervals.icu (Settings → Developer).

## Uso con Claude Desktop (Mac)

Aggiungi al file `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "intervals": {
      "command": "node",
      "args": ["/PERCORSO/COMPLETO/intervals-mcp/dist/stdio.js"],
      "env": {
        "INTERVALS_API_KEY": "la_tua_api_key",
        "INTERVALS_ATHLETE_ID": "il_tuo_athlete_id"
      }
    }
  }
}
```

Sostituisci `/PERCORSO/COMPLETO/` con il path reale (es. `/Users/tuonome/Documents/GitHub/intervals-mcp`).

Riavvia Claude Desktop.

## Uso con claude.ai (Integrations — remote)

Avvia il server HTTP:

```bash
INTERVALS_API_KEY=xxx INTERVALS_ATHLETE_ID=yyy npm run serve
```

Il server parte su `http://localhost:3001/mcp`.

Per usarlo con claude.ai Integrations serve un URL pubblico HTTPS. Opzioni:

1. **ngrok** (test): `ngrok http 3001` → usa l'URL generato
2. **Deploy su Vercel/Fly.io/Railway** (produzione)

Poi in claude.ai → Settings → Integrations → aggiungi l'URL del server MCP.

## Modelli matematici

I tool custom `get_activity_dfrc`, `get_metabolic_profile`, `get_recovery_index`, `get_training_load_risk` e `get_aerobic_decoupling` implementano modelli fisiologici con scelte specifiche di costanti e formulazioni. Tutta la documentazione matematica, i riferimenti alla letteratura e il confronto critico con le implementazioni commerciali (INSCYD, WKO5) sono in **[MODELS.md](MODELS.md)**.

## Tool disponibili (30)

### 👤 Atleta e impostazioni

| Tool | Descrizione |
|---|---|
| `get_athlete` | Profilo atleta, fitness attuale (CTL/ATL/TSB) |
| `get_sport_settings` | Zone, FTP, soglia, FC max |
| `update_sport_settings` | Aggiorna impostazioni sport (FTP, LTHR, zone, W', ecc.) |

### 🏊‍♂️ Attività

| Tool | Descrizione |
|---|---|
| `get_recent_activities` | Attività recenti |
| `search_activities` | Cerca attività per testo |
| `get_activity_detail` | Dettagli completi di un'attività |
| `get_activity_streams` | Dati time-series (potenza, HR, passo, ecc.) |
| `upload_activity` | Upload file attività (FIT, TCX, GPX) |

### 📈 Curve e analisi attività

| Tool | Descrizione |
|---|---|
| `get_activity_power_curve` | Power curve di un'attività |
| `get_activity_pace_curve` | Pace curve di un'attività |
| `get_activity_hr_curve` | HR curve di un'attività |
| `get_activity_power_vs_hr` | Power vs HR raw scatter (efficienza aerobica) |
| `get_aerobic_decoupling` | Decoupling Pw:Hr calcolato: drift % 1ª vs 2ª metà, EF curve, assessment |
| `get_activity_dfrc` | Calcolo dFRC/W'bal di un'attività (modello Skiba) |

### 📊 Curve e profilo fisiologico

| Tool | Descrizione |
|---|---|
| `get_power_curves` | Power curve (stagione, recenti) |
| `get_pace_curves` | Pace curve |
| `get_hr_curves` | HR curve |
| `get_power_hr_curve` | Trend efficienza aerobica |
| `get_metabolic_profile` | Profilo metabolico: VLaMax (Mader), energy breakdown, Coggan power profile, FRI |

### 💚 Wellness e fitness

| Tool | Descrizione |
|---|---|
| `get_wellness_data` | Wellness: CTL, ATL, TSB, HRV, sonno, umore |
| `update_wellness` | Aggiorna dati wellness per data (peso, HRV, sonno, umore) |
| `get_recovery_index` | **Stato di recupero**: calcola un indice composito 0-100 analizzando HRV, FC a riposo, sonno, Baevsky SI, SpO₂ e frequenza respiratoria rispetto alla tua baseline individuale (z-score 30 giorni). Segnala red flag e trend. → "Come stai oggi? Puoi allenarti forte?" |
| `get_training_load_risk` | **Rischio da carico**: analizza Monotony (variabilità del carico — carichi troppo uguali = rischio), Strain (carico cumulativo), ACWR (rapporto carico acuto/cronico) e spike di volume. → "Stai aumentando troppo in fretta? Rischio infortunio?" |
| `get_fitness_summary` | **Volume e carico totali**: ore, km, TSS e numero attività per sport in un periodo. Sono i *numeri grezzi* di cosa hai fatto, non come il corpo ha risposto (per quello → recovery_index) né il rischio (→ training_load_risk) |

### 📅 Calendario e pianificazione

| Tool | Descrizione |
|---|---|
| `get_events` | Eventi calendario (workout, gare, note) con filtro categoria |
| `create_training_plan` | Crea piano allenamento in batch sul calendario |
| `update_event` | Modifica un evento esistente sul calendario |
| `delete_event` | Elimina un evento dal calendario |
| `get_folders` | Cartelle libreria workout e piani |

### 🎨 Visualizzazione

| Tool | Descrizione |
|---|---|
| `create_custom_chart` | Crea grafico custom in intervals.icu |

## Prompt / Shortcut (4)

Accessibili da "Add from intervals" in claude.ai o dal menu prompt in Claude Desktop.

| Prompt | Quando | Cosa fa |
|---|---|---|
| `morning_check` ☀️ | Mattina | Wellness + Recovery Index: come hai dormito, HRV, prontezza, raccomandazione per la giornata |
| `recovery_check` 🌙 | Sera post-allenamento | Recovery Index + Training Load Risk: stato recupero, carico, rischio, raccomandazioni per domani |
| `weekly_review` 📊 | Domenica sera | Review completa: volume per sport, TSS, zone, ACWR, trend CTL/ATL/TSB, voto e suggerimenti |
| `activity_review` 🏋️ | Fine attività | Dettagli attività + decoupling + dFRC: pacing, zone, split, sforzo anaerobico |

### Differenze tra i tool di wellness/fitness

| Domanda | Tool da usare |
|---|---|
| "Quanto ho pedalato/corso/nuotato questo mese?" | `get_fitness_summary` — volume e totali grezzi |
| "Come sto oggi? Posso allenarmi forte?" | `get_recovery_index` — stato recupero fisiologico |
| "Sto aumentando troppo? Rischio infortunio?" | `get_training_load_risk` — pattern e rischio del carico |
| "Com'è il mio stato di forma generale?" | `get_wellness_data` — dati giornalieri raw (HRV, sonno, peso, umore) |
