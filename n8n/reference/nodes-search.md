<!-- MCP snapshot taken 2026-09-11 — tool: mcp__claude_ai_n8n__search_nodes (n8n MCP server). Verbatim tool output for queries: webhook, respond to webhook, http request, postgres, code, execute workflow, execute workflow trigger, schedule trigger, if, set, error trigger, wait. -->

# n8n search_nodes results — MCP snapshot 2026-09-11

## "webhook"
Found 5 nodes:

- n8n-nodes-base.webhook [TRIGGER]
  Display Name: Webhook
  Version: 2.1
  Description: Starts the workflow when a webhook is called
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.respondToWebhook [TRIGGER]
  Display Name: Respond to Webhook
  Version: 1.5
  Description: Returns data for Webhook
  @builderHint Only works with webhook node (n8n-nodes-base.webhook) with responseMode set to "responseNode"
  @relatedNodes
    - n8n-nodes-base.webhook: "Required trigger - set responseMode to "responseNode""
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.activeCampaignTrigger [TRIGGER]
  Display Name: ActiveCampaign Trigger
  Version: 1
  Description: Handle ActiveCampaign events via webhooks
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.acuitySchedulingTrigger [TRIGGER]
  Display Name: Acuity Scheduling Trigger
  Version: 1
  Description: Handle Acuity Scheduling events via webhooks
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.affinityTrigger [TRIGGER]
  Display Name: Affinity Trigger
  Version: 1
  Description: Handle Affinity events via webhooks
  Discriminators: none (use node directly without resource/operation/mode)

---

## "respond to webhook"
Found 5 nodes:

- n8n-nodes-base.webhook [TRIGGER]
  Display Name: Webhook
  Version: 2.1
  Description: Starts the workflow when a webhook is called
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.respondToWebhook [TRIGGER]
  Display Name: Respond to Webhook
  Version: 1.5
  Description: Returns data for Webhook
  @builderHint Only works with webhook node (n8n-nodes-base.webhook) with responseMode set to "responseNode"
  @relatedNodes
    - n8n-nodes-base.webhook: "Required trigger - set responseMode to "responseNode""
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.chat
  Display Name: Chat
  Version: 1.3
  Description: Send a message into the chat
  @relatedNodes
    - @n8n/n8n-nodes-langchain.chatTrigger: "Required trigger for this node to work - must set responseMode to "responseNodes""
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.chatTool
  Display Name: Chat Tool
  Version: 1.3
  Description: Send a message into the chat
  @relatedNodes
    - @n8n/n8n-nodes-langchain.chatTrigger: "Required trigger for this node to work - must set responseMode to "responseNodes""
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.chatHitlTool
  Display Name: Chat
  Version: 1.3
  Description: Request human approval for tools
  @relatedNodes
    - @n8n/n8n-nodes-langchain.chatTrigger: "Required trigger for this node to work - must set responseMode to "responseNodes""
  Discriminators: none (use node directly without resource/operation/mode)

---

## "http request"
Found 5 nodes:

- n8n-nodes-base.httpRequest
  Display Name: HTTP Request
  Version: 4.5
  Description: Makes an HTTP request and returns the response data
  @builderHint Prefer dedicated integration nodes over HTTP Request — n8n has 400+ dedicated nodes (e.g. Gmail, Slack, Google Sheets, Notion, OpenAI, HubSpot, Jira, etc.) with built-in authentication, pre-configured parameters, better error handling, and easier maintenance. Only use HTTP Request when no dedicated node exists for the service, the user explicitly requests it, accessing a custom/internal API, or the dedicated node does not support the specific operation needed.
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.httpRequestTool
  Display Name: HTTP Request Tool
  Version: 4.5
  Description: Makes an HTTP request and returns the response data
  @builderHint Prefer dedicated integration nodes over HTTP Request — n8n has 400+ dedicated nodes (e.g. Gmail, Slack, Google Sheets, Notion, OpenAI, HubSpot, Jira, etc.) with built-in authentication, pre-configured parameters, better error handling, and easier maintenance. Only use HTTP Request when no dedicated node exists for the service, the user explicitly requests it, accessing a custom/internal API, or the dedicated node does not support the specific operation needed.
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.toolHttpRequest
  Display Name: HTTP Request Tool
  Version: 1.1
  Description: Makes an HTTP request and returns the response data
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.toolVectorStore
  Display Name: Vector Store Question Answer Tool
  Version: 1.1
  Description: Answer questions with a vector store
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.webhook [TRIGGER]
  Display Name: Webhook
  Version: 2.1
  Description: Starts the workflow when a webhook is called
  Discriminators: none (use node directly without resource/operation/mode)

