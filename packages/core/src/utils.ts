export interface TruncateResult {
  text: string;
  droppedBytes: number;
}

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function truncateByBytes(text: string, maxBytes: number): TruncateResult {
  if (maxBytes <= 0) {
    return { text: "", droppedBytes: byteLength(text) };
  }

  const totalBytes = byteLength(text);
  if (totalBytes <= maxBytes) {
    return { text, droppedBytes: 0 };
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const slice = text.slice(0, mid);
    if (byteLength(slice) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const truncated = text.slice(0, low);
  const droppedBytes = totalBytes - byteLength(truncated);
  return { text: truncated, droppedBytes };
}

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(byteLength(text) / 4));
}

function sortValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    return "[Circular]";
  }
  seen.add(obj);

  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry, seen));
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    sorted[key] = sortValue(record[key], seen);
  }
  return sorted;
}

export function stableStringify(value: unknown): string {
  try {
    const sorted = sortValue(value, new WeakSet<object>());
    return JSON.stringify(sorted);
  } catch {
    return JSON.stringify("[Unserializable]");
  }
}
