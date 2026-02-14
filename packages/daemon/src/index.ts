import { createRouterCore } from "@mcp-tool-router/core";
import type { RouterCore } from "@mcp-tool-router/core";
import type {
  SearchQueryInput,
  ToolCard,
  WorkingSetUpdateInput,
} from "@mcp-tool-router/shared";

export interface DaemonOptions {
  transport: "stdio" | "http";
  port?: number;
}

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  id?: JsonRpcId;
};
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const JSONRPC_VERSION = "2.0";

export function startDaemon(options: DaemonOptions): void {
  if (options.transport !== "stdio") {
    throw new Error(`Unsupported transport: ${options.transport}`);
  }

  const core = createRouterCore();
  const handlers = createRpcHandlers(core);

  process.stdin.setEncoding("utf8");

  let buffer = "";
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(rawLine, handlers);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  process.stdin.on("end", () => {
    const tail = buffer.trim();
    if (tail.length > 0) {
      handleLine(tail, handlers);
    }
  });
}

function handleLine(line: string, handlers: RpcHandlerMap): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    writeResponse(makeError(null, -32700, "Parse error"));
    return;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      writeResponse(makeError(null, -32600, "Invalid Request"));
      return;
    }
    const responses = payload
      .map((item) => handleRequest(item, handlers))
      .filter((response): response is JsonRpcResponse => response !== null);
    if (responses.length > 0) {
      writeResponse(responses);
    }
    return;
  }

  const response = handleRequest(payload, handlers);
  if (response) {
    writeResponse(response);
  }
}

function handleRequest(
  payload: unknown,
  handlers: RpcHandlerMap,
): JsonRpcResponse | null {
  if (!isRecord(payload)) {
    return makeError(null, -32600, "Invalid Request");
  }

  const id = isValidId(payload.id) ? payload.id : null;
  const method = payload.method;
  const jsonrpc = payload.jsonrpc;
  if (jsonrpc !== JSONRPC_VERSION || typeof method !== "string") {
    return makeError(id, -32600, "Invalid Request");
  }

  const handler = handlers[method];
  if (!handler) {
    return makeError(id, -32601, "Method not found");
  }

  const params = payload.params;
  try {
    const result = handler(params);
    if (payload.id === undefined) {
      return null;
    }
    return { jsonrpc: JSONRPC_VERSION, id, result };
  } catch (error) {
    if (payload.id === undefined) {
      return null;
    }
    if (error instanceof RpcError) {
      return makeError(id, error.code, error.message, error.data);
    }
    const message = error instanceof Error ? error.message : "Server error";
    return makeError(id, -32000, message);
  }
}

function writeResponse(response: JsonRpcResponse | JsonRpcResponse[]): void {
  const line = JSON.stringify(response);
  process.stdout.write(line + "\n");
}

function makeError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const errorPayload: JsonRpcResponse["error"] = { code, message };
  if (data !== undefined) {
    errorPayload.data = data;
  }
  return { jsonrpc: JSONRPC_VERSION, id, error: errorPayload };
}

type RpcHandler = (params: unknown) => unknown;
type RpcHandlerMap = Record<string, RpcHandler>;

class RpcError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

function createRpcHandlers(core: RouterCore): RpcHandlerMap {
  return {
    "catalog.upsertTools": (params) => {
      const payload = expectObject(params);
      const tools = expectArray(payload.tools);
      return core.catalog.upsertTools(tools as ToolCard[]);
    },
    "catalog.removeTools": (params) => {
      const payload = expectObject(params);
      const toolIds = expectStringArray(payload.toolIds);
      return core.catalog.removeTools(toolIds);
    },
    "catalog.reset": () => {
      core.catalog.reset();
      return {};
    },
    "catalog.stats": () => core.catalog.stats(),
    "search.query": (params) => {
      const payload = expectObject(params);
      const query = expectString(payload.query);
      const topK = optionalNumber(payload.topK);
      const filters = payload.filters;
      const weights = payload.weights;
      const mode =
        typeof payload.mode === "string" &&
        (payload.mode === "bm25" || payload.mode === "regex")
          ? (payload.mode as SearchQueryInput["mode"])
          : undefined;
      const input: SearchQueryInput = {
        query,
        topK: topK ?? undefined,
        filters: isRecord(filters)
          ? (filters as SearchQueryInput["filters"])
          : undefined,
        weights: isRecord(weights)
          ? (weights as SearchQueryInput["weights"])
          : undefined,
        sessionId:
          typeof payload.sessionId === "string" ? payload.sessionId : undefined,
        mode,
      };
      return core.search.query(input);
    },
    "ws.get": (params) => {
      const payload = expectObject(params);
      const sessionId = expectString(payload.sessionId);
      return core.workingSet.get(sessionId);
    },
    "ws.update": (params) => {
      const payload = expectObject(params);
      const sessionId = expectString(payload.sessionId);
      const query = expectString(payload.query);
      const budgetTokens = expectNumber(payload.budgetTokens);
      const topK = optionalNumber(payload.topK);
      const pin = optionalStringArray(payload.pin);
      const unpin = optionalStringArray(payload.unpin);
      const mode =
        typeof payload.mode === "string" &&
        (payload.mode === "bm25" || payload.mode === "regex")
          ? (payload.mode as WorkingSetUpdateInput["mode"])
          : undefined;
      const input: WorkingSetUpdateInput = {
        sessionId,
        query,
        budgetTokens,
        topK: topK ?? undefined,
        pin: pin ?? undefined,
        unpin: unpin ?? undefined,
        mode,
      };
      return core.workingSet.update(input);
    },
    "ws.markUsed": (params) => {
      const payload = expectObject(params);
      const sessionId = expectString(payload.sessionId);
      const toolId = expectString(payload.toolId);
      core.workingSet.markUsed(sessionId, toolId);
      return {};
    },
    "ws.reset": (params) => {
      const payload = expectObject(params);
      const sessionId = expectString(payload.sessionId);
      core.workingSet.reset(sessionId);
      return {};
    },
    "result.reduce": (params) => {
      const payload = expectObject(params);
      const toolId =
        typeof payload.toolId === "string" ? payload.toolId : undefined;
      if (!("rawResult" in payload)) {
        throw new RpcError(-32602, "Invalid params", {
          missing: ["rawResult"],
        });
      }
      return core.result.reduce(
        toolId,
        payload.rawResult,
        isRecord(payload.policy) ? payload.policy : undefined,
      );
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(id: unknown): id is JsonRpcId {
  return id === null || typeof id === "string" || typeof id === "number";
}

function expectObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RpcError(-32602, "Invalid params");
  }
  return value;
}

function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new RpcError(-32602, "Invalid params");
  }
  return value;
}

function expectStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RpcError(-32602, "Invalid params");
  }
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return expectStringArray(value);
}

function expectString(value: unknown): string {
  if (typeof value !== "string") {
    throw new RpcError(-32602, "Invalid params");
  }
  return value;
}

function expectNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RpcError(-32602, "Invalid params");
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return expectNumber(value);
}