---

## "postgres"
Found 5 nodes:

- n8n-nodes-base.postgres
  Display Name: Postgres
  Version: 2.7
  Description: Get, add and update data in Postgres
  Discriminators:
    operation:
      - deleteTable
        Delete an entire table or rows in a table
      - executeQuery
        Execute an SQL query
      - insert
        Insert rows in a table
      - upsert
        Insert or update rows in a table
      - select
        Select rows from a table
      - update
        Update rows in a table

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.postgres", operation: "deleteTable" }] })

- n8n-nodes-base.postgresTool
  Display Name: Postgres Tool
  Version: 2.7
  Description: Get, add and update data in Postgres
  Discriminators:
    operation:
      - deleteTable
        Delete an entire table or rows in a table
      - executeQuery
        Execute an SQL query
      - insert
        Insert rows in a table
      - upsert
        Insert or update rows in a table
      - select
        Select rows from a table
      - update
        Update rows in a table

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.postgresTool", operation: "deleteTable" }] })

- n8n-nodes-base.postgresTrigger [TRIGGER]
  Display Name: Postgres Trigger
  Version: 1
  Description: Listens to Postgres messages
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.memoryPostgresChat
  Display Name: Postgres Chat Memory
  Version: 1.4
  Description: Stores the chat history in Postgres table.
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.vectorStorePGVector
  Display Name: Postgres PGVector Store
  Version: 1.3
  Description: Work with your data in Postgresql with the PGVector extension
  @builderHint Pick mode by where data flows: `insert` upserts documents into the store on the main flow; `load` runs a one-shot similarity search on the main flow; `retrieve-as-tool` is the canonical RAG mode — plug into an AI Agent's `subnodes.tools`; `retrieve` exposes the store as a subnode for another node's `subnodes.vectorStore`; `update` updates a single document by ID.
  Discriminators:
    mode:
      - load: "Get Many" → use node()
        Get many ranked documents from vector store for query
      - insert: "Insert Documents" → use node()
        Insert documents into vector store
      - retrieve: "Retrieve Documents (As Vector Store for Chain)" → use vectorStore({ mode: 'retrieve' }) for subnodes.vectorStore
        Retrieve documents from vector store to be used as vector store with AI nodes
      - retrieve-as-tool: "Retrieve Documents (As Tool for AI Agent)" → use tool({ mode: 'retrieve-as-tool' }) for subnodes.tools
        Retrieve documents from vector store to be used as tool with AI nodes

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "@n8n/n8n-nodes-langchain.vectorStorePGVector", mode: "load" }] })

---

## "code"
Found 5 nodes:

