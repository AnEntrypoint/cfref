import { connect, Socket } from "cloudflare:sockets";

export class TunnelSession {
  private localClient: WebSocket | null = null;
  private peers: Map<string, WebSocket> = new Map();
  private localSockets: Map<string, Socket> = new Map();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/register")) {
      return this.handleRegister(request);
    }

    if (url.pathname.endsWith("/connect")) {
      return this.handlePeerConnect(request);
    }

    return new Response(JSON.stringify({
      hasLocalClient: this.localClient !== null,
      peerCount: this.peers.size
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private async handleRegister(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    if (this.localClient) {
      return new Response("Session already has a local client", { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[1];
    const server = pair[0];

    this.localClient = server;
    server.accept();

    server.addEventListener("message", (event) => {
      this.handleLocalMessage(event);
    });

    server.addEventListener("close", () => {
      this.handleLocalDisconnect();
    });

    server.addEventListener("error", () => {
      this.handleLocalDisconnect();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handlePeerConnect(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    if (!this.localClient) {
      return new Response("No local client connected", { status: 503 });
    }

    const peerId = crypto.randomUUID();
    const pair = new WebSocketPair();
    const client = pair[1];
    const server = pair[0];

    this.peers.set(peerId, server);
    server.accept();

    server.addEventListener("message", (event) => {
      this.handlePeerMessage(peerId, event);
    });

    server.addEventListener("close", () => {
      this.handlePeerDisconnect(peerId);
    });

    server.addEventListener("error", () => {
      this.handlePeerDisconnect(peerId);
    });

    this.localClient.send(JSON.stringify({
      type: "peer_connected",
      peerId
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleLocalMessage(event: MessageEvent) {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "peer_data" && msg.peerId) {
          const peer = this.peers.get(msg.peerId);
          if (peer) {
            try {
              const binary = atob(msg.data);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              peer.send(bytes);
            } catch {
              this.handlePeerDisconnect(msg.peerId);
            }
          }
        }
        if (msg.type === "peer_closed" && msg.peerId) {
          const peer = this.peers.get(msg.peerId);
          if (peer) {
            try { peer.close(1000); } catch {}
            this.peers.delete(msg.peerId);
          }
        }
      } catch {}
    }
  }

  private async handlePeerMessage(peerId: string, event: MessageEvent) {
    if (!this.localClient) return;

    try {
      let data: string;
      if (typeof event.data === "string") {
        data = btoa(event.data);
      } else {
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        data = btoa(binary);
      }

      this.localClient.send(JSON.stringify({
        type: "peer_data",
        peerId,
        data
      }));
    } catch {
      this.handlePeerDisconnect(peerId);
    }
  }

  private handlePeerDisconnect(peerId: string) {
    this.peers.delete(peerId);
    if (this.localClient) {
      try {
        this.localClient.send(JSON.stringify({
          type: "peer_disconnected",
          peerId
        }));
      } catch {}
    }
  }

  private handleLocalDisconnect() {
    this.localClient = null;
    for (const [peerId, peer] of this.peers) {
      try { peer.close(1011, "Local client disconnected"); } catch {}
    }
    this.peers.clear();
    for (const [, socket] of this.localSockets) {
      try { socket.close(); } catch {}
    }
    this.localSockets.clear();
  }
}
