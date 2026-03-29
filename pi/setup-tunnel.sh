#!/bin/bash
# Setup Cloudflare Tunnel on Raspberry Pi
# Run after setup.sh

set -e

echo "=== Cloudflare Tunnel Setup ==="

# 1. Install cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "Installing cloudflared..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /tmp/cloudflared
    sudo mv /tmp/cloudflared /usr/local/bin/cloudflared
    sudo chmod +x /usr/local/bin/cloudflared
    echo "cloudflared installed: $(cloudflared --version)"
else
    echo "cloudflared already installed: $(cloudflared --version)"
fi

# 2. Login to Cloudflare
echo ""
echo "Opening Cloudflare login (follow the URL if no browser)..."
cloudflared tunnel login

# 3. Create tunnel
TUNNEL_NAME="intervals-mcp"
echo ""
echo "Creating tunnel '$TUNNEL_NAME'..."
cloudflared tunnel create "$TUNNEL_NAME"

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
echo "Tunnel ID: $TUNNEL_ID"

# 4. Create config
CLOUDFLARED_DIR="$HOME/.cloudflared"
mkdir -p "$CLOUDFLARED_DIR"
cat > "$CLOUDFLARED_DIR/config.yml" << EOF
tunnel: $TUNNEL_ID
credentials-file: $CLOUDFLARED_DIR/$TUNNEL_ID.json

ingress:
  - service: http://localhost:3001
EOF

echo "Config written to $CLOUDFLARED_DIR/config.yml"

# 5. DNS route
echo ""
read -p "Enter your domain (e.g. mcp.yourdomain.com): " HOSTNAME
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"

echo ""
echo "=== Setting up cloudflared as systemd service ==="
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

echo ""
echo "=== Done! ==="
echo ""
echo "Your MCP server is now available at:"
echo "  https://$HOSTNAME/mcp"
echo ""
echo "Update Claude connector URL to: https://$HOSTNAME/mcp"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status cloudflared    # tunnel status"
echo "  sudo systemctl status intervals-mcp  # server status"
echo "  sudo systemctl restart intervals-mcp # restart server"
echo "  cd ~/intervals-mcp && git pull && npm run build && sudo systemctl restart intervals-mcp  # update"
