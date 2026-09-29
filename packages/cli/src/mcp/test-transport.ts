import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * The SDK ships a `StdioServerTransport` (real stdio) but no in-memory pair in this version, so
 * one client/server transport, linked by two callbacks, stands in for a real connection. Tests
 * then go through the SDK's own client, request/response framing and zod input validation.
 */
export function linkedTransportPair(): [Transport, Transport] {
  const a: Transport = {
    start: async () => {},
    close: async () => {
      a.onclose?.();
    },
    send: async (message: JSONRPCMessage) => {
      b.onmessage?.(message);
    },
  };
  const b: Transport = {
    start: async () => {},
    close: async () => {
      b.onclose?.();
    },
    send: async (message: JSONRPCMessage) => {
      a.onmessage?.(message);
    },
  };
  return [a, b];
}

/** A client connected to `server` in memory; close both when done. `name` is its clientInfo.name. */
export async function connectClient(server: McpServer, name = "test-client"): Promise<Client> {
  const client = new Client({ name, version: "0.0.0" });
  const [clientTransport, serverTransport] = linkedTransportPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}
