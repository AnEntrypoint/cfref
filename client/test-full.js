const { spawn } = require("child_process");
const WebSocket = require("ws");

const client = spawn("node", ["client/index.js"], { cwd: __dirname + "/.." });
client.stdout.on("data", (d) => console.log("[client]", d.toString().trim()));
client.stderr.on("data", (d) => console.error("[client ERR]", d.toString().trim()));

setTimeout(() => {
  console.log("\n[test] Connecting as peer...");
  const ws = new WebSocket("wss://cfref-tunnel.solitary-tree-e2c6.workers.dev/tunnel/slsk-default/connect");

  ws.on("open", () => {
    console.log("[test] Peer connected through tunnel!");
    ws.send(Buffer.from([0x01, 0x00, 0x00, 0x00]));
    console.log("[test] Sent test bytes to Soulseek");
  });

  ws.on("message", (d) => {
    console.log("[test] Received from Soulseek:", Buffer.from(d).toString("hex").slice(0, 60));
  });

  ws.on("error", (e) => console.error("[test] Error:", e.message));
  ws.on("close", (c) => console.log("[test] Closed:", c));

  setTimeout(() => {
    client.kill();
    process.exit(0);
  }, 6000);
}, 4000);
