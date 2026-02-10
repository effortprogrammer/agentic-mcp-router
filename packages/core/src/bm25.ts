import type { SearchEngine } from "./core.js";
import type { CatalogSnapshot } from "./catalog.js";
import type { Tokenizer } from "./tokenizer.js";
import { normalizeForMatch } from "./tokenizer.js";
import type {
  Bm25FieldWeights,
  SearchFilters,
  SearchQueryInput,
  SearchQueryResult,
  ToolCard,
  ToolSearchDoc,
  ToolSearchHit
} from "@mcp-tool-router/shared";
import { DEFAULT_WEIGHTS } from "@mcp-tool-router/shared";

export interface CatalogProvider {
  getSnapshot(): CatalogSnapshot;
}

export interface Bm25SearchOptions {
  k1?: number;
  b?: number;
  exactMatchBoost?: number;
  prefixMatchBoost?: number;
  popularityBoost?: number;
  minScore?: number;
  defaultTopK?: number;
}

type FieldKey =
  | "name"
  | "title"
  | "synonyms"
  | "description"
  | "argNames"
  | "argDescs"
  | "tags"
  | "examples"
  | "serverId";

const FIELD_KEYS: FieldKey[] = [
  "name",
  "title",
  "synonyms",
  "description",
  "argNames",
  "argDescs",
  "tags",
  "examples",
  "serverId"
];

const DEFAULT_OPTIONS: Required<Bm25SearchOptions> = {
  k1: 1.2,
  b: 0.75,
  exactMatchBoost: 1.5,
  prefixMatchBoost: 0.4,
  popularityBoost: 0.05,
  minScore: 0,
  defaultTopK: 20
};

interface DocEntry {
  tool: ToolCard;
  doc: ToolSearchDoc;
  fieldTokenCounts: Record<FieldKey, Map<string, number>>;
  fieldLengths: Record<FieldKey, number>;
  uniqueTokens: Set<string>;
}

function createFieldRecord<T>(init: () => T): Record<FieldKey, T> {
  const record = {} as Record<FieldKey, T>;
  for (const field of FIELD_KEYS) {
    record[field] = init();
  }
  return record;
}

function mergeWeights(overrides?: Partial<Bm25FieldWeights>): Bm25FieldWeights {
  return {
    ...DEFAULT_WEIGHTS,
    ...(overrides ?? {})
  };
}

function normalizeFilterList(values?: string[]): Set<string> {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}

function matchesFilters(tool: ToolCard, filters?: SearchFilters): boolean {
  if (!filters) {
    return true;
  }

  if (filters.serverIds && filters.serverIds.length > 0) {
    const allowed = normalizeFilterList(filters.serverIds);
    if (!allowed.has(tool.serverId.toLowerCase())) {
      return false;
    }
  }

  if (filters.sideEffects && filters.sideEffects.length > 0) {
    const sideEffect = tool.sideEffect ?? "none";
    if (!filters.sideEffects.includes(sideEffect)) {
      return false;
    }
  }

  if (filters.tags && filters.tags.length > 0) {
    const wanted = normalizeFilterList(filters.tags);
    const toolTags = tool.tags.map((tag) => tag.toLowerCase());
    const hasTag = toolTags.some((tag) => wanted.has(tag));
    if (!hasTag) {
      return false;
    }
  }

  return true;
}

class Bm25Index {
  private entries: DocEntry[] = [];
  private docFreq = new Map<string, number>();
  private avgFieldLength: Record<FieldKey, number> = createFieldRecord(() => 0);
  private docCount = 0;

  build(snapshot: CatalogSnapshot, tokenizer: Tokenizer): void {
    this.entries = [];
    this.docFreq.clear();
    this.avgFieldLength = createFieldRecord(() => 0);
    this.docCount = snapshot.docs.size;

    for (const [toolId, doc] of snapshot.docs.entries()) {
      const tool = snapshot.tools.get(toolId);
      if (!tool) {
        continue;
      }

      const fieldTokenCounts = createFieldRecord(() => new Map<string, number>());
      const fieldLengths = createFieldRecord(() => 0);
      const uniqueTokens = new Set<string>();

      for (const field of FIELD_KEYS) {
        const tokens = tokenizer.tokenize(doc[field]);
        const counts = new Map<string, number>();
        for (const token of tokens) {
          counts.set(token, (counts.get(token) ?? 0) + 1);
        }
        fieldTokenCounts[field] = counts;
        fieldLengths[field] = tokens.length;
        for (const token of new Set(tokens)) {
          uniqueTokens.add(token);
        }
      }

      for (const token of uniqueTokens) {
        this.docFreq.set(token, (this.docFreq.get(token) ?? 0) + 1);
      }

      this.entries.push({ tool, doc, fieldTokenCounts, fieldLengths, uniqueTokens });
    }

    if (this.docCount === 0) {
      return;
    }

    for (const field of FIELD_KEYS) {
      let total = 0;
      for (const entry of this.entries) {
        total += entry.fieldLengths[field];
      }
      this.avgFieldLength[field] = total / this.docCount;
    }
  }

