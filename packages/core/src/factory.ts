import type { RouterCore } from "./core";
import { InMemoryCatalog } from "./catalog";
import { Bm25SearchEngine } from "./bm25";
import type { Bm25SearchOptions } from "./bm25";
import { SimpleTokenizer } from "./tokenizer";
import type { TokenizerOptions } from "./tokenizer";
import { InMemoryWorkingSetManager } from "./working-set";
import type { WorkingSetOptions } from "./working-set";
import { DefaultResultReducer } from "./result-reducer";
import type { ResultReducerOptions } from "./result-reducer";

export interface RouterCoreOptions {
  tokenizer?: TokenizerOptions;
  bm25?: Bm25SearchOptions;
  workingSet?: WorkingSetOptions;
  resultReducer?: ResultReducerOptions;
}

export function createRouterCore(options: RouterCoreOptions = {}): RouterCore {
  const catalog = new InMemoryCatalog();
  const tokenizer = new SimpleTokenizer(options.tokenizer);
  const search = new Bm25SearchEngine(catalog, tokenizer, options.bm25);
  const workingSet = new InMemoryWorkingSetManager(catalog, search, options.workingSet);
  const result = new DefaultResultReducer(options.resultReducer);

  return {
    catalog,
    search,
    workingSet,
    result
  };
}
