#!/bin/bash
# Setup intervals-mcp on Raspberry Pi
# Run as your normal user (not root)

set -e

echo "=== intervals-mcp Pi Setup ==="

# 1. Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

echo "Node.js $(node -v)"

# 2. Clone and build
INSTALL_DIR="$HOME/intervals-mcp"
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull
else
    echo "Cloning repository..."
    git clone https://github.com/graph-ist/intervals-mcp.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

npm ci
npm run build

# 3. Create .env if not exists
if [ ! -f .env ]; then
    echo "Creating .env file..."
    read -p "INTERVALS_API_KEY: " API_KEY
    read -p "INTERVALS_ATHLETE_ID: " ATHLETE_ID
    cat > .env << EOF
INTERVALS_API_KEY=$API_KEY
INTERVALS_ATHLETE_ID=$ATHLETE_ID
MCP_AUTH_TOKEN=$(openssl rand -hex 32)
PORT=3001
EOF
    chmod 600 .env
    echo ".env created (MCP_AUTH_TOKEN generated: see .env, needed in the connector URL ?token=...)"
else
    echo ".env already exists"
    grep -q '^MCP_AUTH_TOKEN=' .env || { echo "MCP_AUTH_TOKEN=$(openssl rand -hex 32)" >> .env; echo "MCP_AUTH_TOKEN added to .env"; }
    chmod 600 .env
fi

# 4. Test it works
echo "Testing server..."
set -a; . ./.env; set +a
timeout 5 node dist/http.js &
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/)
kill %1 2>/dev/null || true
if [ "$HTTP_CODE" = "200" ]; then
    echo "Server works!"
else
    echo "ERROR: Server returned HTTP $HTTP_CODE"
    exit 1
fi

# 5. Install systemd service
echo "Installing systemd service..."
sudo tee /etc/systemd/system/intervals-mcp.service > /dev/null << EOF
[Unit]
Description=intervals-mcp MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node dist/http.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable intervals-mcp
sudo systemctl start intervals-mcp

echo ""
echo "=== Done! ==="
echo "Server running on http://localhost:3001/mcp"
echo "Service: sudo systemctl status intervals-mcp"
echo ""
echo "Next: run setup-tunnel.sh to create Cloudflare Tunnel"
