export { TunnelSession } from "./tunnel-session";

export interface Env {
  TUNNEL_SESSIONS: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "cfref-tunnel" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname.startsWith("/tunnel/")) {
      const parts = url.pathname.split("/");
      const sessionId = parts[2];
      const action = parts[3];

      if (!sessionId) {
        return new Response("Missing session ID", { status: 400 });
      }

      const doId = env.TUNNEL_SESSIONS.idFromName(sessionId);
      const doStub = env.TUNNEL_SESSIONS.get(doId);

      if (action === "register") {
        const internalUrl = new URL(request.url);
        internalUrl.pathname = "/internal/register";
        return doStub.fetch(new Request(internalUrl.toString(), request));
      }

      if (action === "connect") {
        const internalUrl = new URL(request.url);
        internalUrl.pathname = "/internal/connect";
        return doStub.fetch(new Request(internalUrl.toString(), request));
      }

      return doStub.fetch(request);
    }

    return new Response("cfref-tunnel: TCP Tunnel Service\n", { status: 200 });
  }
};
