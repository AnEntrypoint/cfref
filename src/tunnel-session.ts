/**
 * TunnelSession - Durable Object for TCP tunnel session
 * 
 * Manages a single TCP connection to a target server.
 * Data flows bidirectionally between:
 * - Client WebSocket <-> This DO <-> Target TCP Server
 */

import { connect, Socket } from "cloudflare:sockets";

export interface TunnelConfig {
  targetHost: string;
  targetPort: number;
  clientToken?: string;
}

export class TunnelSession {
  private socket: Socket | null = null;
  private config: TunnelConfig | null = null;
  private clientSocket: WebSocket | null = null;

  constructor(private state: DurableObjectState) {
    // Set up alarm for connection health checks
    this.state.storage.put("lastActivity", Date.now());
  }

  async fetch(request: Request): Promise<Response> {
    // Handle session initialization
    if (request.method === "POST" && request.url === "http://internal/init") {
      return this.initializeSession(request);
    }

    // WebSocket upgrade for client connection
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader === "websocket") {
      return this.handleWebSocket(request);
    }

    // Regular HTTP - return session status
    return new Response(JSON.stringify({
      status: this.socket ? "connected" : "disconnected",
      config: this.config
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private async initializeSession(request: Request): Promise<Response> {
    try {
      const body = await request.json() as TunnelConfig;
      this.config = body;
      
      await this.state.storage.put("config", body);
      await this.state.storage.put("lastActivity", Date.now());

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid config" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    if (!this.config) {
      return new Response("Session not initialized", { status: 400 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const clientSocket = pair[1];
    const serverSocket = pair[0];

    // @ts-expect-error - ServerWebSocket is not in the types
    this.clientSocket = serverSocket as unknown as WebSocket;

    // @ts-expect-error - ServerWebSocket methods
    serverSocket.accept();
    
    // @ts-expect-error - ServerWebSocket event handlers
    serverSocket.addEventListener("message", async (event) => {
      await this.handleClientData(event);
    });
    
    // @ts-expect-error - ServerWebSocket event handlers
    serverSocket.addEventListener("close", async () => {
      await this.handleClientClose();
    });

    // @ts-expect-error - ServerWebSocket event handlers
    serverSocket.addEventListener("error", async (event) => {
      console.error("WebSocket error:", event);
      await this.cleanup();
    });

    try {
      // Connect to target TCP server
      await this.connectToTarget();
    } catch (e) {
      console.error("Failed to connect to target:", e);
      // @ts-expect-error - ServerWebSocket close
      serverSocket.close(1011, "Failed to connect to target");
      return new Response(null, { status: 101, webSocket: clientSocket });
    }

    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  private async connectToTarget(): Promise<void> {
    if (!this.config) {
      throw new Error("No config");
    }

    const { targetHost, targetPort } = this.config;

    // Use Cloudflare's connect() API to create TCP socket
    this.socket = await connect({
      hostname: targetHost,
      port: targetPort
    });

    // @ts-expect-error - Socket data event
    this.socket.addEventListener("data", async (event) => {
      await this.handleTargetData(event);
    });

    // @ts-expect-error - Socket close event
    this.socket.addEventListener("close", async () => {
      await this.handleTargetClose();
    });

    // @ts-expect-error - Socket error event
    this.socket.addEventListener("error", async (event) => {
      console.error("Target socket error:", event);
      await this.cleanup();
    });

    console.log(`Connected to ${targetHost}:${targetPort}`);
  }

  private async handleClientData(event: MessageEvent): Promise<void> {
    if (!this.socket) {
      console.error("No target socket");
      return;
    }

    try {
      // Write data to target server
      const encoder = new TextEncoder();
      const data = typeof event.data === "string" 
        ? encoder.encode(event.data) 
        : event.data;
      
      this.socket.write(data);
      await this.state.storage.put("lastActivity", Date.now());
    } catch (e) {
      console.error("Error writing to target:", e);
      await this.cleanup();
    }
  }

  private async handleTargetData(event: MessageEvent): Promise<void> {
    if (!this.clientSocket) {
      return;
    }

    try {
      // Forward data to client via WebSocket
      // @ts-expect-error - ServerWebSocket send
      this.clientSocket.send(event.data);
      await this.state.storage.put("lastActivity", Date.now());
    } catch (e) {
      console.error("Error sending to client:", e);
    }
  }

  private async handleClientClose(): Promise<void> {
    console.log("Client disconnected");
    await this.cleanup();
  }

  private async handleTargetClose(): Promise<void> {
    console.log("Target disconnected");
    
    // Notify client that target closed
    if (this.clientSocket) {
      try {
        // @ts-expect-error - ServerWebSocket close
        this.clientSocket.close(1000, "Target closed connection");
      } catch (e) {
        // Ignore
      }
    }
    
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    try {
      if (this.clientSocket) {
        // @ts-expect-error - ServerWebSocket close
        this.clientSocket.close();
        this.clientSocket = null;
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}
