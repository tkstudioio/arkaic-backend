import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { createNodeWebSocket } from "@hono/node-ws";
import { verify } from "hono/jwt";

const clients = new Map<string, WSContext[]>();

export function sendToUser(pubkey: string, data: unknown) {
  const connections = clients.get(pubkey);
  if (!connections) return;
  const message = JSON.stringify(data);
  for (const ws of connections) {
    ws.send(message);
  }
}

export function setupWebSocket(app: Hono) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const token = c.req.query("token");
      let pubkey: string | undefined;
      let currentWs: WSContext | undefined;

      return {
        onOpen: async (_evt, ws) => {
          currentWs = ws;
          try {
            const secret = process.env.JWT_SECRET;
            if (!secret || !token) {
              ws.close(1008, "Unauthorized");
              return;
            }
            const payload = await verify(token, secret, "HS256");
            pubkey = payload.sub as string;
            console.log(`WebSocket connected: ${pubkey}`);

            const existing = clients.get(pubkey) ?? [];
            existing.push(ws);
            clients.set(pubkey, existing);

            ws.send(JSON.stringify({ type: "hello", pubkey }));
          } catch {
            ws.close(1008, "Unauthorized");
          }
        },
        onClose: () => {
          if (pubkey && currentWs) {
            const existing = clients.get(pubkey);
            if (existing) {
              const filtered = existing.filter((c) => c !== currentWs);
              if (filtered.length === 0) {
                clients.delete(pubkey);
              } else {
                clients.set(pubkey, filtered);
              }
            }
            console.log(`WebSocket disconnected: ${pubkey}`);
          }
        },
      };
    }),
  );

  return { injectWebSocket };
}
