const WebSocket = require("ws");
const net = require("net");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "tunnel-config.json");

let config = {
  workerUrl: process.env.TUNNEL_URL || "wss://cfref-tunnel.solitary-tree-e2c6.workers.dev",
  sessionId: process.env.SESSION_ID || "slsk-default",
  localHost: process.env.LOCAL_HOST || "127.0.0.1",
  localPort: parseInt(process.env.LOCAL_PORT || "53312", 10),
};

try {
  const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  Object.assign(config, saved);
} catch {}

const { workerUrl, sessionId, localHost, localPort } = config;
const peers = new Map();
let ws = null;
let reconnectTimer = null;

function connect() {
  const url = `${workerUrl}/tunnel/${sessionId}/register`;
  console.log(`[tunnel] Registering session: ${sessionId}`);
  console.log(`[tunnel] Forwarding to: ${localHost}:${localPort}`);

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`[tunnel] Connected. Peer endpoint: ${workerUrl.replace("wss://", "https://")}/tunnel/${sessionId}/connect`);
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "peer_connected":
        handlePeer(msg.peerId);
        break;
      case "peer_data":
        forwardToTcp(msg.peerId, msg.data);
        break;
      case "peer_disconnected":
        cleanupPeer(msg.peerId);
        break;
    }
  });

  ws.on("close", () => {
    console.log("[tunnel] Disconnected. Reconnecting in 3s...");
    cleanup();
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    console.error("[tunnel] Error:", err.message);
  });
}

function handlePeer(peerId) {
  console.log(`[peer] Connected: ${peerId.slice(0, 8)}`);
  const socket = new net.Socket();
  const entry = { socket, buffer: [] };
  peers.set(peerId, entry);

  socket.connect(localPort, localHost, () => {
    console.log(`[peer] TCP relay active for ${peerId.slice(0, 8)}`);
    for (const buf of entry.buffer) socket.write(buf);
    entry.buffer = [];
  });

  socket.on("data", (data) => {
    try {
      ws.send(JSON.stringify({
        type: "peer_data",
        peerId,
        data: data.toString("base64")
      }));
    } catch {}
  });

  socket.on("close", () => {
    try { ws.send(JSON.stringify({ type: "peer_closed", peerId })); } catch {}
    peers.delete(peerId);
  });

  socket.on("error", () => {
    try { ws.send(JSON.stringify({ type: "peer_closed", peerId })); } catch {}
    peers.delete(peerId);
  });
}

function forwardToTcp(peerId, data) {
  const entry = peers.get(peerId);
  if (!entry) return;
  const buf = Buffer.from(data, "base64");
  if (entry.socket && !entry.socket.destroyed) {
    entry.socket.write(buf);
  } else {
    entry.buffer.push(buf);
  }
}

function cleanupPeer(peerId) {
  const entry = peers.get(peerId);
  if (entry?.socket) entry.socket.destroy();
  peers.delete(peerId);
}

function cleanup() {
  for (const [, entry] of peers) {
    if (entry.socket) entry.socket.destroy();
  }
  peers.clear();
}

process.on("SIGINT", () => {
  console.log("\n[tunnel] Shutting down...");
  clearTimeout(reconnectTimer);
  cleanup();
  if (ws) ws.close();
  process.exit(0);
});

console.log("cfref tunnel client for Soulseek");
connect();