- n8n-nodes-base.code
  Display Name: Code
  Version: 2
  Description: Run custom JavaScript or Python code
  @builderHint Use Code node as a LAST RESORT — it runs in a sandboxed environment and is slower than native nodes. Code node is ONLY appropriate for complex multi-step algorithms that cannot be expressed in single expressions, or operations requiring complex data structures. The sandbox has NO network access: fetch(), axios, XMLHttpRequest and require of http modules are unavailable and FAIL at runtime. NEVER make HTTP requests in a Code node — use the HTTP Request node and process its output instead.
  @relatedNodes
    - n8n-nodes-base.httpRequest: "Use this instead for ANY HTTP/API call — the Code node sandbox cannot make network requests"
    - n8n-nodes-base.set: "Use this instead for data manipulation: add/modify/rename fields, set values, map data"
    - n8n-nodes-base.filter: "Use this instead for filtering items by condition"
    - n8n-nodes-base.if: "Use this instead for routing by condition"
    - n8n-nodes-base.switch: "Use this instead for multi-way routing by condition"
    - n8n-nodes-base.splitOut: "Use this instead for splitting arrays into separate items"
    - n8n-nodes-base.aggregate: "Use this instead for combining multiple items into one"
    - n8n-nodes-base.summarize: "Use this instead for summarizing or pivoting data"
    - n8n-nodes-base.removeDuplicates: "Use this instead for removing duplicates"
    - n8n-nodes-base.limit: "Use this instead to reduce the number of items returned"
    - n8n-nodes-base.merge: "Use this instead for merging data from multiple branches"
    - n8n-nodes-base.dateTime: "Use this instead for date time operations"
    - n8n-nodes-base.html: "Use this instead for creating html pages"
  Discriminators:
    mode:
      - runOnceForAllItems: "Run Once for All Items"
        Run this code only once, no matter how many input items there are
      - runOnceForEachItem: "Run Once for Each Item"
        Run this code as many times as there are input items

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.code", mode: "runOnceForAllItems" }] })

- @n8n/n8n-nodes-langchain.code
  Display Name: LangChain Code
  Version: 1
  Description: LangChain Code Node
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.toolCode
  Display Name: Code Tool
  Version: 1.3
  Description: Write a tool in JS or Python
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.lmCohere
  Display Name: Cohere Model
  Version: 1
  Description: Language Model Cohere
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.lmChatCohere
  Display Name: Cohere Chat Model
  Version: 1
  Description: For advanced usage with an AI chain
  Discriminators: none (use node directly without resource/operation/mode)

---

## "execute workflow"
Found 5 nodes:

- n8n-nodes-base.workflowTrigger [TRIGGER]
  Display Name: Workflow Trigger
  Version: 1
  Description: Triggers based on various lifecycle events, like when a workflow is activated
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.retrieverWorkflow
  Display Name: Workflow Retriever
  Version: 1.1
  Description: Use an n8n Workflow as Retriever
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.executeWorkflow
  Display Name: Execute Sub-workflow
  Version: 1.3
  Description: Execute another workflow
  Discriminators:
    mode:
      - once: "Run once with all items"
        Pass all items into a single execution of the sub-workflow
      - each: "Run once for each item"
        Call the sub-workflow individually for each item

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.executeWorkflow", mode: "once" }] })

- n8n-nodes-base.executeWorkflowTrigger [TRIGGER]
  Display Name: Execute Workflow Trigger
  Version: 1.2
  Description: Helpers for calling other n8n workflows. Used for designing modular, microservice-like workflows.
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.n8n
  Display Name: n8n
  Version: 1
  Description: Handle events and perform actions on your n8n instance
  Discriminators:
    resource:
      - audit:
          operations:
            - generate
              Generate a security audit for this n8n instance
      - credential:
          operations:
            - create
            - delete
            - getSchema
      - execution:
          operations:
            - get
            - getAll
            - delete
      - workflow:
          operations:
            - activate
            - create
            - deactivate
            - delete
            - get
            - getAll
            - getVersion
            - update

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.n8n", resource: "audit", operation: "generate" }] })

---

## "execute workflow trigger"
Found 5 nodes:

- n8n-nodes-base.executeWorkflowTrigger [TRIGGER]
  Display Name: Execute Workflow Trigger
  Version: 1.2
  Description: Helpers for calling other n8n workflows. Used for designing modular, microservice-like workflows.
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.workflowTrigger [TRIGGER]
  Display Name: Workflow Trigger
  Version: 1
  Description: Triggers based on various lifecycle events, like when a workflow is activated
  Discriminators: none (use node directly without resource/operation/mode)

