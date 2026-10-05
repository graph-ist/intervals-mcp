# intervals-mcp

[![CI](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

MCP server per [intervals.icu](https://intervals.icu) — 146 tool che coprono tutta l'API pubblica documentata (tranne l'endpoint solo OAuth `disconnect-app`).

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
├── server.ts           # MCP server: 146 tool, 3 prompt
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
MCP_AUTH_TOKEN=$(openssl rand -hex 32)
PORT=3001
EOF
chmod 600 .env
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

Vai su **claude.ai → Settings → Connectors → Add custom connector** e incolla l'URL del tunnel + `/mcp?token=` seguito dal valore di `MCP_AUTH_TOKEN` (i connector custom non permettono header personalizzati):

```
https://xxx-yyy-zzz.trycloudflare.com/mcp?token=IL_TUO_MCP_AUTH_TOKEN
```

Tratta questo URL come una password: chi lo conosce ha accesso in lettura e scrittura al tuo account intervals.icu.

### Aggiornare (dal Mac)

```bash
# Una tantum: accesso con chiave SSH invece della password
ssh-copy-id pi@intervals-pi.local

npm run build
scp -r src/ package.json package-lock.json tsconfig.json pi@intervals-pi.local:~/intervals-mcp/
ssh pi@intervals-pi.local "cd ~/intervals-mcp && npm ci && npm run build && sudo systemctl restart intervals-mcp"
```

L'URL del tunnel non cambia con un deploy — solo `intervals-mcp` viene riavviato.

In alternativa, se sul Pi c'è il clone git, basta lanciare sul Pi (via SSH o Tailscale):

```bash
bash ~/intervals-mcp/pi/update.sh
```

Lo script fa `git pull`, `npm ci`, build e riavvio del servizio, poi verifica: health check, rifiuto delle richieste senza token, `tools/list` e 4 chiamate reali via MCP.

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
INTERVALS_API_KEY=xxx INTERVALS_ATHLETE_ID=yyy MCP_AUTH_TOKEN=$(openssl rand -hex 32) npm run serve
```

Il server parte su `http://localhost:3001/mcp`.

Per usarlo con claude.ai Integrations serve un URL pubblico HTTPS — usa il deploy Render o ngrok per test locale.

## Modelli matematici

I tool custom `get_activity_dfrc`, `get_metabolic_profile`, `get_recovery_index`, `get_training_load_risk`, `get_aerobic_decoupling`, `get_fatigue_resistance`, `get_dfa_alpha1`, `get_polarization_analysis` e `get_longitudinal_trends` implementano modelli fisiologici con scelte specifiche di costanti e formulazioni. Tutta la documentazione matematica, i riferimenti alla letteratura e il confronto critico con le implementazioni commerciali (INSCYD, WKO5) sono in **[MODELS.md](MODELS.md)**.

## Tool disponibili (146)

### 👤 Atleta e impostazioni

| Tool | Descrizione |
|---|---|
| `get_athlete` | Profilo atleta, fitness attuale (CTL/ATL/TSB) |
| `get_sport_settings` | Zone, FTP, soglia, FC max |
| `update_sport_settings` | Aggiorna impostazioni sport (FTP, LTHR, zone, W', ecc.) |
| `apply_sport_settings` | Applica le impostazioni (zone, soglie) alle attività passate e ricalcola |
| `create_sport_settings` | Crea le impostazioni per uno sport che non ne ha |
| `update_athlete` | Aggiorna il profilo atleta (peso, FC riposo, data di nascita, fuso orario) |
| `list_athletes` | Atleti seguiti o allenati (richiede API key) |
| `update_sport_settings_bulk` | Aggiorna le impostazioni di più sport insieme |
| `delete_sport_settings` | Elimina le impostazioni di uno sport |
| `get_matching_activities` | Attività che corrispondono a un'impostazione sport |
| `get_athlete_profile` | Profilo pubblico (bio, cartelle condivise, custom item) |
| `get_athlete_connections` | Dispositivi e piattaforme collegati |
| `get_athlete_settings` | Impostazioni interfaccia per phone, tablet o desktop |
| `get_weather_config` / `update_weather_config` | Località delle previsioni meteo |
| `update_athlete_plans` | Coach: cambia il piano a più atleti insieme |

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
| `get_activity_interval_stats` | Statistiche (potenza, FC, NP, ecc.) su un tratto arbitrario dell'attività per indice stream |
| `get_activities_by_ids` | Più attività per ID in una chiamata |
| `get_activities_around` | Attività prima e dopo un'attività data |
| `update_activity_streams` | Corregge gli stream (potenza, FC) di un'attività |
| `update_activity_interval` | Aggiorna o crea un singolo intervallo |
| `delete_activity_intervals` | Elimina intervalli da un'attività |
| `create_manual_activities_bulk` | Crea più attività manuali (upsert su `external_id`) |
| `search_activities_full` | Ricerca per nome o tag che restituisce attività complete |
| `download_activity_file` | Scarica file originale, fit o gpx di un'attività (max ~1.5 MB) |
| `export_csv` | Esporta in CSV attività, wellness, gear, eventi, curve atleta e dati di una singola attività |
| `list_activity_messages` / `add_activity_message` | Commenti su un'attività |
| `upload_activity_streams_csv` | Aggiorna gli stream di un'attività da CSV |
| `split_activity_interval` | Divide un intervallo in due |
| `download_activity_fit_files` | Zip dei fit generati per più attività |
| `delete_activity_tombstone` | Permette di ricaricare un'attività cancellata |

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
| `get_activity_histogram` | Distribuzione FC, passo o passo corretto per pendenza |
| `get_activity_time_at_hr` | Tempo trascorso a ogni valore di FC |
| `get_activity_segments` | Segmenti riconosciuti nell'attività |
| `get_activity_model` | Modello di carico da FC o rilevamento picchi di potenza |
| `get_activity_power_curves` | Power curve multi-stream e fresche/affaticate in una chiamata |
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
| `get_activity_pace_curves_range` | Miglior passo per distanza, per periodo |
| `get_activity_hr_curves_range` | Miglior FC per durata, per periodo |
| `get_pace_distances` | Distanze usate per le pace curve |

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
| `update_wellness_bulk` | Aggiorna più giorni di wellness in una chiamata |
| `get_wellness_day` | Wellness di un singolo giorno |
| `upload_wellness_csv` | Importa wellness da testo CSV |
| `get_recovery_index` | **Stato di recupero**: indice composito 0-100 da HRV, FC riposo, sonno, Baevsky SI, SpO₂, respirazione + dati soggettivi (umore, motivazione, fatica, dolori, stress, infortuni). Baseline individuale (z-score 30gg). → "Come stai oggi? Puoi allenarti forte?" |
| `get_training_load_risk` | **Rischio da carico**: Monotony, Strain (Foster 1998), ACWR (Gabbett 2016), spike di volume. → "Stai aumentando troppo in fretta?" |
| `get_fitness_summary` | **Volume e carico totali**: ore, km, TSS e numero attività per sport in un periodo |
| `get_weather_forecast` | Previsioni meteo per la tua posizione |
| `get_fitness_model_events` | Eventi del modello fitness (CTL/ATL/TSB) |

### 📅 Calendario e pianificazione

| Tool | Descrizione |
|---|---|
| `get_events` | Eventi calendario (workout, gare, note) con filtro categoria |
| `get_event` | Un singolo evento per ID |
| `delete_events_range` | Elimina tutti gli eventi di un intervallo di date |
| `apply_plan` | Applica un piano della libreria al calendario da una data |
| `apply_plan_changes` | Propaga al calendario le modifiche del piano attivo |
| `update_training_plan` | Cambia il piano assegnato all'atleta |
| `update_events_range` | Nasconde o blocca gli eventi di un intervallo (funzione coach) |
| `list_tags` | Tag usati su eventi o workout della libreria |
| `download_workouts_zip` | Scarica i workout di un intervallo in uno zip (zwo, mrc, erg, fit) |
| `create_training_plan` | Crea piano allenamento in batch sul calendario (singola chiamata bulk) |
| `update_event` | Modifica un evento esistente sul calendario |
| `mark_event_done` | Segna un workout pianificato come eseguito (crea attività manuale) |
| `download_event_workout` | Esporta un workout pianificato in zwo, mrc, erg o fit |
| `delete_event` | Elimina un evento dal calendario |
| `duplicate_events` | Duplica eventi (ripeti blocchi settimanali) |
| `bulk_delete_events` | Elimina eventi in batch |
| `get_folders` | Cartelle libreria workout e piani |
| `get_training_plan` | Dettagli piano allenamento attivo |
| `get_workouts` | Libreria workout salvati |
| `get_workout` | Dettaglio di un workout della libreria |
| `create_workout` | Crea un workout nella libreria |
| `create_workouts_bulk` | Crea più workout nella libreria in una chiamata |
| `update_workout` | Modifica un workout della libreria |
| `delete_workout` | Elimina un workout dalla libreria |
| `create_folder` | Crea una cartella o un piano nella libreria |
| `update_folder` | Modifica una cartella o un piano |
| `delete_folder` | Elimina una cartella o un piano con tutti i suoi workout |
| `duplicate_workouts` | Duplica workout su un piano |
| `convert_workout` | Converte un workout della libreria in zwo, mrc, erg o fit |
| `import_workout_file` | Importa un file zwo, mrc, erg o fit in una cartella |
| `update_plan_workouts` | Nasconde o mostra all'atleta un intervallo di workout di un piano |
| `get_folder_shared_with` / `update_folder_shared_with` | Condivisione di cartelle e piani con altri atleti |
| `recalculate_gear_stats` | Ricalcola km, ore e attività di un'attrezzatura |
| `get_gear` | Lista attrezzatura (bici, scarpe, ecc.) con km e manutenzione |
| `create_gear` / `update_gear` / `delete_gear` | Gestione attrezzatura e componenti |
| `replace_gear` | Ritira un componente e lo sostituisce mantenendo i promemoria |
| `create_gear_reminder` / `update_gear_reminder` / `delete_gear_reminder` | Promemoria di manutenzione (reset e snooze inclusi) |

### 🎨 Visualizzazione

| Tool | Descrizione |
|---|---|
| `create_custom_chart` | Crea grafico custom in intervals.icu |
| `list_custom_items` | Elenca grafici, campi e pannelli custom |
| `get_custom_item` / `update_custom_item` / `delete_custom_item` | Gestione di un custom item |
| `reorder_custom_items` | Riordina i custom item |
| `upload_custom_item_image` | Carica l'immagine di un custom item |

### 🗺️ Percorsi, chat ed eventi condivisi

| Tool | Descrizione |
|---|---|
| `list_routes` / `get_route` / `update_route` | Percorsi dell'atleta (con o senza tracciato GPS) |
| `get_route_similarity` | Somiglianza tra due percorsi |
| `list_chats` / `get_chat` / `list_chat_messages` | Lettura delle chat |
| `list_groups` | Gruppi dell'atleta |
| `send_chat_message` | Invia un messaggio reale a una chat o a un atleta |
| `update_chat_message` / `delete_chat_message` | Modifica o elimina un messaggio |
| `mark_chat_seen` / `block_chat` | Segna come letto, blocca o sblocca una chat privata |
| `get_shared_event` | Evento condiviso (es. gara) con i percorsi |

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
| `MCP_AUTH_TOKEN` | Sì (solo HTTP) | — | Token richiesto su `/mcp` (header `Authorization: Bearer` o `?token=`). Almeno 32 caratteri: `openssl rand -hex 32` |
| `UPLOAD_DIR` | No | — | Solo HTTP: cartella da cui `upload_activity` può leggere file locali. Senza, l'upload remoto accetta solo `file_base64` |
| `PORT` | No | `3001` | Porta HTTP (solo per `npm run serve`) |

## Troubleshooting

| Problema | Soluzione |
|---|---|
| `INTERVALS_API_KEY is required` | Crea `.env` con la tua API key (`cp .env.example .env`) |
| `intervals.icu 401` | API key errata o scaduta — rigenerala da Settings → Developer |
| `intervals.icu 404` | Activity ID o athlete ID non valido |
| `intervals.icu 429` | Rate limit (10 richieste/s): il server riprova da solo per attese brevi, altrimenti riprova dopo i secondi indicati |
| `401 unauthorized` su `/mcp` | `MCP_AUTH_TOKEN` mancante o diverso nell'URL del connector |
| `get_fatigue_resistance` senza curva affaticata | Imposta la soglia kJ (`after_kj0`) nelle impostazioni sport su intervals.icu |
| Tool non risponde | Controlla la connessione internet e che intervals.icu sia raggiungibile |
| Claude Desktop non vede i tool | Riavvia Claude Desktop dopo aver modificato `claude_desktop_config.json` |
| Pi tunnel URL cambiato | L'URL cambia dopo un reboot del Pi — recuperalo con `journalctl -u cloudflared` |

## Future works

Tool di analisi avanzata pianificati, costruiti sugli endpoint già disponibili. In ordine di priorità:

| Tool | Cosa farà | Dati usati |
|---|---|---|
| `project_form` | Proietta CTL/ATL/TSB nei giorni futuri usando il carico dei workout pianificati: forma prevista il giorno della gara e verifica del taper (modello EWMA 42/7 giorni) | `get_events` (load_target), wellness |
| `get_pace_decoupling` | Decoupling passo:FC per corse senza misuratore di potenza, con passo corretto per pendenza (GAP) in salita | stream `velocity_smooth`, `gap`, `heartrate` |
| `get_cp_history` | Andamento mese per mese di CP, W' e Pmax, per vedere se la stagione sposta la curva | power curves per intervallo di date (`r.YYYY-MM-DD.YYYY-MM-DD`) con modello PD |
| `get_durability` | Durability nella singola uscita lunga: calo di potenza a FC fissa e deriva di DFA α1 tra prima e ultima ora | stream, `interval-stats`, curve affaticate |
| `get_interval_fade` | Calo ripetuta per ripetuta in una seduta a intervalli: potenza, FC e decoupling per rep | intervalli dell'attività |
| `get_plan_compliance` | Pianificato contro eseguito per settimana: carico, durata, campo `compliance` delle attività | eventi, attività |
| `get_hrv_threshold_history` | Andamento di HRVT1/HRVT2 (DFA α1) nel tempo dalle uscite con intervalli RR | stream `hrv` |

Prerequisiti lato dati per sfruttarli al meglio: soglia kJ (`after_kj0`) impostata nelle impostazioni sport, registrazione RR ("Log HRV") attiva sul device con fascia toracica, campi soggettivi del wellness compilati.
