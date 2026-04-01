const WebSocket = require("ws");
const net = require("net");

const SESSION = "slsk-test";
const WORKER = "wss://cfref-tunnel.solitary-tree-e2c6.workers.dev";

// Start local client
const localWs = new WebSocket(`${WORKER}/tunnel/${SESSION}/register`);
localWs.on("open", () => {
  console.log("[local] Connected to tunnel as session:", SESSION);
});

localWs.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("[local] Got:", msg.type, msg.peerId || "");

  if (msg.type === "peer_connected") {
    const tcp = new net.Socket();
    tcp.connect(53312, "127.0.0.1", () => {
      console.log("[local] TCP connected to Soulseek for peer", msg.peerId);
    });
    tcp.on("data", (d) => {
      localWs.send(JSON.stringify({ type: "peer_data", peerId: msg.peerId, data: d.toString("base64") }));
    });
    tcp.on("close", () => {
      localWs.send(JSON.stringify({ type: "peer_closed", peerId: msg.peerId }));
    });
  }

  if (msg.type === "peer_data") {
    // would forward to TCP
  }
});

localWs.on("error", (e) => console.error("[local] Error:", e.message));

// After 2s, connect as peer
setTimeout(() => {
  console.log("\n[peer] Connecting to tunnel...");
  const peerWs = new WebSocket(`${WORKER}/tunnel/${SESSION}/connect`);
  peerWs.on("open", () => {
    console.log("[peer] Connected! Sending test data...");
    peerWs.send("test data from peer");
  });
  peerWs.on("message", (d) => {
    console.log("[peer] Received:", d.toString().slice(0, 200));
  });
  peerWs.on("error", (e) => console.error("[peer] Error:", e.message));
  peerWs.on("close", (c, r) => console.log("[peer] Closed:", c, r.toString()));

  setTimeout(() => process.exit(0), 8000);
}, 2000);
