import type {
  ReducedToolResult,
  SearchQueryInput,
  SearchQueryResult,
  ToolCard,
  WorkingSetState,
  WorkingSetUpdateInput,
  WorkingSetUpdateResult
} from "@mcpflow/shared";

export interface CatalogStats {
  tools: number;
  indexSize: number;
  updatedAt: string;
}

export interface CatalogStore {
  upsertTools(tools: ToolCard[]): { count: number };
  removeTools(toolIds: string[]): { count: number };
  reset(): void;
  stats(): CatalogStats;
}

export interface SearchEngine {
  query(input: SearchQueryInput): SearchQueryResult;
}

export interface WorkingSetManager {
  get(sessionId: string): WorkingSetState;
  update(input: WorkingSetUpdateInput): WorkingSetUpdateResult;
  markUsed(sessionId: string, toolId: string): void;
  reset(sessionId: string): void;
}

export interface ResultReducer {
  reduce(toolId: string | undefined, rawResult: unknown, policy?: Record<string, unknown>): ReducedToolResult;
}

export interface RouterCore {
  catalog: CatalogStore;
  search: SearchEngine;
  workingSet: WorkingSetManager;
  result: ResultReducer;
}
