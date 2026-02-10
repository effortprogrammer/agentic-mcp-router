export interface Tokenizer {
  tokenize(text: string): string[];
  normalize(text: string): string;
}

export interface TokenizerOptions {
  stopwords?: string[];
  minTokenLength?: number;
}

const DEFAULT_MIN_TOKEN_LENGTH = 1;

function normalizeText(text: string): string {
  if (!text) {
    return "";
  }

  let normalized = text.replace(/[_\-]+/g, " ");
  normalized = normalized.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  normalized = normalized.replace(/([A-Za-z])([0-9])/g, "$1 $2");
  normalized = normalized.replace(/([0-9])([A-Za-z])/g, "$1 $2");
  normalized = normalized.toLowerCase();
  normalized = normalized.replace(/[^a-z0-9]+/g, " ");
  return normalized.trim();
}

export class SimpleTokenizer implements Tokenizer {
  private stopwords: Set<string>;
  private minTokenLength: number;

  constructor(options: TokenizerOptions = {}) {
    this.stopwords = new Set((options.stopwords ?? []).map((word) => word.toLowerCase()));
    this.minTokenLength = Math.max(1, options.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH);
  }

  normalize(text: string): string {
    return normalizeText(text);
  }

  tokenize(text: string): string[] {
    const normalized = normalizeText(text);
    if (!normalized) {
      return [];
    }

    const parts = normalized.split(/\s+/g);
    const tokens: string[] = [];
    for (const part of parts) {
      if (part.length < this.minTokenLength) {
        continue;
      }
      if (this.stopwords.size > 0 && this.stopwords.has(part)) {
        continue;
      }
      tokens.push(part);
    }
    return tokens;
  }
}

export function normalizeForMatch(tokenizer: Tokenizer, text: string): string {
  return tokenizer.normalize(text).replace(/\s+/g, "");
}