- @n8n/n8n-nodes-langchain.retrieverWorkflow
  Display Name: Workflow Retriever
  Version: 1.1
  Description: Use an n8n Workflow as Retriever
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.n8nTrigger [TRIGGER]
  Display Name: n8n Trigger
  Version: 1
  Description: Handle events and perform actions on your n8n instance
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.formTrigger [TRIGGER]
  Display Name: n8n Form Trigger
  Version: 2.6
  Description: Generate webforms in n8n and pass their responses to the workflow
  @relatedNodes
    - n8n-nodes-base.form: "Add pages and final page to the form"
  Discriminators: none (use node directly without resource/operation/mode)

---

## "schedule trigger"
Found 5 nodes:

- n8n-nodes-base.scheduleTrigger [TRIGGER]
  Display Name: Schedule Trigger
  Version: 1.3
  Description: Triggers the workflow on a given schedule
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.n8nTrigger [TRIGGER]
  Display Name: n8n Trigger
  Version: 1
  Description: Handle events and perform actions on your n8n instance
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.formTrigger [TRIGGER]
  Display Name: n8n Form Trigger
  Version: 2.6
  Description: Generate webforms in n8n and pass their responses to the workflow
  @relatedNodes
    - n8n-nodes-base.form: "Add pages and final page to the form"
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.boxTrigger [TRIGGER]
  Display Name: Box Trigger
  Version: 1
  Description: Starts the workflow when Box events occur
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.sseTrigger [TRIGGER]
  Display Name: SSE Trigger
  Version: 1
  Description: Triggers the workflow when Server-Sent Events occur
  Discriminators: none (use node directly without resource/operation/mode)

---

## "if"
Found 5 nodes:

- n8n-nodes-base.if
  Display Name: If
  Version: 2.3
  Description: Route items to different branches (true/false)
  @builderHint After configuring, confirm the workflow wires both `.onTrue()` and `.onFalse()` (or only the relevant one) to the correct downstream node — IF has two named outputs and silently drops items routed to an unwired branch.
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.switch
  Display Name: Switch
  Version: 3.4
  Description: Route items depending on defined expression or rules
  Discriminators:
    mode:
      - rules: "Rules"
        Build a matching rule for each output
      - expression: "Expression"
        Write an expression to return the output index

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.switch", mode: "rules" }] })

- n8n-nodes-base.drift
  Display Name: Drift
  Version: 1
  Description: Consume Drift API
  Discriminators:
    resource:
      - contact:
          operations:
            - create
              Create a contact
            - getCustomAttributes
              Get custom attributes
            - delete
              Delete a contact
            - get
              Get a contact
            - update
              Update a contact

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.drift", resource: "contact", operation: "create" }] })

- @n8n/mcp-registry.apify
  Display Name: Apify MCP
  Version: 1.1
  Description: Connect to the Apify MCP Server
  @builderHint Agent-optimised Apify integration. When wiring an ai_tool to an AI Agent for Apify, use THIS node, not the native action node — this variant exposes Apify's tools in the shape AI Agents expect and ships pre-configured connection details.
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.driftTool
  Display Name: Drift Tool
  Version: 1
  Description: Consume Drift API
  Discriminators:
    resource:
      - contact:
          operations:
            - create
              Create a contact
            - getCustomAttributes
              Get custom attributes
            - delete
              Delete a contact
            - get
              Get a contact
            - update
              Update a contact

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.driftTool", resource: "contact", operation: "create" }] })

---

## "set"
Found 5 nodes:

- n8n-nodes-base.set
  Display Name: Edit Fields (Set)
  Version: 3.5
  Description: Modify, add, or remove item fields
  Discriminators:
    mode:
      - manual: "Manual Mapping"
        Edit item fields one by one
      - raw: "JSON"
        Customize item output with JSON

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.set", mode: "manual" }] })

- n8n-nodes-base.sendyTool
  Display Name: Sendy Tool
  Version: 1
  Description: Consume Sendy API
  Discriminators:
    resource:
      - campaign:
          operations:
            - create
              Create a campaign
      - subscriber:
          operations:
            - add
              Add a subscriber to a list
            - count
              Count subscribers
            - delete
              Delete a subscriber from a list
            - remove
              Unsubscribe user from a list
            - status
              Get the status of subscriber

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.sendyTool", resource: "campaign", operation: "create" }] })

