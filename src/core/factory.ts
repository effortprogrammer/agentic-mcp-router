import type { RouterCore, SearchEngine } from "./core.js";
import { InMemoryCatalog } from "./catalog.js";
import { Bm25SearchEngine } from "./bm25.js";
import type { Bm25SearchOptions } from "./bm25.js";
import { RegexSearchEngine } from "./regex.js";
import { SimpleTokenizer } from "./tokenizer.js";
import type { TokenizerOptions } from "./tokenizer.js";
import { InMemoryWorkingSetManager } from "./working-set.js";
import type { WorkingSetOptions } from "./working-set.js";
import { DefaultResultReducer } from "./result-reducer.js";
import type { ResultReducerOptions } from "./result-reducer.js";
import type {
  SearchQueryInput,
  SearchQueryResult,
} from "../shared/index.js";

export interface RouterCoreOptions {
  tokenizer?: TokenizerOptions;
  bm25?: Bm25SearchOptions;
  workingSet?: WorkingSetOptions;
  resultReducer?: ResultReducerOptions;
}

class DualSearchEngine implements SearchEngine {
  constructor(
    private bm25: Bm25SearchEngine,
    private regex: RegexSearchEngine,
  ) {}

  query(input: SearchQueryInput): SearchQueryResult {
    if (input.mode === "regex") {
      return this.regex.query(input);
    }
    return this.bm25.query(input);
  }
}

export function createRouterCore(options: RouterCoreOptions = {}): RouterCore {
  const catalog = new InMemoryCatalog();
  const tokenizer = new SimpleTokenizer(options.tokenizer);
  const bm25 = new Bm25SearchEngine(catalog, tokenizer, options.bm25);
  const regex = new RegexSearchEngine(catalog);
  const search = new DualSearchEngine(bm25, regex);
  const workingSet = new InMemoryWorkingSetManager(
    catalog,
    search,
    options.workingSet,
  );
  const result = new DefaultResultReducer(options.resultReducer);

  return {
    catalog,
    search,
    workingSet,
    result,
  };
}
