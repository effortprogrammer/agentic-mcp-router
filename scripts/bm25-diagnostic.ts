/**
 * BM25 Search Quality Diagnostic
 * 
 * Simulates the full pipeline: ToolCard → buildSearchDoc → BM25 index → query
 * Tests against realistic tool data to identify bottlenecks.
 * 
 * Usage: npx tsx scripts/bm25-diagnostic.ts
 */

import { InMemoryCatalog, buildSearchDoc } from "../packages/core/src/catalog.js";
import { Bm25SearchEngine } from "../packages/core/src/bm25.js";
import { SimpleTokenizer } from "../packages/core/src/tokenizer.js";
import type { ToolCard } from "../packages/shared/src/types.js";

// ─── Realistic Tool Data (matches what MCP servers actually provide) ───

const TOOLS: ToolCard[] = [
  // --- Slack tools ---
  {
    toolId: "slack:slack_list_conversations",
    toolName: "slack_list_conversations",
    serverId: "slack",
    description: "List public channels in the workspace with pagination",
    tags: ["slack", "list", "conversations", "channels", "public"],
    synonyms: ["slack list conversations"],
    args: [
      { name: "cursor", description: "Pagination cursor for next page of results" },
      { name: "limit", description: "Maximum number of channels to return (default 100, max 200)" },
      { name: "types", description: "Comma-separated list of channel types to include" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_post_message",
    toolName: "slack_post_message",
    serverId: "slack",
    description: "Post a new message to a Slack channel",
    tags: ["slack", "post", "message", "send", "channel"],
    synonyms: ["slack post message"],
    args: [
      { name: "channel_id", description: "The ID of the channel to post to" },
      { name: "text", description: "The message text to post" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_reply_to_thread",
    toolName: "slack_reply_to_thread",
    serverId: "slack",
    description: "Reply to a specific message thread in Slack",
    tags: ["slack", "reply", "thread", "message"],
    synonyms: ["slack reply thread"],
    args: [
      { name: "channel_id", description: "The channel containing the thread" },
      { name: "thread_ts", description: "The timestamp of the parent message" },
      { name: "text", description: "The reply text" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_add_reaction",
    toolName: "slack_add_reaction",
    serverId: "slack",
    description: "Add a reaction emoji to a message",
    tags: ["slack", "reaction", "emoji", "message"],
    synonyms: ["slack add reaction"],
    args: [
      { name: "channel_id", description: "The channel containing the message" },
      { name: "timestamp", description: "The timestamp of the message to react to" },
      { name: "reaction", description: "The name of the emoji reaction (without ::)" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_get_channel_history",
    toolName: "slack_get_channel_history",
    serverId: "slack",
    description: "Get recent messages from a channel",
    tags: ["slack", "channel", "history", "messages"],
    synonyms: ["slack channel history"],
    args: [
      { name: "channel_id", description: "The channel to get history from" },
      { name: "limit", description: "Number of messages to return (default 10)" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_get_thread_replies",
    toolName: "slack_get_thread_replies",
    serverId: "slack",
    description: "Get all replies in a message thread",
    tags: ["slack", "thread", "replies", "messages"],
    synonyms: ["slack thread replies"],
    args: [
      { name: "channel_id", description: "The channel containing the thread" },
      { name: "thread_ts", description: "The timestamp of the parent message" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_search_messages",
    toolName: "slack_search_messages",
    serverId: "slack",
    description: "Search for messages in the workspace",
    tags: ["slack", "search", "messages"],
    synonyms: ["slack search messages"],
    args: [
      { name: "query", description: "The search query" },
      { name: "count", description: "Number of results to return (default 5)" },
      { name: "sort", description: "Sort order: score or timestamp" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_get_users",
    toolName: "slack_get_users",
    serverId: "slack",
    description: "List all users in the workspace with pagination",
    tags: ["slack", "users", "list", "members"],
    synonyms: ["slack users"],
    args: [
      { name: "cursor", description: "Pagination cursor" },
      { name: "limit", description: "Maximum users to return" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_get_user_profile",
    toolName: "slack_get_user_profile",
    serverId: "slack",
    description: "Get detailed profile information for a specific user",
    tags: ["slack", "user", "profile"],
    synonyms: ["slack user profile"],
    args: [
      { name: "user_id", description: "The user's ID" },
    ],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_token_status",
    toolName: "slack_token_status",
    serverId: "slack",
    description: "Check the status and permissions of the current Slack bot token",
    tags: ["slack", "token", "status", "permissions", "auth"],
    synonyms: ["slack token status"],
    args: [],
    examples: [],
    authHint: ["SLACK_BOT_TOKEN"],
  },
  {
    toolId: "slack:slack_health_check",
    toolName: "slack_health_check",
    serverId: "slack",
    description: "Check if the Slack MCP server is running and connected",
    tags: ["slack", "health", "check", "status", "ping"],
    synonyms: ["slack health check"],
    args: [],
    examples: [],
    authHint: [],
  },
  // --- Context7 tools ---
  {
    toolId: "context7:resolve-library-id",
    toolName: "resolve-library-id",
    serverId: "context7",
    title: "Resolve Library ID",
    description: "Resolves a package/product name to a Context7-compatible library ID. This tool should be called before 'get-library-docs' to obtain the correct library ID.",
    tags: ["context7", "resolve", "library", "id", "package"],
    synonyms: ["resolve library id"],
    args: [
      { name: "libraryName", description: "Library or package name to search for (e.g. 'react', 'vllm', 'langchain')" },
    ],
    examples: [],
    authHint: [],
  },
  {
    toolId: "context7:get-library-docs",
    toolName: "get-library-docs",
    serverId: "context7",
    title: "Get Library Docs",
    description: "Fetches up-to-date documentation for a library. You must call 'resolve-library-id' first to get the library ID.",
    tags: ["context7", "documentation", "library", "docs", "reference", "api"],
    synonyms: ["get library docs"],
    args: [
      { name: "context7CompatibleLibraryID", description: "Exact Context7-compatible library ID (e.g. '/mongodb/docs')" },
      { name: "topic", description: "Topic to focus documentation on (e.g. 'hooks', 'routing')" },
      { name: "tokens", description: "Maximum number of tokens of documentation to return" },
    ],
    examples: [],
    authHint: [],
  },
  // --- Web Search tools ---
  {
    toolId: "websearch:brave_web_search",
    toolName: "brave_web_search",
    serverId: "websearch",
    title: "Brave Web Search",
    description: "Performs a web search using the Brave Search API, ideal for general queries, news, articles, and online content. Use this for broad information gathering, recent events, or when you need diverse web sources. Supports pagination, content filtering, and freshness controls.",
    tags: ["websearch", "brave", "web", "search", "internet", "browse", "query"],
    synonyms: ["brave web search"],
    args: [
      { name: "query", description: "Search query (max 400 chars, 50 words)" },
      { name: "count", description: "Number of results (1-20, default 10)" },
      { name: "offset", description: "Pagination offset (max 9)" },
    ],
    examples: [],
    authHint: [],
  },
  {
    toolId: "websearch:brave_local_search",
    toolName: "brave_local_search",
    serverId: "websearch",
    title: "Brave Local Search",
    description: "Searches for local businesses and places using Brave's Local Search API. Best for queries including location-specific terms like 'near me', 'in [city]', or specific business types. Returns business details, ratings, and addresses.",
    tags: ["websearch", "brave", "local", "search", "places", "business", "location"],
    synonyms: ["brave local search"],
    args: [
      { name: "query", description: "Local search query (e.g. 'pizza restaurants near me')" },
      { name: "count", description: "Number of results (1-20, default 5)" },
    ],
    examples: [],
    authHint: [],
  },
  // --- grep.app ---
  {
    toolId: "grep_app:grep_app_search",
    toolName: "grep_app_search",
    serverId: "grep_app",
    title: "Grep App Search",
    description: "Search across public GitHub repositories using grep.app. Find code examples, implementations, and usage patterns across open source projects.",
    tags: ["grep", "search", "code", "github", "repository", "open source"],
    synonyms: ["grep app search"],
    args: [
      { name: "query", description: "The search query to find in code" },
      { name: "page", description: "Page number for pagination (default 1)" },
      { name: "regexp", description: "Whether to use regex in search" },
    ],
    examples: [],
    authHint: [],
  },
  // --- Exa ---
  {
    toolId: "exa:exa_search",
    toolName: "exa_search",
    serverId: "exa",
    title: "Exa Search",
    description: "Search the web using Exa AI. Provides high-quality, curated search results with full page content. Great for research, finding authoritative sources, and getting detailed information.",
    tags: ["exa", "search", "web", "ai", "research", "content"],
    synonyms: ["exa search"],
    args: [
      { name: "query", description: "The search query" },
      { name: "numResults", description: "Number of results to return" },
      { name: "type", description: "Search type: neural or keyword" },
    ],
    examples: [],
    authHint: [],
  },
];

// ─── Test Cases ───

interface TestCase {
  category: string;
  query: string;
  expectedToolId: string;
  description: string;
}

const TEST_CASES: TestCase[] = [
  // Category 1: Direct keyword matching
  { category: "C1-keyword", query: "slack channels", expectedToolId: "slack:slack_list_conversations", description: "Direct keyword for listing channels" },
  { category: "C1-keyword", query: "post message slack", expectedToolId: "slack:slack_post_message", description: "Direct keyword for posting" },
  { category: "C1-keyword", query: "search messages", expectedToolId: "slack:slack_search_messages", description: "Direct keyword for search" },
  { category: "C1-keyword", query: "web search", expectedToolId: "websearch:brave_web_search", description: "Direct keyword for web search" },
  { category: "C1-keyword", query: "library docs", expectedToolId: "context7:get-library-docs", description: "Direct keyword for docs" },
  { category: "C1-keyword", query: "grep code search", expectedToolId: "grep_app:grep_app_search", description: "Direct keyword for grep" },
  { category: "C1-keyword", query: "exa search", expectedToolId: "exa:exa_search", description: "Direct keyword for exa" },
  { category: "C1-keyword", query: "slack users", expectedToolId: "slack:slack_get_users", description: "Direct keyword for users" },
  { category: "C1-keyword", query: "channel history", expectedToolId: "slack:slack_get_channel_history", description: "Direct keyword for history" },

  // Category 2: Intent-based queries (need semantic understanding)
  { category: "C2-intent", query: "list slack channels", expectedToolId: "slack:slack_list_conversations", description: "Intent: list channels" },
  { category: "C2-intent", query: "send a message to slack", expectedToolId: "slack:slack_post_message", description: "Intent: send message" },
  { category: "C2-intent", query: "browse the internet", expectedToolId: "websearch:brave_web_search", description: "Intent: browse web" },
  { category: "C2-intent", query: "find API reference", expectedToolId: "context7:get-library-docs", description: "Intent: find docs" },
  { category: "C2-intent", query: "look up documentation for react", expectedToolId: "context7:resolve-library-id", description: "Intent: lookup library" },
  { category: "C2-intent", query: "search for code examples on github", expectedToolId: "grep_app:grep_app_search", description: "Intent: code search on github" },
  { category: "C2-intent", query: "who are the team members", expectedToolId: "slack:slack_get_users", description: "Intent: list team members" },
  { category: "C2-intent", query: "what did people say in general", expectedToolId: "slack:slack_get_channel_history", description: "Intent: read channel" },
  { category: "C2-intent", query: "add emoji to that message", expectedToolId: "slack:slack_add_reaction", description: "Intent: add reaction" },
  { category: "C2-intent", query: "respond in the thread", expectedToolId: "slack:slack_reply_to_thread", description: "Intent: reply to thread" },

  // Category 3: Natural language + edge cases
  { category: "C3-natural", query: "I want to search the web for latest AI news", expectedToolId: "websearch:brave_web_search", description: "Natural: web search" },
  { category: "C3-natural", query: "docs for vllm", expectedToolId: "context7:resolve-library-id", description: "Natural: docs (stemming test)" },
  { category: "C3-natural", query: "documentation for langchain", expectedToolId: "context7:resolve-library-id", description: "Natural: documentation (stemming test)" },
  { category: "C3-natural", query: "슬랙 채널 목록", expectedToolId: "slack:slack_list_conversations", description: "Korean: slack channel list" },
  { category: "C3-natural", query: "웹 검색", expectedToolId: "websearch:brave_web_search", description: "Korean: web search" },
  { category: "C3-natural", query: "문서 찾기", expectedToolId: "context7:get-library-docs", description: "Korean: find docs" },
];

// ─── Run Diagnostic ───

function runDiagnostic() {
  const catalog = new InMemoryCatalog();
  const tokenizer = new SimpleTokenizer(); // Uses Phase 1 defaults
  const engine = new Bm25SearchEngine(catalog, tokenizer);

  // Index all tools
  catalog.upsertTools(TOOLS);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" BM25 Search Quality Diagnostic — Phase 1 Post");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`Tools indexed: ${TOOLS.length}`);
  console.log(`Tokenizer: SimpleTokenizer (stopwords=${80}+, minLen=2)`);
  console.log();

  // Show tokenization of each tool's search doc
  console.log("─── Tool Search Docs (tokenized) ───");
  const snapshot = catalog.getSnapshot();
  for (const [toolId, doc] of snapshot.docs) {
    const nameTokens = tokenizer.tokenize(doc.name);
    const descTokens = tokenizer.tokenize(doc.description);
    const tagTokens = tokenizer.tokenize(doc.tags);
    const synTokens = tokenizer.tokenize(doc.synonyms);
    console.log(`\n  ${toolId}`);
    console.log(`    name:     [${nameTokens.join(", ")}]`);
    console.log(`    desc:     [${descTokens.join(", ")}]`);
    console.log(`    tags:     [${tagTokens.join(", ")}]`);
    console.log(`    synonyms: [${synTokens.join(", ")}]`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(" Query Results");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const results: { category: string; pass: boolean; query: string; desc: string; detail: string }[] = [];

  for (const tc of TEST_CASES) {
    const queryTokens = tokenizer.tokenize(tc.query);
    const searchResult = engine.query({ query: tc.query, topK: 5 });
    const top = searchResult.hits.slice(0, 5);
    const rank = top.findIndex(h => h.toolId === tc.expectedToolId);
    const pass = rank === 0;
    const passInTop3 = rank >= 0 && rank < 3;

    const symbol = pass ? "✅" : passInTop3 ? "⚠️" : "❌";
    const rankStr = rank >= 0 ? `#${rank + 1}` : "NOT IN TOP 5";

    console.log(`${symbol} [${tc.category}] "${tc.query}"`);
    console.log(`   Tokens: [${queryTokens.join(", ")}]`);
    console.log(`   Expected: ${tc.expectedToolId} → ${rankStr}`);
    if (top.length > 0) {
      console.log(`   Top 3:`);
      for (let i = 0; i < Math.min(3, top.length); i++) {
        const h = top[i];
        console.log(`     ${i + 1}. ${h.toolId} (score: ${h.score.toFixed(3)})`);
      }
    } else {
      console.log(`   Top 3: (no results — all tokens stripped by stopwords?)`);
    }
    console.log();

    results.push({
      category: tc.category,
      pass,
      query: tc.query,
      desc: tc.description,
      detail: `expected ${tc.expectedToolId} @ ${rankStr}, got ${top[0]?.toolId ?? "nothing"}`
    });
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" Summary");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const categories = ["C1-keyword", "C2-intent", "C3-natural"];
  let totalPass = 0;
  let totalCount = 0;

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catPass = catResults.filter(r => r.pass).length;
    const pct = Math.round((catPass / catResults.length) * 100);
    console.log(`  ${cat}: ${catPass}/${catResults.length} (${pct}%)`);
    
    const failures = catResults.filter(r => !r.pass);
    if (failures.length > 0) {
      console.log(`    Failures:`);
      for (const f of failures) {
        console.log(`      ❌ "${f.query}" — ${f.detail}`);
      }
    }
    totalPass += catPass;
    totalCount += catResults.length;
  }

  const totalPct = Math.round((totalPass / totalCount) * 100);
  console.log(`\n  TOTAL: ${totalPass}/${totalCount} (${totalPct}%)`);

  // Bottleneck analysis
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(" Bottleneck Analysis");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Check stopword stripping
  const strippedQueries = TEST_CASES.filter(tc => {
    const tokens = tokenizer.tokenize(tc.query);
    return tokens.length === 0;
  });
  if (strippedQueries.length > 0) {
    console.log("  🔴 STOPWORD OVER-STRIPPING: These queries produce ZERO tokens:");
    for (const q of strippedQueries) {
      console.log(`     "${q.query}" → tokens: []`);
    }
    console.log();
  }

  // Check Korean queries
  const koreanQueries = TEST_CASES.filter(tc => /[\u3131-\uD79D]/.test(tc.query));
  const koreanTokenized = koreanQueries.map(tc => ({
    query: tc.query,
    tokens: tokenizer.tokenize(tc.query)
  }));
  if (koreanTokenized.some(k => k.tokens.length === 0)) {
    console.log("  🔴 KOREAN QUERIES: normalizeText strips all non-ASCII → ZERO tokens:");
    for (const k of koreanTokenized) {
      console.log(`     "${k.query}" → tokens: [${k.tokens.join(", ")}]`);
    }
    console.log();
  }

  // Check stemming mismatches
  console.log("  🔵 STEMMING ANALYSIS:");
  const stemmingPairs = [
    ["docs", "documentation"],
    ["searching", "search"],
    ["browsing", "browse"],
    ["channels", "channel"],
    ["messages", "message"],
    ["replies", "reply"],
    ["businesses", "business"],
  ];
  for (const [a, b] of stemmingPairs) {
    const tokA = tokenizer.tokenize(a);
    const tokB = tokenizer.tokenize(b);
    const match = tokA.length > 0 && tokB.length > 0 && tokA[0] === tokB[0];
    const symbol = match ? "✅" : "❌";
    console.log(`     ${symbol} "${a}" [${tokA}] vs "${b}" [${tokB}] → ${match ? "MATCH" : "NO MATCH"}`);
  }
  console.log();

  // Check high-frequency tool analysis
  console.log("  🔵 TOOL FREQUENCY ANALYSIS (how many queries each tool wins):");
  const winCounts = new Map<string, number>();
  for (const tc of TEST_CASES) {
    const searchResult = engine.query({ query: tc.query, topK: 1 });
    if (searchResult.hits.length > 0) {
      const winner = searchResult.hits[0].toolId;
      winCounts.set(winner, (winCounts.get(winner) ?? 0) + 1);
    }
  }
  const sortedWins = Array.from(winCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [toolId, count] of sortedWins) {
    const pct = Math.round((count / TEST_CASES.length) * 100);
    const flag = count > 5 ? " ⚠️ OVER-REPRESENTED" : "";
    console.log(`     ${toolId}: ${count}/${TEST_CASES.length} (${pct}%)${flag}`);
  }
}

runDiagnostic();
