#!/bin/bash
# cfref EC2 proxy setup
# Run: bash setup.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
INSTANCE_NAME="cfref-proxy"
SG_NAME="cfref-proxy-sg"
KEY_NAME="cfref-proxy-key"
PORT="53312"

echo "=== cfref EC2 Proxy Setup ==="
echo "Region: $REGION"

# Get default VPC
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region "$REGION")
if [ "$VPC_ID" = "None" ] || [ -z "$VPC_ID" ]; then
  echo "No default VPC found. Creating one..."
  VPC_ID=$(aws ec2 create-default-vpc --query "Vpc.VpcId" --output text --region "$REGION")
fi
echo "VPC: $VPC_ID"

# Create security group
echo "Creating security group..."
SG_ID=$(aws ec2 create-security-group \
  --group-name "$SG_NAME" \
  --description "cfref TCP proxy security group" \
  --vpc-id "$VPC_ID" \
  --query "GroupId" \
  --output text \
  --region "$REGION" 2>/dev/null || \
  aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$SG_NAME" \
    --query "SecurityGroups[0].GroupId" \
    --output text \
    --region "$REGION")
echo "Security Group: $SG_ID"

# Allow inbound TCP on Soulseek port
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port "$PORT" \
  --cidr "0.0.0.0/0" \
  --region "$REGION" 2>/dev/null || true

# Allow SSH
aws ec2 authorize-security-group-ingress \
  --group-id "$SG_ID" \
  --protocol tcp \
  --port 22 \
  --cidr "0.0.0.0/0" \
  --region "$REGION" 2>/dev/null || true

echo "Ingress rules set: TCP $PORT, SSH 22"

# Create key pair
echo "Creating key pair..."
aws ec2 create-key-pair \
  --key-name "$KEY_NAME" \
  --query "KeyMaterial" \
  --output text \
  --region "$REGION" > "${KEY_NAME}.pem" 2>/dev/null || echo "Key pair already exists"
chmod 400 "${KEY_NAME}.pem" 2>/dev/null || true

# Get latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*" "Name=architecture,Values=x86_64" "Name=state,Values=available" \
  --query "sort_by(Images, &CreationDate)[-1].ImageId" \
  --output text \
  --region "$REGION")
echo "AMI: $AMI_ID"

# User data script to install Node.js and the proxy
USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
set -e

# Install Node.js 22
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
yum install -y nodejs

# Create proxy directory
mkdir -p /opt/cfref-proxy
cd /opt/cfref-proxy

# Create package.json
cat > package.json << 'EOF'
{
  "name": "cfref-ec2-proxy",
  "version": "1.0.0",
  "main": "proxy.js",
  "dependencies": {
    "ws": "^8.18.0"
  }
}
EOF

# Create proxy.js
cat > proxy.js << 'PROXYEOF'
const net = require("net");
const WebSocket = require("ws");

const TUNNEL_URL = process.env.TUNNEL_URL || "wss://cfref-tunnel.solitary-tree-e2c6.workers.dev";
const SESSION_ID = process.env.SESSION_ID || "slsk-default";
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "53312", 10);
const LISTEN_HOST = process.env.LISTEN_HOST || "0.0.0.0";

const server = net.createServer((tcpSocket) => {
  const peerId = Math.random().toString(36).slice(2, 10);
  console.log(`[tcp] Incoming: ${peerId} from ${tcpSocket.remoteAddress}`);

  const wsUrl = `${TUNNEL_URL}/tunnel/${SESSION_ID}/connect`;
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log(`[ws] Connected for ${peerId}`);
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "peer_data" && msg.data) {
      const buf = Buffer.from(msg.data, "base64");
      if (!tcpSocket.destroyed) tcpSocket.write(buf);
    }
    if (msg.type === "peer_disconnected") {
      tcpSocket.destroy();
    }
  });

  tcpSocket.on("data", (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "peer_data",
        peerId,
        data: data.toString("base64")
      }));
    }
  });

  tcpSocket.on("close", () => {
    console.log(`[tcp] Closed: ${peerId}`);
    try { ws.send(JSON.stringify({ type: "peer_closed", peerId })); } catch {}
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  tcpSocket.on("error", (err) => {
    console.error(`[tcp] Error ${peerId}: ${err.message}`);
    try { ws.send(JSON.stringify({ type: "peer_closed", peerId })); } catch {}
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on("close", () => {
    if (!tcpSocket.destroyed) tcpSocket.destroy();
  });

  ws.on("error", (err) => {
    console.error(`[ws] Error ${peerId}: ${err.message}`);
    if (!tcpSocket.destroyed) tcpSocket.destroy();
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`cfref TCP proxy on ${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`Tunnel: ${TUNNEL_URL}/tunnel/${SESSION_ID}`);
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
PROXYEOF

# Install dependencies
npm install

# Create systemd service
cat > /etc/systemd/system/cfref-proxy.service << 'SVCEOF'
[Unit]
Description=cfref TCP Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cfref-proxy
ExecStart=/usr/bin/node proxy.js
Restart=always
RestartSec=5
Environment=TUNNEL_URL=wss://cfref-tunnel.solitary-tree-e2c6.workers.dev
Environment=SESSION_ID=slsk-default
Environment=LISTEN_PORT=53312
Environment=LISTEN_HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable cfref-proxy
systemctl start cfref-proxy

echo "cfref proxy installed and running"
USERDATA
)

# Launch EC2 instance
echo "Launching EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "t2.micro" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "$USER_DATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
  --query "Instances[0].InstanceId" \
  --output text \
  --region "$REGION")
echo "Instance: $INSTANCE_ID"

# Wait for instance to be running
echo "Waiting for instance to start..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text \
  --region "$REGION")

echo ""
echo "=== Setup Complete ==="
echo "Instance ID: $INSTANCE_ID"
echo "Public IP: $PUBLIC_IP"
echo "TCP Proxy: $PUBLIC_IP:$PORT"
echo ""
echo "Soulseek peers connect to: $PUBLIC_IP:$PORT"
echo "Local client: node client/index.js"
echo ""
echo "SSH: ssh -i ${KEY_NAME}.pem ec2-user@$PUBLIC_IP"
echo "Logs: ssh -i ${KEY_NAME}.pem ec2-user@$PUBLIC_IP 'journalctl -u cfref-proxy -f'"
