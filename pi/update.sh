#!/bin/bash
# Update intervals-mcp on the Pi and verify it end-to-end. Run on the Pi: bash ~/intervals-mcp/pi/update.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/intervals-mcp}"
cd "$INSTALL_DIR"

echo "=== 1. Code ==="
if [ -d .git ]; then
    git pull --ff-only
fi
git log --oneline -1 2>/dev/null || true

echo "=== 2. Build ==="
npm ci
npm run build

echo "=== 3. Config ==="
chmod 600 .env
grep -q '^MCP_AUTH_TOKEN=' .env || { echo "MCP_AUTH_TOKEN missing in .env (server will not start). Add one: openssl rand -hex 32"; exit 1; }
set -a; . ./.env; set +a
PORT="${PORT:-3001}"

echo "=== 4. Restart ==="
sudo systemctl restart intervals-mcp
for _ in $(seq 1 20); do
    curl -fs "http://localhost:$PORT/health" > /dev/null && break
    sleep 0.5
done
systemctl show intervals-mcp --property=ActiveEnterTimestamp

echo "=== 5. Verify ==="
echo -n "health: "; curl -fs "http://localhost:$PORT/health"; echo
echo -n "no token -> "; curl -s -o /dev/null -w "%{http_code} (expected 401)\n" -X POST "http://localhost:$PORT/mcp"

MCP_HEADERS=(-H "Authorization: Bearer $MCP_AUTH_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
INIT=$(curl -s -D - "${MCP_HEADERS[@]}" -X POST "http://localhost:$PORT/mcp" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"update.sh","version":"1"}}}')
SID=$(echo "$INIT" | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\r')
[ -n "$SID" ] || { echo "initialize failed:"; echo "$INIT" | tail -5; exit 1; }
curl -s "${MCP_HEADERS[@]}" -H "mcp-session-id: $SID" -X POST "http://localhost:$PORT/mcp" \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null

call() {
    curl -s "${MCP_HEADERS[@]}" -H "mcp-session-id: $SID" -X POST "http://localhost:$PORT/mcp" -d "$1" | sed -n 's/^data: //p'
}
TOOLS=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | grep -o '"name":"[a-z_0-9]*"' | wc -l)
echo "tools/list: $TOOLS tools"
for TOOL in get_athlete get_recovery_index get_events get_polarization_analysis; do
    OUT=$(call "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":{}}}")
    if echo "$OUT" | grep -q '"isError":true'; then echo "FAIL $TOOL: $(echo "$OUT" | head -c 200)"; else echo "OK   $TOOL"; fi
done
curl -s -o /dev/null "${MCP_HEADERS[@]}" -H "mcp-session-id: $SID" -X DELETE "http://localhost:$PORT/mcp"

echo "=== Done ==="
