---
name: parallel-search-patterns
description: Web-search and web-fetch playbook for the @open-neko/plugin-parallel-search plugin. Use when the agent needs to look up external context (competitor news, market signals, company facts) for a finding or Ask thread. Covers when to use web_search vs web_fetch, query shaping, depth limits, and how to thread Parallel results into a Briefing-style summary.
license: Apache-2.0
metadata:
  authoredBy: open-neko
  pairsWith: "@open-neko/plugin-parallel-search"
---

# Parallel-search patterns

The `@open-neko/plugin-parallel-search` plugin exposes two sandboxed
actions backed by Parallel.ai's Search MCP:

| Action | Use when |
|---|---|
| `web_search` | The operator wants a synthesized answer ("what's the latest funding round for $COMPETITOR?"). |
| `web_fetch` | The operator already has a URL ("read me this filing"). |

Both have `default_mode: auto` — they're read-only against the open
web and don't need a human gate.

## Query shaping for `web_search`

Parallel's search ranks higher on **specific** queries than generic
ones. Default to:

1. **Include time markers** when the operator cares about recency:
   `"Q4 2025 earnings"`, `"announced this week"`. Without one,
   Parallel may surface a year-old article that looks current.
2. **Name entities precisely.** `"Anthropic Claude Opus 4.6 release"`
   beats `"new Claude version"`. If the operator was vague, ask one
   clarifying question before searching.
3. **Cap depth at 2 hops.** Don't chain `web_search` → `web_fetch` →
   `web_search` more than two levels deep — that's an indication the
   first search was wrong, not that the topic is rich. Re-ask the
   operator instead.

## When `web_fetch` is the right call

- The operator pasted a URL in the message.
- A previous `web_search` returned a single dominant result and the
  next question is "what does that article actually say?".
- You need a specific document (filing, blog post, transcript) that
  the operator referenced by title — pair `web_search` to find the
  URL, then `web_fetch` to pull the body.

## Don't double-fetch

Each `web_fetch` is a billable Parallel call. If you already fetched
a URL in this turn, reuse the result — re-fetching wastes spend AND
makes the response slower.

## Threading results into operator-facing output

Parallel returns markdown with citations. The agent should:

- Quote sparingly — operators want the synthesized answer, not the
  raw page.
- Attribute every claim ("per the SEC 8-K filed 2026-03-04, …").
  Operators in finance/compliance roles need this; everyone else
  tolerates it.
- Strip Parallel's verbose preambles ("The search returned…"). Get to
  the answer.

## Failure modes the operator should see

- **`PARALLEL_API_KEY` not set** — operator runs `openneko secrets set
  @open-neko/plugin-parallel-search PARALLEL_API_KEY <key>`.
- **`rate_limited`** — surface the wait if >5s; otherwise just retry.
- **No results / low confidence** — say so plainly ("I couldn't find a
  reliable source for this"). Don't fabricate.

## What this skill is NOT for

- Internal knowledge — that's the GraphJin data source.
- Long-running research projects — Parallel's `deep-research` flow is
  not in this plugin yet; for now, multi-step research means multiple
  shallow `web_search` calls.
