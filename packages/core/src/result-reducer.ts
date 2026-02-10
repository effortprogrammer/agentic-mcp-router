import type { ResultReducer } from "./core.js";
import type { ReducedToolResult } from "@mcp-tool-router/shared";
import { byteLength, stableStringify, truncateByBytes } from "./utils.js";

export interface ResultReducerOptions {
  maxTextBytes?: number;
  maxStructuredBytes?: number;
  maxStructuredKeys?: number;
  maxStructuredItems?: number;
  maxDepth?: number;
}

const DEFAULT_OPTIONS: Required<ResultReducerOptions> = {
  maxTextBytes: 12_000,
  maxStructuredBytes: 24_000,
  maxStructuredKeys: 200,
  maxStructuredItems: 200,
  maxDepth: 6
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (block && typeof block === "object") {
      const maybeText = (block as { text?: unknown }).text;
      if (typeof maybeText === "string") {
        parts.push(maybeText);
      }
    }
  }
  return parts.join("\n");
}

function reduceStructuredValue(value: unknown, options: Required<ResultReducerOptions>, depth = 0): unknown {
  if (depth >= options.maxDepth) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, options.maxStructuredItems);
    return value.slice(0, limit).map((entry) => reduceStructuredValue(entry, options, depth + 1));
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const limit = Math.min(keys.length, options.maxStructuredKeys);
    const reduced: Record<string, unknown> = {};
    for (let i = 0; i < limit; i += 1) {
      const key = keys[i];
      if (!key) {
        continue;
      }
      reduced[key] = reduceStructuredValue(value[key], options, depth + 1);
    }
    return reduced;
  }

  return value;
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export class DefaultResultReducer implements ResultReducer {
  private options: Required<ResultReducerOptions>;

  constructor(options: ResultReducerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  reduce(toolId: string | undefined, rawResult: unknown, policy?: Record<string, unknown>): ReducedToolResult {
    const mergedOptions = this.mergePolicy(policy);
    const notes: string[] = [];

    let text = "";
    let structured: object | undefined;
    const isError = isPlainObject(rawResult) && rawResult.isError === true;

    if (rawResult === null || rawResult === undefined) {
      text = "";
    } else if (typeof rawResult === "string") {
      text = rawResult;
      const parsed = tryParseJson(rawResult);
      if (parsed && typeof parsed === "object") {
        structured = parsed as object;
        notes.push("parsed_json");
      }
    } else if (typeof rawResult === "object") {
      if (isPlainObject(rawResult)) {
        const maybeStructured = rawResult.structured ?? rawResult.structuredContent;
        if (maybeStructured && typeof maybeStructured === "object") {
          structured = maybeStructured as object;
          notes.push("structured_preferred");
        }
        const textField = rawResult.text;
        if (typeof textField === "string") {
          text = textField;
        } else {
          const contentText = extractTextFromContent(rawResult.content);
          if (contentText) {
            text = contentText;
          }
        }
      }

      if (!structured) {
        structured = rawResult as object;
      }

      if (!text) {
        text = stableStringify(rawResult);
      }
    } else {
      text = String(rawResult);
    }

    let droppedBytes = 0;
    if (isError) {
      notes.push("is_error");
      if (text) {
        text = `[error] ${text}`;
      } else {
        text = "[error]";
      }
    }

    if (structured) {
      const beforeBytes = byteLength(stableStringify(structured));
      let reduced = reduceStructuredValue(structured, mergedOptions) as object;
      let afterJson = stableStringify(reduced);
      let afterBytes = byteLength(afterJson);

      if (afterBytes > mergedOptions.maxStructuredBytes) {
        reduced = undefined as unknown as object;
        notes.push("structured_dropped");
      } else if (afterBytes < beforeBytes) {
        notes.push("structured_trimmed");
      }

      if (reduced) {
        structured = reduced;
        droppedBytes += Math.max(0, beforeBytes - afterBytes);
      } else {
        droppedBytes += beforeBytes;
        structured = undefined;
      }
    }

    const textBytes = byteLength(text);
    if (textBytes > mergedOptions.maxTextBytes) {
      const truncated = truncateByBytes(text, mergedOptions.maxTextBytes);
      text = truncated.text;
      droppedBytes += truncated.droppedBytes;
      notes.push("text_truncated");
    }

    const droppedTokensEstimate = droppedBytes > 0 ? Math.ceil(droppedBytes / 4) : 0;

    return {
      text,
      structured,
      droppedBytes,
      droppedTokensEstimate,
      notes
    };
  }

  private mergePolicy(policy?: Record<string, unknown>): Required<ResultReducerOptions> {
    if (!policy) {
      return this.options;
    }

    const readNumber = (key: keyof ResultReducerOptions, fallback: number): number => {
      const value = policy[key];
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };

    return {
      maxTextBytes: readNumber("maxTextBytes", this.options.maxTextBytes),
      maxStructuredBytes: readNumber("maxStructuredBytes", this.options.maxStructuredBytes),
      maxStructuredKeys: readNumber("maxStructuredKeys", this.options.maxStructuredKeys),
      maxStructuredItems: readNumber("maxStructuredItems", this.options.maxStructuredItems),
      maxDepth: readNumber("maxDepth", this.options.maxDepth)
    };
  }
}