- n8n-nodes-base.sms77Tool
  Display Name: seven Tool
  Version: 1
  Description: Send SMS and make text-to-speech calls
  Discriminators:
    resource:
      - sms:
          operations:
            - send
              Send SMS
      - voice:
          operations:
            - send
              Converts text to voice and calls a given number

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.sms77Tool", resource: "sms", operation: "send" }] })

- n8n-nodes-base.seaTable
  Display Name: SeaTable
  Version: 2
  Description: Consume the SeaTable API
  Discriminators:
    resource:
      - row:
          operations:
            - create
              Create a new row
            - remove
              Delete a row
            - get
              Get the content of a row
            - list
              Get many rows from a table or a table view
            - lock
              Lock a row to prevent further changes
            - search
              Search one or multiple rows
            - unlock
              Remove the lock from a row
            - update
              Update the content of a row
      - base:
          operations:
            - snapshot
              Create a snapshot of the base
            - metadata
              Get the complete metadata of the base
            - collaborator
              Get the username from the email or name of a collaborator
      - link:
          operations:
            - add
              Create a link between two rows in a link column
            - list
              List all links of a specific row
            - remove
              Remove a link between two rows from a link column
      - asset:
          operations:
            - getPublicURL
              Get the public URL from asset path
            - upload
              Add a file/image to an existing row

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.seaTable", resource: "row", operation: "create" }] })

- n8n-nodes-base.segmentTool
  Display Name: Segment Tool
  Version: 1
  Description: Consume Segment API
  Discriminators:
    resource:
      - group:
          Group lets you associate an identified user with a group
          operations:
            - add
              Add a user to a group
      - identify:
          Identify lets you tie a user to their actions
          operations:
            - create
              Create an identity
      - track:
          Track lets you record events
          operations:
            - event
              Record the actions your users perform. Every action triggers an event, which can also have associated properties.
            - page
              Record page views on your website, along with optional extra information about the page being viewed

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.segmentTool", resource: "group", operation: "add" }] })

---

## "error trigger"
Found 5 nodes:

- n8n-nodes-base.errorTrigger [TRIGGER]
  Display Name: Error Trigger
  Version: 1
  Description: Triggers the workflow when another workflow has an error
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.n8nTrigger [TRIGGER]
  Display Name: n8n Trigger
  Version: 1
  Description: Handle events and perform actions on your n8n instance
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.formTrigger [TRIGGER]
  Display Name: n8n Form Trigger
  Version: 2.6
  Description: Generate webforms in n8n and pass their responses to the workflow
  @relatedNodes
    - n8n-nodes-base.form: "Add pages and final page to the form"
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.boxTrigger [TRIGGER]
  Display Name: Box Trigger
  Version: 1
  Description: Starts the workflow when Box events occur
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.sseTrigger [TRIGGER]
  Display Name: SSE Trigger
  Version: 1
  Description: Triggers the workflow when Server-Sent Events occur
  Discriminators: none (use node directly without resource/operation/mode)

---

## "wait"
Found 5 nodes:

- n8n-nodes-base.wait
  Display Name: Wait
  Version: 1.1
  Description: Wait before continue with execution
  Discriminators: none (use node directly without resource/operation/mode)

- n8n-nodes-base.discord
  Display Name: Discord
  Version: 2
  Description: Sends data to Discord
  Discriminators:
    resource:
      - channel:
          operations:
            - create
              Create a new channel
            - deleteChannel
              Delete a channel
            - get
              Get a channel
            - getAll
              Retrieve the channels of a server
            - update
              Update a channel
            - sendLegacy
              Send a message to a channel using the webhook
      - message:
          operations:
            - deleteMessage
              Delete a message in a channel
            - get
              Get a message in a channel
            - getAll
              Retrieve the latest messages in a channel
            - react
              React to a message with an emoji
            - send
              Send a message to a channel, thread, or member
            - sendAndWait
              Send a message and wait for response
            - sendLegacy
              Send a message to a channel using the webhook
      - member:
          operations:
            - getAll
              Retrieve the members of a server
            - roleAdd
              Add a role to a member
            - roleRemove
              Remove a role from a member
            - sendLegacy
              Send a message to a channel using the webhook

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.discord", resource: "channel", operation: "create" }] })

