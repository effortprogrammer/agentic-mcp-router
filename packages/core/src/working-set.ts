import type { WorkingSetManager } from "./core.js";
import type { SearchEngine } from "./core.js";
import type { WorkingSetState, WorkingSetUpdateInput, WorkingSetUpdateResult } from "@mcp-tool-router/shared";
import type { ToolCard } from "@mcp-tool-router/shared";
import type { InMemoryCatalog } from "./catalog.js";
import { estimateTokensFromText } from "./utils.js";

export interface WorkingSetOptions {
  defaultTtlMs?: number;
  defaultTokenCost?: number;
  defaultBudgetTokens?: number;
  defaultTopK?: number;
  maxEntries?: number;
  now?: () => number;
}

const DEFAULT_WORKING_SET_OPTIONS: Required<Omit<WorkingSetOptions, "now">> = {
  defaultTtlMs: 0,
  defaultTokenCost: 120,
  defaultBudgetTokens: 0,
  defaultTopK: 20,
  maxEntries: 0
};

function estimateToolTokens(tool: ToolCard): number {
  const parts = [
    tool.toolId,
    tool.toolName,
    tool.title ?? "",
    tool.description ?? "",
    tool.tags.join(" "),
    tool.synonyms.join(" "),
    tool.args.map((arg) => `${arg.name} ${arg.description ?? ""} ${arg.typeHint ?? ""} ${arg.example ?? ""}`).join(" "),
    tool.examples.map((example) => `${example.query} ${example.callHint ?? ""}`).join(" "),
    tool.authHint.join(" "),
    tool.sideEffect ?? "",
    tool.costHint ?? ""
  ];

  const estimate = estimateTokensFromText(parts.join(" "));
  return Math.max(8, estimate + 12);
}

function cloneState(state: WorkingSetState): WorkingSetState {
  return {
    sessionId: state.sessionId,
    budgetTokens: state.budgetTokens,
    usedTokens: state.usedTokens,
    entries: { ...state.entries }
  };
}

export class InMemoryWorkingSetManager implements WorkingSetManager {
  private sessions = new Map<string, WorkingSetState>();
  private options: Required<Omit<WorkingSetOptions, "now">> & { now: () => number };

  constructor(private catalog: InMemoryCatalog, private search: SearchEngine, options: WorkingSetOptions = {}) {
    this.options = {
      ...DEFAULT_WORKING_SET_OPTIONS,
      ...options,
      now: options.now ?? (() => Date.now())
    };
  }