  score(
    queryTokens: string[],
    queryTokenCounts: Map<string, number>,
    queryText: string,
    weights: Bm25FieldWeights,
    options: Required<Bm25SearchOptions>,
    tokenizer: Tokenizer,
    filters?: SearchFilters
  ): ToolSearchHit[] {
    if (queryTokens.length === 0 || this.docCount === 0) {
      return [];
    }

    const normalizedQuery = queryText.trim();
    const hits: ToolSearchHit[] = [];

    for (const entry of this.entries) {
      if (!matchesFilters(entry.tool, filters)) {
        continue;
      }

      let score = 0;
      for (const token of queryTokens) {
        const df = this.docFreq.get(token);
        if (!df) {
          continue;
        }

        const idf = Math.log(1 + (this.docCount - df + 0.5) / (df + 0.5));
        const qtf = queryTokenCounts.get(token) ?? 1;
        const termWeight = idf * (1 + Math.log(qtf));

        for (const field of FIELD_KEYS) {
          const tf = entry.fieldTokenCounts[field].get(token) ?? 0;
          if (tf === 0) {
            continue;
          }
          const fieldLen = entry.fieldLengths[field];
          const avgLen = this.avgFieldLength[field] || 1;
          const norm = fieldLen / avgLen;
          const denom = tf + options.k1 * (1 - options.b + options.b * norm);
          const tfScore = denom > 0 ? (tf * (options.k1 + 1)) / denom : 0;
          score += weights[field] * termWeight * tfScore;
        }
      }

      if (normalizedQuery) {
        const normalizedName = normalizeForMatch(tokenizer, entry.doc.name);
        const normalizedQueryName = normalizeForMatch(tokenizer, normalizedQuery);
        if (normalizedName && normalizedName === normalizedQueryName) {
          score += options.exactMatchBoost;
        } else if (normalizedName && normalizedQueryName && normalizedName.startsWith(normalizedQueryName)) {
          score += options.prefixMatchBoost;
        }
      }

      if (typeof entry.tool.popularity === "number") {
        const popularity = Math.max(0, entry.tool.popularity);
        score += Math.log1p(popularity) * options.popularityBoost;
      }

      if (score <= options.minScore) {
        continue;
      }

      hits.push({
        toolId: entry.tool.toolId,
        score
      });
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.toolId.localeCompare(b.toolId);
    });

    return hits;
  }
}

export class Bm25SearchEngine implements SearchEngine {
  private index = new Bm25Index();
  private catalogVersion = -1;
  private options: Required<Bm25SearchOptions>;

  constructor(private catalog: CatalogProvider, private tokenizer: Tokenizer, options: Bm25SearchOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  query(input: SearchQueryInput): SearchQueryResult {
    const snapshot = this.catalog.getSnapshot();
    if (snapshot.version !== this.catalogVersion) {
      this.index.build(snapshot, this.tokenizer);
      this.catalogVersion = snapshot.version;
    }

    const queryTokens = this.tokenizer.tokenize(input.query);
    const queryTokenCounts = new Map<string, number>();
    for (const token of queryTokens) {
      queryTokenCounts.set(token, (queryTokenCounts.get(token) ?? 0) + 1);
    }

    const uniqueTokens = Array.from(new Set(queryTokens));
    const weights = mergeWeights(input.weights);
    const topK = Math.max(0, input.topK ?? this.options.defaultTopK);

    const hits = this.index.score(
      uniqueTokens,
      queryTokenCounts,
      input.query,
      weights,
      this.options,
      this.tokenizer,
      input.filters
    );

    const limitedHits = topK > 0 ? hits.slice(0, topK) : [];

    const filteredCount = hits.length;
    return {
      hits: limitedHits,
      candidates: {
        before: snapshot.docs.size,
        after: filteredCount
      }
    };
  }
}
