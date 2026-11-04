import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { atPublicOrigin, parsePublicOrigin } from "../lib/public-origin.mjs";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    let publicOrigin: string | null;
    try {
      publicOrigin = parsePublicOrigin(env.GIROTRACK_PUBLIC_ORIGIN);
    } catch (error) {
      return new Response((error as Error).message, { status: 500 });
    }
    return runWithConnectorBinding(binding, async () => {
      // The body is read in full up front (uploads are capped at 15 MB). A request answered before
      // its body was read (a refusal, an expired sign-in) otherwise leaves it on the connection, and
      // the local runtime then stalls the next request sent on that connection.
      let incoming = request;
      if (request.body) incoming = new Request(request.url, { method: request.method, headers: request.headers, body: await request.arrayBuffer() });
      return handler.fetch(atPublicOrigin(incoming, publicOrigin), env, ctx);
    });
  },
};

export default worker;