  get(sessionId: string): WorkingSetState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      const fresh: WorkingSetState = {
        sessionId,
        entries: {},
        budgetTokens: this.options.defaultBudgetTokens,
        usedTokens: 0
      };
      this.sessions.set(sessionId, fresh);
      return cloneState(fresh);
    }
    return cloneState(state);
  }

  update(input: WorkingSetUpdateInput): WorkingSetUpdateResult {
    const state = this.ensureSession(input.sessionId, input.budgetTokens);
    const now = this.options.now();
    const added = new Set<string>();
    const removed = new Set<string>();

    state.budgetTokens = input.budgetTokens;

    for (const toolId of input.pin ?? []) {
      const entry = state.entries[toolId];
      if (entry) {
        entry.pinned = true;
        entry.lastSelectedAt = now;
        continue;
      }
      const tokenCost = this.getTokenCost(toolId);
      state.entries[toolId] = {
        toolId,
        pinned: true,
        lastUsedAt: 0,
        lastSelectedAt: now,
        ttlMs: this.options.defaultTtlMs || undefined,
        tokenCost
      };
      added.add(toolId);
    }

    for (const toolId of input.unpin ?? []) {
      const entry = state.entries[toolId];
      if (entry) {
        entry.pinned = false;
      }
    }

    for (const [toolId, entry] of Object.entries(state.entries)) {
      if (entry.pinned) {
        continue;
      }
      if (entry.ttlMs && entry.ttlMs > 0) {
        const lastTouched = Math.max(entry.lastUsedAt, entry.lastSelectedAt);
        if (now - lastTouched > entry.ttlMs) {
          delete state.entries[toolId];
          removed.add(toolId);
        }
      }
    }

    const topK = input.topK ?? this.options.defaultTopK;
    const hits = this.search.query({ sessionId: input.sessionId, query: input.query, topK }).hits;

    for (const hit of hits) {
      const toolId = hit.toolId;
      const existing = state.entries[toolId];
      if (existing) {
        existing.lastSelectedAt = now;
        existing.scoreHint = hit.score;
        continue;
      }
      const tokenCost = this.getTokenCost(toolId);
      state.entries[toolId] = {
        toolId,
        pinned: false,
        lastUsedAt: 0,
        lastSelectedAt: now,
        ttlMs: this.options.defaultTtlMs || undefined,
        tokenCost,
        scoreHint: hit.score
      };
      added.add(toolId);
    }

    if (this.options.maxEntries > 0) {
      this.enforceMaxEntries(state, removed);
    }

    this.enforceBudget(state, removed);

    for (const toolId of removed) {
      added.delete(toolId);
    }

    const selectedToolIds = this.selectEntries(state);
    state.usedTokens = this.computeUsedTokens(state);

    return {
      selectedToolIds,
      addedToolIds: Array.from(added).sort(),
      removedToolIds: Array.from(removed).sort(),
      budgetUsed: state.usedTokens,
      budgetTotal: state.budgetTokens
    };
  }

  markUsed(sessionId: string, toolId: string): void {
    const state = this.ensureSession(sessionId, this.options.defaultBudgetTokens);
    const now = this.options.now();
    const entry = state.entries[toolId];
    if (entry) {
      entry.lastUsedAt = now;
      entry.lastSelectedAt = now;
      return;
    }
    const tokenCost = this.getTokenCost(toolId);
    state.entries[toolId] = {
      toolId,
      pinned: false,
      lastUsedAt: now,
      lastSelectedAt: now,
      ttlMs: this.options.defaultTtlMs || undefined,
      tokenCost
    };
  }

  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private ensureSession(sessionId: string, budgetTokens: number): WorkingSetState {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.budgetTokens = budgetTokens;
      return state;
    }
    const fresh: WorkingSetState = {
      sessionId,
      entries: {},
      budgetTokens,
      usedTokens: 0
    };
    this.sessions.set(sessionId, fresh);
    return fresh;
  }

  private getTokenCost(toolId: string): number {
    const tool = this.catalog.getTool(toolId);
    if (!tool) {
      return this.options.defaultTokenCost;
    }
    return estimateToolTokens(tool);
  }

  private computeUsedTokens(state: WorkingSetState): number {
    return Object.values(state.entries).reduce((sum, entry) => sum + entry.tokenCost, 0);
  }

  private enforceBudget(state: WorkingSetState, removed: Set<string>): void {
    let used = this.computeUsedTokens(state);
    if (used <= state.budgetTokens) {
      state.usedTokens = used;
      return;
    }

    const candidates = Object.values(state.entries).filter((entry) => !entry.pinned);
    candidates.sort((a, b) => {
      if (a.lastSelectedAt !== b.lastSelectedAt) {
        return a.lastSelectedAt - b.lastSelectedAt;
      }
      if (a.lastUsedAt !== b.lastUsedAt) {
        return a.lastUsedAt - b.lastUsedAt;
      }
      const aScore = a.scoreHint ?? 0;
      const bScore = b.scoreHint ?? 0;
      if (aScore !== bScore) {
        return aScore - bScore;
      }
      return a.toolId.localeCompare(b.toolId);
    });

    for (const entry of candidates) {
      if (used <= state.budgetTokens) {
        break;
      }
      delete state.entries[entry.toolId];
      removed.add(entry.toolId);
      used -= entry.tokenCost;
    }

    state.usedTokens = used;
  }

  private enforceMaxEntries(state: WorkingSetState, removed: Set<string>): void {
    const maxEntries = this.options.maxEntries;
    if (maxEntries <= 0) {
      return;
    }

    const entries = Object.values(state.entries);
    if (entries.length <= maxEntries) {
      return;
    }

    const candidates = entries.filter((entry) => !entry.pinned);
    candidates.sort((a, b) => {
      if (a.lastSelectedAt !== b.lastSelectedAt) {
        return a.lastSelectedAt - b.lastSelectedAt;
      }
      if (a.lastUsedAt !== b.lastUsedAt) {
        return a.lastUsedAt - b.lastUsedAt;
      }
      const aScore = a.scoreHint ?? 0;
      const bScore = b.scoreHint ?? 0;
      if (aScore !== bScore) {
        return aScore - bScore;
      }
      return a.toolId.localeCompare(b.toolId);
    });

    while (Object.keys(state.entries).length > maxEntries && candidates.length > 0) {
      const entry = candidates.shift();
      if (!entry) {
        break;
      }
      delete state.entries[entry.toolId];
      removed.add(entry.toolId);
    }
  }

  private selectEntries(state: WorkingSetState): string[] {
    const entries = Object.values(state.entries);
    entries.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      if (a.lastSelectedAt !== b.lastSelectedAt) {
        return b.lastSelectedAt - a.lastSelectedAt;
      }
      if (a.lastUsedAt !== b.lastUsedAt) {
        return b.lastUsedAt - a.lastUsedAt;
      }
      const aScore = a.scoreHint ?? 0;
      const bScore = b.scoreHint ?? 0;
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      return a.toolId.localeCompare(b.toolId);
    });

    return entries.map((entry) => entry.toolId);
  }
}
