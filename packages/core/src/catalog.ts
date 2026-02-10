import type { CatalogStats, CatalogStore } from "./core";
import type { ToolCard, ToolSearchDoc } from "@mcp-tool-router/shared";

export interface CatalogSnapshot {
  version: number;
  updatedAt: string;
  tools: ReadonlyMap<string, ToolCard>;
  docs: ReadonlyMap<string, ToolSearchDoc>;
}

export function buildSearchDoc(tool: ToolCard): ToolSearchDoc {
  const argNames = tool.args.map((arg) => arg.name).join(" ");
  const argDescs = tool.args.map((arg) => arg.description ?? "").join(" ");
  const examples = tool.examples.map((example) => `${example.query} ${example.callHint ?? ""}`).join(" ");

  return {
    id: tool.toolId,
    name: tool.toolName,
    title: tool.title ?? "",
    description: tool.description ?? "",
    tags: tool.tags.join(" "),
    synonyms: tool.synonyms.join(" "),
    argNames,
    argDescs,
    examples,
    serverId: tool.serverId
  };
}

export class InMemoryCatalog implements CatalogStore {
  private tools = new Map<string, ToolCard>();
  private docs = new Map<string, ToolSearchDoc>();
  private version = 0;
  private updatedAt = new Date().toISOString();

  upsertTools(tools: ToolCard[]): { count: number } {
    for (const tool of tools) {
      this.tools.set(tool.toolId, tool);
      this.docs.set(tool.toolId, buildSearchDoc(tool));
    }
    if (tools.length > 0) {
      this.version += 1;
      this.updatedAt = new Date().toISOString();
    }
    return { count: tools.length };
  }

  removeTools(toolIds: string[]): { count: number } {
    let removed = 0;
    for (const toolId of toolIds) {
      if (this.tools.delete(toolId)) {
        this.docs.delete(toolId);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.version += 1;
      this.updatedAt = new Date().toISOString();
    }
    return { count: removed };
  }

  reset(): void {
    if (this.tools.size === 0) {
      return;
    }
    this.tools.clear();
    this.docs.clear();
    this.version += 1;
    this.updatedAt = new Date().toISOString();
  }

  stats(): CatalogStats {
    return {
      tools: this.tools.size,
      indexSize: this.docs.size,
      updatedAt: this.updatedAt
    };
  }

  getSnapshot(): CatalogSnapshot {
    return {
      version: this.version,
      updatedAt: this.updatedAt,
      tools: this.tools,
      docs: this.docs
    };
  }

  getTool(toolId: string): ToolCard | undefined {
    return this.tools.get(toolId);
  }

  getTools(): ToolCard[] {
    return Array.from(this.tools.values());
  }

  getDocs(): ToolSearchDoc[] {
    return Array.from(this.docs.values());
  }
}
