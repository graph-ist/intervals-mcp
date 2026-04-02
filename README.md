# intervals-mcp

[![CI](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/graph-ist/intervals-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

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
├── server.ts           # MCP server: 30 tool, 4 prompt
├── intervals.ts        # Client HTTP per intervals.icu API
├── types.ts            # Tipi TypeScript per le risposte API
├── http.ts             # Transport HTTP/Express (remote)
├── stdio.ts            # Transport stdio (Claude Desktop)
└── tools/
    ├── decoupling.ts   # Decoupling aerobico Pw:Hr
    ├── dfrc.ts         # dFRC / W'bal (Skiba)
    ├── metabolic.ts    # Profilo metabolico (VLaMax, Coggan)
    ├── recovery.ts     # Indice di recupero composito
    ├── training-load.ts # Rischio carico (Monotony, ACWR)
    ├── utils.ts        # Utility condivise (extractStream)
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
| `morning_check` | Mattina | Dashboard visuale: Recovery Index gauge, barre metriche, sparkline HRV/FC, raccomandazione giornata |
| `recovery_check` | Sera post-allenamento | Dashboard visuale: Recovery Index + ACWR/Monotony/Strain gauge, red flag, raccomandazioni domani |
| `weekly_review` | Domenica sera | Dashboard visuale: volume per sport, TSS giornaliero, CTL/ATL/TSB sparkline, voto settimana |
| `activity_review` | Fine attivita | Dashboard visuale: metriche attivita, zone, pacing, decoupling gauge, dFRC chart |

### Differenze tra i tool di wellness/fitness

| Domanda | Tool da usare |
|---|---|
| "Quanto ho pedalato/corso/nuotato questo mese?" | `get_fitness_summary` — volume e totali grezzi |
| "Come sto oggi? Posso allenarmi forte?" | `get_recovery_index` — stato recupero fisiologico |
| "Sto aumentando troppo? Rischio infortunio?" | `get_training_load_risk` — pattern e rischio del carico |
| "Com'è il mio stato di forma generale?" | `get_wellness_data` — dati giornalieri raw (HRV, sonno, peso, umore) |

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
