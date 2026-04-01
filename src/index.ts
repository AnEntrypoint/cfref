/**
 * cfref - TCP/UDP Tunnel via Cloudflare Workers
 * 
 * Architecture:
 * - Client connects via WebSocket to Worker
 * - Worker creates Durable Object for each tunnel session
 * - Durable Object maintains TCP connection to target server
 * - Data flows: Client <-> Worker <-> Durable Object <-> Target TCP Server
 */

export { TunnelSession } from "./tunnel-session";

export interface Env {
  TUNNEL_SESSIONS: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade for tunnel connections
    if (url.pathname === "/tunnel" || url.pathname.startsWith("/tunnel/")) {
      return handleTunnel(request, env);
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "cfref-tunnel" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // API for creating tunnel sessions
    if (url.pathname === "/api/create" && request.method === "POST") {
      return handleCreateSession(request, env);
    }

    return new Response("cfref-tunnel: TCP/UDP Tunnel Service\n", { status: 200 });
  }
};

async function handleTunnel(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session") || url.pathname.split("/").pop();

  if (!sessionId) {
    return new Response("Missing session ID", { status: 400 });
  }

  // Get or create the Durable Object for this session
  const doId = env.TUNNEL_SESSIONS.idFromName(sessionId);
  const doStub = env.TUNNEL_SESSIONS.get(doId);

  // Forward to Durable Object
  return doStub.fetch(request);
}

async function handleCreateSession(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { targetHost: string; targetPort: number; clientToken?: string };
    const { targetHost, targetPort, clientToken } = body;

    if (!targetHost || !targetPort) {
      return new Response(JSON.stringify({ error: "Missing targetHost or targetPort" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Generate session ID
    const sessionId = crypto.randomUUID();
    
    // Store session config in Durable Object
    const doId = env.TUNNEL_SESSIONS.idFromName(sessionId);
    const doStub = env.TUNNEL_SESSIONS.get(doId);

    // Initialize the session
    const initResponse = await doStub.fetch(new Request("http://internal/init"), {
      method: "POST",
      body: JSON.stringify({ targetHost, targetPort, clientToken })
    });

    if (!initResponse.ok) {
      return new Response(JSON.stringify({ error: "Failed to create session" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ 
      sessionId, 
      endpoint: `/tunnel/${sessionId}`,
      wsEndpoint: `wss://${new URL(request.url).host}/tunnel/${sessionId}`
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
}

function getUrl(request: Request): string {
  return request.url;
}
