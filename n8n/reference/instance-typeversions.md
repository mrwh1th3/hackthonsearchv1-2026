<!-- MCP snapshot taken 2026-09-11 -- tool: mcp__claude_ai_n8n__get_workflow_details (n8n MCP server), workflow id Q5EdrubjdEI4OdBs. Read-only: only node type/typeVersion counts are recorded below. No node names, parameters, webhookId values, prompts, credentials or business content were copied out of that workflow, per task instructions. -->

# Instance typeVersion hints -- MCP snapshot 2026-09-11

Source workflow id: `Q5EdrubjdEI4OdBs` (existing client workflow, read via `get_workflow_details`, read-only -- not modified). This ID was given explicitly by the task; no similar workflow was searched for or substituted.

Total nodes in workflow: **49**

## Node type / typeVersion table (deduplicated, counts only -- no node names)

| node type | typeVersion | count |
|---|---|---|
| n8n-nodes-base.code | 2 | 21 |
| n8n-nodes-base.postgres | 2.7 | 15 |
| n8n-nodes-base.httpRequest | 4.2 | 7 |
| n8n-nodes-base.respondToWebhook | 1.5 | 2 |
| n8n-nodes-base.webhook | 2.1 | 1 |
| n8n-nodes-base.switch | 3.4 | 1 |
| n8n-nodes-base.stickyNote | 1 | 1 |
| n8n-nodes-base.if | 2.3 | 1 |

## Workflow-revision identifiers (not the n8n software version)

- `versionId`: present (a per-workflow revision UUID, not the n8n instance/software version).
- `activeVersionId`: present (equal to `versionId` at read time -> the active version is the latest saved revision).
- `meta`: present, contains only `aiBuilderAssisted` and `builderVariant` fields (both booleans/strings describing how the workflow was authored). **No `meta.instanceId` or any other instance-identifying field was present** in this workflow's metadata -- there was nothing to redact.

## Instance host
Exposed in a non-secret field: the webhook trigger's Production/Test URL host, returned by `get_workflow_details` as part of `triggerInfo` (not a credential). Host only (path/query stripped, since a full path could reveal workflow-specific business content):

```
n8n.srv1550651.hstgr.cloud
```

## Caveat -- this table is NOT the instance version

A workflow's nodes can be pinned to an OLDER `typeVersion` than the node types the instance actually supports (n8n does not force-upgrade existing nodes on save). So every `typeVersion` above is a **lower bound** on what this instance can run, not proof of its ceiling or of its n8n release number. It also says nothing about which node types this instance has installed beyond the ones actually used in this one workflow. The coordinator must still confirm the real n8n instance/version directly (e.g. instance settings/About page, or the `/rest/login`-adjacent version endpoint) before exporting or importing JSON built against a specific typeVersion.

launch.config.json has `targets.n8n_url: null` and `targets.n8n_version: null` -- both remain unconfirmed by this preflight pass; this file only narrows the search, it does not close either pending item.