- n8n-nodes-base.emailSend
  Display Name: Send Email
  Version: 2.1
  Description: Sends an email using SMTP protocol
  Discriminators:
    operation:
      - send
      - sendAndWait

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.emailSend", operation: "send" }] })

- n8n-nodes-base.googleChat
  Display Name: Google Chat
  Version: 1
  Description: Consume Google Chat API
  Discriminators:
    resource:
      - member:
          operations:
            - get
              Get a membership
            - getAll
              Get many memberships in a space
      - message:
          operations:
            - create
              Create a message
            - delete
              Delete a message
            - get
              Get a message
            - sendAndWait
              Send a message and wait for response
            - update
              Update a message
      - space:
          operations:
            - get
              Get a space
            - getAll
              Get many spaces the caller is a member of

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.googleChat", resource: "member", operation: "get" }] })

- n8n-nodes-base.gmail
  Display Name: Gmail
  Version: 2.2
  Description: Consume the Gmail API
  @relatedNodes
    - n8n-nodes-base.gmailTrigger: "Use Gmail Trigger for scheduled email fetching, which is simpler for user than Schedule Trigger with Gmail getAll"
  Discriminators:
    resource:
      - message:
          operations:
            - addLabels
            - delete
            - get
            - getAll
            - markAsRead
            - markAsUnread
            - removeLabels
            - reply
            - send
            - sendAndWait
      - label:
          operations:
            - create
            - delete
            - get
            - getAll
      - draft:
          operations:
            - create
            - delete
            - get
            - getAll
      - thread:
          operations:
            - addLabels
            - delete
            - get
            - getAll
            - removeLabels
            - reply
            - trash
            - untrash

  Use get_node_types with discriminators:
    get_node_types({ nodeIds: [{ nodeId: "n8n-nodes-base.gmail", resource: "message", operation: "addLabels" }] })

---

## Summary table (node id, kind, version, discriminators used for step 3)

| Requested query | Node id chosen | Kind | Version | Discriminators fetched in get_node_types |
|---|---|---|---|---|
| webhook | n8n-nodes-base.webhook | TRIGGER | 2.1 | none |
| respond to webhook | n8n-nodes-base.respondToWebhook | TRIGGER | 1.5 | none |
| http request | n8n-nodes-base.httpRequest | action | 4.5 (search) / 4.2 seen pinned in target workflow, see instance-typeversions.md | none |
| postgres | n8n-nodes-base.postgres | action | 2.7 | operation: executeQuery, insert, select (deleteTable/upsert/update not fetched — not requested) |
| code | n8n-nodes-base.code | action | 2 | mode: runOnceForAllItems, runOnceForEachItem |
| execute workflow | n8n-nodes-base.executeWorkflow | action | 1.3 | mode: once, each |
| execute workflow trigger | n8n-nodes-base.executeWorkflowTrigger | TRIGGER | 1.2 | none |
| schedule trigger | n8n-nodes-base.scheduleTrigger | TRIGGER | 1.3 | none |
| if | n8n-nodes-base.if | action | 2.3 | none |
| set | n8n-nodes-base.set | action | 3.5 (search) / 3.4 example in SDK reference | mode: manual, raw |
| error trigger | n8n-nodes-base.errorTrigger | TRIGGER | 1 | none |
| wait | n8n-nodes-base.wait | action | 1.1 | none |

Note: "Version" above is the **current node version reported by search_nodes on the MCP's n8n reference**, not necessarily the n8n instance's version — see `instance-typeversions.md` for what a real existing workflow on the target-hint instance actually has pinned, and why that is a lower bound, not proof of capability.
