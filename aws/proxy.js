const net = require("net");
const WebSocket = require("ws");

const TUNNEL_URL = process.env.TUNNEL_URL || "wss://cfref-tunnel.solitary-tree-e2c6.workers.dev";
const SESSION_ID = process.env.SESSION_ID || "slsk-default";
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "53312", 10);
const LISTEN_HOST = process.env.LISTEN_HOST || "0.0.0.0";

const server = net.createServer((tcpSocket) => {
  const peerId = Math.random().toString(36).slice(2, 10);
  console.log(`[tcp] Incoming connection: ${peerId} from ${tcpSocket.remoteAddress}`);

  const wsUrl = `${TUNNEL_URL}/tunnel/${SESSION_ID}/connect`;
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log(`[ws] Tunnel connected for peer ${peerId}`);
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
    console.log(`[tcp] Connection closed: ${peerId}`);
    try { ws.send(JSON.stringify({ type: "peer_closed", peerId })); } catch {}
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  tcpSocket.on("error", (err) => {
    console.error(`[tcp] Error for ${peerId}:`, err.message);
    try { ws.send(JSON.stringify({ type: "peer_closed", peerId })); } catch {}
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on("close", () => {
    console.log(`[ws] Tunnel closed for peer ${peerId}`);
    if (!tcpSocket.destroyed) tcpSocket.destroy();
  });

  ws.on("error", (err) => {
    console.error(`[ws] Error for ${peerId}:`, err.message);
    if (!tcpSocket.destroyed) tcpSocket.destroy();
  });
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`cfref TCP proxy listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`Tunneling to: ${TUNNEL_URL}/tunnel/${SESSION_ID}`);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
