import type { RouterCore } from "./core.js";
import { InMemoryCatalog } from "./catalog.js";
import { Bm25SearchEngine } from "./bm25.js";
import type { Bm25SearchOptions } from "./bm25.js";
import { SimpleTokenizer } from "./tokenizer.js";
import type { TokenizerOptions } from "./tokenizer.js";
import { InMemoryWorkingSetManager } from "./working-set.js";
import type { WorkingSetOptions } from "./working-set.js";
import { DefaultResultReducer } from "./result-reducer.js";
import type { ResultReducerOptions } from "./result-reducer.js";

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
