import type { SearchEngine } from "./core.js";
import type { CatalogSnapshot } from "./catalog.js";
import type { CatalogProvider } from "./bm25.js";
import type {
  SearchFilters,
  SearchQueryInput,
  SearchQueryResult,
  ToolCard,
  ToolSearchHit,
} from "../shared/index.js";

function escapeRegex(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesFilters(tool: ToolCard, filters?: SearchFilters): boolean {
  if (!filters) {
    return true;
  }

  if (filters.serverIds && filters.serverIds.length > 0) {
    const allowed = new Set(filters.serverIds.map((id) => id.toLowerCase()));
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
    const wanted = new Set(filters.tags.map((tag) => tag.toLowerCase()));
    const toolTags = tool.tags.map((tag) => tag.toLowerCase());
    if (!toolTags.some((tag) => wanted.has(tag))) {
      return false;
    }
  }

  return true;
}

export class RegexSearchEngine implements SearchEngine {
  private catalogVersion = -1;
  private snapshot: CatalogSnapshot | null = null;

  constructor(private catalog: CatalogProvider) {}

  query(input: SearchQueryInput): SearchQueryResult {
    const snapshot = this.catalog.getSnapshot();
    if (snapshot.version !== this.catalogVersion) {
      this.snapshot = snapshot;
      this.catalogVersion = snapshot.version;
    }

    if (!this.snapshot || this.snapshot.docs.size === 0) {
      return { hits: [], candidates: { before: 0, after: 0 } };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(input.query, "i");
    } catch {
      regex = new RegExp(escapeRegex(input.query), "i");
    }

    const topK = Math.max(0, input.topK ?? 20);
    const hits: ToolSearchHit[] = [];

    for (const [toolId, doc] of this.snapshot.docs.entries()) {
      const tool = this.snapshot.tools.get(toolId);
      if (!tool) {
        continue;
      }

      if (!matchesFilters(tool, input.filters)) {
        continue;
      }

      const nameMatch = regex.test(doc.name);
      const titleMatch = regex.test(doc.title);
      const descMatch = regex.test(doc.description);

      if (!nameMatch && !titleMatch && !descMatch) {
        continue;
      }

      let score = 0;
      if (nameMatch) {
        score += 2.0;
      }
      if (titleMatch) {
        score += 1.5;
      }
      if (descMatch) {
        score += 1.0;
      }

      hits.push({ toolId, score });
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.toolId.localeCompare(b.toolId);
    });

    const limitedHits = topK > 0 ? hits.slice(0, topK) : [];
    return {
      hits: limitedHits,
      candidates: {
        before: this.snapshot.docs.size,
        after: hits.length,
      },
    };
  }
}
