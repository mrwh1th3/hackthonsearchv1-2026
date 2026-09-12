# n8n MCP reference snapshot — 2026-09-11

This folder holds **verbatim, read-only snapshots** taken from the n8n MCP server
(`mcp__claude_ai_n8n__*` tools) on **2026-09-11**, for **forense-runtime**, the worker
who owns `docs/17-runtime-n8n.md` and `/n8n` but has no MCP access in its own worktree.
Nothing here was written, published, executed, or deleted on any n8n workflow — every
call used was read-only (`get_sdk_reference`, `search_nodes`, `get_node_types`,
`get_workflow_best_practices`, and one read of an existing client workflow's node
`type`/`typeVersion` fields via `get_workflow_details`). No other file in this repo was
touched to produce this snapshot.

## Files

- **`sdk-reference.md`** — `get_sdk_reference()` full reference, plus the `guidelines`
  and `design` sections called separately (they duplicate part of the full reference —
  kept as three labeled blocks so it's clear which call produced which text).
- **`nodes-search.md`** — `search_nodes()` results for the 12 requested queries
  (webhook, respond to webhook, http request, postgres, code, execute workflow,
  execute workflow trigger, schedule trigger, if, set, error trigger, wait), plus a
  summary table of the node id/discriminators actually used as input to `get_node_types`.
- **`node-types.md`** — `get_node_types()` TypeScript definitions, one `## nodeId (vN)`
  section per requested node/discriminator (17 sections: webhook, respondToWebhook,
  httpRequest, postgres ×3 operations, code ×2 modes, executeWorkflow ×2 modes,
  executeWorkflowTrigger, scheduleTrigger, if, set ×2 modes, errorTrigger, wait).
- **`best-practices.md`** — `get_workflow_best_practices(technique: "list")`, plus the
  four technique docs closest to the coordinator's requested topics. **Two requested
  topics have no matching technique in this tool at all** — "error handling" and
  "sub-workflows" — see the mapping table at the top of that file; that guidance
  currently only lives in `sdk-reference.md` (`.onError()`, `continueErrorOutput`) and
  `node-types.md` (`executeWorkflow`/`executeWorkflowTrigger`), not in a dedicated
  best-practices document.
- **`instance-typeversions.md`** — from one read of workflow id `Q5EdrubjdEI4OdBs` (an
  existing, unrelated client workflow — read-only, not modified): a deduplicated
  `type`/`typeVersion` count table only. **No node names, parameters, `webhookId`
  values, prompts, credentials, or business content were copied out** — node names in
  particular routinely carry business content and were deliberately excluded. The
  instance host was noted only because it appeared in a non-secret field
  (`triggerInfo`'s webhook Production/Test URL); the URL path was stripped since it
  could reveal workflow-specific content, so only the bare host is recorded.

## What this snapshot does NOT establish

**The real n8n instance version used by this hackathon project is still unconfirmed.**
`launch.config.json` has `targets.n8n_url: null` and `targets.n8n_version: null`, and
`reported_connections.verified` is `false` — this preflight pass does not change
either. The `typeVersion`s observed on workflow `Q5EdrubjdEI4OdBs` are a **lower
bound** on what that instance can run, not its ceiling: n8n does not force-upgrade a
saved node's `typeVersion`, so an instance can run newer node type definitions than
any single existing workflow happens to be pinned to. Workflow `Q5EdrubjdEI4OdBs` is
also an unrelated client workflow the task named explicitly to read for this purpose —
it is **not** a project workflow and must never be treated as a template, and no
similar workflow was searched for as a substitute (searching for one "close enough"
would have been choosing a client project by approximation, which this task and
`ARRANQUE.md` both rule out).

Before generating or importing any real workflow JSON, the coordinator must still
confirm, by direct, deliberate means: the actual `n8n_url` and `n8n_version` for the
project's own instance (account hint `victorinbm2006`, per `launch.config.json` and
`CLAUDE.md` — not assumed from this snapshot), and that `hackathon_started` is `true`
before writing any pipeline logic (`launch.config.json` still reads `false` as of this
snapshot).
