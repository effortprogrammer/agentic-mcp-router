export interface Tokenizer {
  tokenize(text: string): string[];
  normalize(text: string): string;
}

export interface TokenizerOptions {
  stopwords?: string[];
  minTokenLength?: number;
}

const DEFAULT_MIN_TOKEN_LENGTH = 2;

const DEFAULT_STOPWORDS = [
  "a", "an", "the", "in", "on", "at", "to", "for", "of", "with", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "under",
  "and", "or", "but", "so", "yet", "nor", "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall",
  "get", "use", "make", "take", "go", "come", "see", "know", "look", "find", "give", "tell", "ask", "work", "seem", "feel", "try", "leave", "call",
  "any", "all", "some", "many", "much", "more", "most", "other", "another", "such", "only", "own", "same", "few", "lot",
  "so", "just", "now", "then", "here", "there", "up", "down", "out", "off", "over", "again", "further", "once", "too", "very",
  "this", "that", "these", "those", "than", "also", "back", "after", "used", "using",
  "please", "help", "sure", "way", "need", "want", "like", "new", "good", "best", "well", "easy", "simple", "quick", "fast", "available", "ready", "clean",
];

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
    const stopwordsList = options.stopwords ?? DEFAULT_STOPWORDS;
    this.stopwords = new Set(stopwordsList.map((word) => word.toLowerCase()));
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
