# intervals-mcp

[![CI](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

MCP server per [intervals.icu](https://intervals.icu) — 54 tool per accedere ai tuoi dati di allenamento da Claude.

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

## Development

```bash
npm run build       # Compila TypeScript
npm test            # Esegui test (vitest)
npm run test:watch  # Test in watch mode
npm run lint        # Lint con Biome
npm run lint:fix    # Lint + fix automatico
npm run check       # Build + lint + test (tutto)
```

### Struttura del progetto

```
src/
├── server.ts           # MCP server: 54 tool, 3 prompt
├── intervals.ts        # Client HTTP per intervals.icu API
├── types.ts            # Tipi TypeScript per le risposte API
├── http.ts             # Transport HTTP/Express (remote)
├── stdio.ts            # Transport stdio (Claude Desktop)
└── tools/
    ├── decoupling.ts       # Decoupling aerobico Pw:Hr
    ├── dfa-alpha1.ts       # DFA α1 threshold detection
    ├── dfrc.ts             # dFRC / W'bal (Skiba)
    ├── fatigue-resistance.ts # Durability: fresh vs fatigued power curves
    ├── metabolic.ts        # Profilo metabolico (VLaMax, Coggan)
    ├── polarization.ts     # Distribuzione intensità e polarizzazione
    ├── recovery.ts         # Indice di recupero composito (+ soggettivo)
    ├── training-load.ts    # Rischio carico (Monotony, ACWR)
    ├── trends.ts           # Trend longitudinali + HRR
    ├── utils.ts            # Utility condivise (extractStream)
    └── __tests__/
        └── tools.test.ts
```

## Uso da smartphone/tablet (Raspberry Pi + Cloudflare Tunnel)

Deploy su Raspberry Pi con Cloudflare Quick Tunnel per accesso da qualsiasi dispositivo, sempre acceso, zero cold start.

### Requisiti

- Raspberry Pi (testato su Pi 8GB) con Raspberry Pi OS Lite 64-bit
- SSH abilitato (username `pi`, hostname `intervals-pi`)
- Stessa rete WiFi del Mac per il setup iniziale

### Setup sul Pi

```bash
# Dal Mac: connettiti al Pi
ssh pi@intervals-pi.local

# Sul Pi: installa Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Opzione A: clona da GitHub (serve deploy key per repo privato)
git clone git@github.com:graph-ist/intervals-mcp.git ~/intervals-mcp

# Opzione B: copia dal Mac con SCP
# Dal Mac: scp -r src/ package.json package-lock.json tsconfig.json pi@intervals-pi.local:~/intervals-mcp/

# Build
cd ~/intervals-mcp && npm ci && npm run build

# Crea .env
cat > .env << EOF
INTERVALS_API_KEY=la_tua_api_key
INTERVALS_ATHLETE_ID=il_tuo_athlete_id
PORT=3001
EOF
```

### Servizi systemd

```bash
# intervals-mcp server
sudo tee /etc/systemd/system/intervals-mcp.service > /dev/null << 'EOF'
[Unit]
Description=intervals-mcp MCP server
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/intervals-mcp
EnvironmentFile=/home/pi/intervals-mcp/.env
ExecStart=/usr/bin/node /home/pi/intervals-mcp/dist/http.js
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

# Cloudflare Quick Tunnel
sudo apt-get install -y curl
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb

sudo tee /etc/systemd/system/cloudflared.service > /dev/null << 'EOF'
[Unit]
Description=Cloudflare Quick Tunnel for intervals-mcp
After=intervals-mcp.service
Requires=intervals-mcp.service
[Service]
Type=simple
User=pi
ExecStart=/usr/bin/cloudflared tunnel --url http://localhost:3001 --no-autoupdate
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

# Avvia tutto
sudo systemctl daemon-reload
sudo systemctl enable intervals-mcp cloudflared
sudo systemctl start intervals-mcp cloudflared
```

### Recuperare l'URL del tunnel

Il Quick Tunnel genera un URL casuale ad ogni avvio (es. `https://xxx-yyy-zzz.trycloudflare.com`). Per recuperarlo:

```bash
ssh pi@intervals-pi.local "sudo journalctl -u cloudflared -n 20 --no-pager | grep trycloudflare"
```

L'URL resta stabile finché il Pi è acceso. Cambia solo dopo un riavvio.

### Connetti a claude.ai

Vai su **claude.ai → Settings → Connectors → Add custom connector** e incolla l'URL del tunnel + `/mcp`:

```
https://xxx-yyy-zzz.trycloudflare.com/mcp
```

### Aggiornare (dal Mac)

```bash
npm run build
sshpass -p 'raspberry' scp -r src/ package.json package-lock.json tsconfig.json pi@intervals-pi.local:~/intervals-mcp/
sshpass -p 'raspberry' ssh pi@intervals-pi.local "cd ~/intervals-mcp && npm ci && npm run build && sudo systemctl restart intervals-mcp"
```

L'URL del tunnel non cambia con un deploy — solo `intervals-mcp` viene riavviato.

### Comandi utili

| Cosa | Comando |
|---|---|
| Stato server | `sudo systemctl status intervals-mcp` |
| Stato tunnel | `sudo systemctl status cloudflared` |
| URL tunnel | `sudo journalctl -u cloudflared --no-pager \| grep trycloudflare` |
| Riavviare server | `sudo systemctl restart intervals-mcp` |
| Spegnere Pi | `sudo shutdown now` |
| Riavviare Pi | `sudo reboot` |

### Alternativa: Render (cloud, con cold start)

Se non hai un Pi, puoi usare Render (free tier). Vedi [Dockerfile](Dockerfile) e [render.yaml](render.yaml). Nota: il free tier si spegne dopo 15 min di inattivita, la prima richiesta impiega ~30s.

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

Se hai deployato su Render (vedi sopra), il server è già accessibile. Per test locale:

```bash
INTERVALS_API_KEY=xxx INTERVALS_ATHLETE_ID=yyy npm run serve
```

Il server parte su `http://localhost:3001/mcp`.

Per usarlo con claude.ai Integrations serve un URL pubblico HTTPS — usa il deploy Render o ngrok per test locale.

## Modelli matematici

I tool custom `get_activity_dfrc`, `get_metabolic_profile`, `get_recovery_index`, `get_training_load_risk`, `get_aerobic_decoupling`, `get_fatigue_resistance`, `get_dfa_alpha1`, `get_polarization_analysis` e `get_longitudinal_trends` implementano modelli fisiologici con scelte specifiche di costanti e formulazioni. Tutta la documentazione matematica, i riferimenti alla letteratura e il confronto critico con le implementazioni commerciali (INSCYD, WKO5) sono in **[MODELS.md](MODELS.md)**.

## Tool disponibili (54)

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
| `update_activity` | Modifica metadati di un'attività (nome, tipo, descrizione, ecc.) |
| `delete_activity` | Elimina un'attività |
| `get_activity_intervals` | Intervalli strutturati di un'attività |
| `update_activity_intervals` | Aggiorna/sostituisce intervalli manuali |
| `get_activity_best_efforts` | Migliori sforzi per durata/distanza |
| `search_intervals` | Cerca intervalli per durata/intensità |
| `create_manual_activity` | Crea attività manuale (ore, TSS, ecc.) |
| `get_activity_tags` | Lista tag attività disponibili |

### 📈 Curve e analisi attività

| Tool | Descrizione |
|---|---|
| `get_activity_power_curve` | Power curve di un'attività |
| `get_activity_pace_curve` | Pace curve di un'attività |
| `get_activity_hr_curve` | HR curve di un'attività |
| `get_activity_power_vs_hr` | Power vs HR raw scatter (efficienza aerobica) |
| `get_aerobic_decoupling` | Decoupling Pw:Hr: drift % 1ª vs 2ª metà, EF curve, assessment |
| `get_activity_dfrc` | dFRC/W'bal di un'attività (modello Skiba) |
| `get_activity_power_histogram` | Distribuzione potenza a barre |
| `get_activity_map` | Dati mappa/GPS |
| `get_activity_weather` | Condizioni meteo durante l'attività |

### 📊 Curve e profilo fisiologico

| Tool | Descrizione |
|---|---|
| `get_power_curves` | Power curve (stagione, recenti, fatigued) |
| `get_pace_curves` | Pace curve |
| `get_hr_curves` | HR curve |
| `get_power_hr_curve` | Trend efficienza aerobica |
| `get_metabolic_profile` | Profilo metabolico: VLaMax (Mader), energy breakdown, Coggan power profile, FRI |
| `get_mmp_model` | Modello MMP (CP, W', pMax) |
| `get_activity_power_curves_range` | Power curve per periodo (confronto attività) |

### 🔬 Analisi scientifiche avanzate

| Tool | Descrizione |
|---|---|
| `get_fatigue_resistance` | **Durability**: confronta power curve fresche vs affaticate. Fatigue Resistance Score, ritenzione VO₂max. Basato su Maunder et al. (2021) |
| `get_dfa_alpha1` | **DFA α1**: soglie aerobica (α1=0.75) e anaerobica (α1=0.50) da dati beat-to-beat. Richiede fascia toracica compatibile. Rogers et al. (2021) |
| `get_polarization_analysis` | **Polarizzazione**: distribuzione tempo nelle zone, indice di polarizzazione, confronto con modello 80/20. Seiler (2010), Stöggl & Sperlich (2015) |
| `get_longitudinal_trends` | **Trend longitudinali**: regressione lineare su EF, potenza, HRR, decoupling, CTL, HRV, FC riposo, peso, sonno. Segnala progressioni e sovraffaticamento |

### 💚 Wellness e fitness

| Tool | Descrizione |
|---|---|
| `get_wellness_data` | Wellness: CTL, ATL, TSB, HRV, sonno, umore |
| `update_wellness` | Aggiorna dati wellness per data (peso, HRV, sonno, umore) |
| `get_recovery_index` | **Stato di recupero**: indice composito 0-100 da HRV, FC riposo, sonno, Baevsky SI, SpO₂, respirazione + dati soggettivi (umore, motivazione, fatica, dolori, stress, infortuni). Baseline individuale (z-score 30gg). → "Come stai oggi? Puoi allenarti forte?" |
| `get_training_load_risk` | **Rischio da carico**: Monotony, Strain (Foster 1998), ACWR (Gabbett 2016), spike di volume. → "Stai aumentando troppo in fretta?" |
| `get_fitness_summary` | **Volume e carico totali**: ore, km, TSS e numero attività per sport in un periodo |
| `get_weather_forecast` | Previsioni meteo per la tua posizione |
| `get_fitness_model_events` | Eventi del modello fitness (CTL/ATL/TSB) |

### 📅 Calendario e pianificazione

| Tool | Descrizione |
|---|---|
| `get_events` | Eventi calendario (workout, gare, note) con filtro categoria |
| `create_training_plan` | Crea piano allenamento in batch sul calendario |
| `update_event` | Modifica un evento esistente sul calendario |
| `delete_event` | Elimina un evento dal calendario |
| `duplicate_events` | Duplica eventi (ripeti blocchi settimanali) |
| `bulk_delete_events` | Elimina eventi in batch |
| `get_folders` | Cartelle libreria workout e piani |
| `get_training_plan` | Dettagli piano allenamento attivo |
| `get_workouts` | Libreria workout salvati |
| `get_gear` | Lista attrezzatura (bici, scarpe, ecc.) con km e manutenzione |

### 🎨 Visualizzazione

| Tool | Descrizione |
|---|---|
| `create_custom_chart` | Crea grafico custom in intervals.icu |

## Prompt / Shortcut (3)

Accessibili da "Add from intervals" in claude.ai o dal menu prompt in Claude Desktop.

| Prompt | Quando | Cosa fa |
|---|---|---|
| `morning_check` | Mattina | Red-flag scanner: verifica se ci sono motivi per scostare dal piano settimanale. RI 55-80 senza anomalie = esegui il piano |
| `weekly_review` | Domenica sera | Strumento PRIMARIO di decisione: analisi settimana conclusa + pianificazione prossima settimana con criteri di eccezione |
| `activity_review` | Fine attività | Trova automaticamente l'ultima Ride/Run/Swim e la analizza: metriche, zone, pacing, decoupling, dFRC |

### Differenze tra i tool di wellness/fitness

| Domanda | Tool da usare |
|---|---|
| "Quanto ho pedalato/corso/nuotato questo mese?" | `get_fitness_summary` — volume e totali grezzi |
| "Come sto oggi? Posso allenarmi forte?" | `get_recovery_index` — stato recupero fisiologico (oggettivo + soggettivo) |
| "Sto aumentando troppo? Rischio infortunio?" | `get_training_load_risk` — pattern e rischio del carico |
| "Com'è il mio stato di forma generale?" | `get_wellness_data` — dati giornalieri raw (HRV, sonno, peso, umore) |
| "Sto migliorando o peggiorando?" | `get_longitudinal_trends` — trend su EF, potenza, HRV, HRR, CTL, peso |
| "Il mio allenamento è ben polarizzato?" | `get_polarization_analysis` — distribuzione intensità vs modello 80/20 |
| "Quanto reggo sotto fatica?" | `get_fatigue_resistance` — durability, FRS |
| "Quali sono le mie soglie reali?" | `get_dfa_alpha1` — soglie da DFA α1 (serve fascia toracica compatibile) |

## Variabili d'ambiente

| Variabile | Obbligatoria | Default | Descrizione |
|---|---|---|---|
| `INTERVALS_API_KEY` | Sì | — | API key da intervals.icu (Settings → Developer) |
| `INTERVALS_ATHLETE_ID` | No | `0` (utente corrente) | ID atleta intervals.icu |
| `PORT` | No | `3001` | Porta HTTP (solo per `npm run serve`) |

## Troubleshooting

| Problema | Soluzione |
|---|---|
| `INTERVALS_API_KEY is required` | Crea `.env` con la tua API key (`cp .env.example .env`) |
| `intervals.icu 401` | API key errata o scaduta — rigenerala da Settings → Developer |
| `intervals.icu 404` | Activity ID o athlete ID non valido |
| `intervals.icu 429` | Rate limit — riprova tra qualche secondo |
| Tool non risponde | Controlla la connessione internet e che intervals.icu sia raggiungibile |
| Claude Desktop non vede i tool | Riavvia Claude Desktop dopo aver modificato `claude_desktop_config.json` |
| Pi tunnel URL cambiato | L'URL cambia dopo un reboot del Pi — recuperalo con `journalctl -u cloudflared` |
