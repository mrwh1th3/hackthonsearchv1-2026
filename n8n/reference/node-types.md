<!-- MCP snapshot taken 2026-09-11 -- tool: mcp__claude_ai_n8n__get_node_types (n8n MCP server). Verbatim tool output for the 17 nodeId+discriminator requests listed in nodes-search.md step 3 (webhook, respondToWebhook, httpRequest, postgres x3 operations, code x2 modes, executeWorkflow x2 modes, executeWorkflowTrigger, scheduleTrigger, if, set x2 modes, errorTrigger, wait). -->

# n8n node type definitions -- MCP snapshot 2026-09-11

# TypeScript Type Definitions

## n8n-nodes-base.webhook (v21)

```typescript
/**
 * Webhook Node - Version 2.1
 * Starts the workflow when a webhook is called
 */


export interface WebhookV21Params {
/**
 * Whether to allow the webhook to listen for multiple HTTP methods
 * @default false
 */
    multipleMethods?: boolean | Expression<boolean>;
/**
 * The HTTP method to listen to
 * @displayOptions.show { multipleMethods: [false] }
 * @default GET
 */
    httpMethod?: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT' | Expression<string>;
/**
 * The path to listen to, dynamic values could be specified by using ':', e.g. 'your-path/:dynamic-value'. If dynamic values are set 'webhookId' would be prepended to path.
 * @builderHint The webhook path that triggers this workflow
 * @placeholderSupported false
 */
    path?: string | Expression<string>;
/**
 * The way to authenticate
 * @builderHint Default to 'none'. n8n exposes inbound trigger URLs publicly by design. Only select an authentication method when the user explicitly asks to authenticate inbound traffic.
 * @default none
 */
    authentication?: 'basicAuth' | 'headerAuth' | 'jwtAuth' | 'none' | Expression<string>;
/**
 * When and how to respond to the webhook
 * @builderHint Use 'responseNode' to respond via a 'Respond to Webhook' node later in the workflow
 * @default onReceived
 */
    responseMode?: 'onReceived' | 'lastNode' | 'responseNode' | 'streaming' | Expression<string>;
/**
 * What data should be returned. If it should return all items as an array or only the first item as object.
 * @displayOptions.show { responseMode: ["lastNode"] }
 * @default firstEntryJson
 */
    responseData?: 'allEntries' | 'firstEntryJson' | 'firstEntryBinary' | 'noData' | Expression<string>;
/**
 * Name of the binary property to return
 * @displayOptions.show { responseData: ["firstEntryBinary"] }
 * @default data
 */
    responseBinaryPropertyName?: string | Expression<string>;
  options?: {
    /** Comma-separated list of URLs allowed for cross-origin non-preflight requests. Use * (default) to allow all origins.
     * @default *
     */
    allowedOrigins?: string | Expression<string>;
    /** Whether the webhook will receive binary data
     * @displayOptions.show { /httpMethod: ["PATCH", "PUT", "POST"] }
     * @default false
     */
    binaryData?: boolean | Expression<boolean>;
    /** The name of the output field to put any binary file data in. Only relevant if binary data is received.
     * @default data
     */
    binaryPropertyName?: string | Expression<string>;
    /** Whether to ignore requests from bots like link previewers and web crawlers
     * @default false
     */
    ignoreBots?: boolean | Expression<boolean>;
    /** Comma-separated list of allowed IP addresses or CIDR ranges. Leave empty to allow all IPs.
     */
    ipWhitelist?: string | Expression<string>;
    /** Whether to send any body in the response
     * @displayOptions.show { /responseMode: ["onReceived"] }
     * @displayOptions.hide { rawBody: [true] }
     * @default false
     */
    noResponseBody?: boolean | Expression<boolean>;
    /** Expression evaluated against the incoming request. The workflow will run only if the expression returns true. &lt;code&gt;$json&lt;/code&gt; exposes the request as &lt;code&gt;{ body, headers, params, query }&lt;/code&gt;. Requests that do not match receive a 200 response, without creating an execution. If the expression fails to evaluate, the request is allowed through and the error is logged.
     */
    onlyRunIf?: string | Expression<string>;
    /** Name of the property to return the data of instead of the whole JSON
     * @displayOptions.show { /responseData: ["firstEntryJson"], /responseMode: ["lastNode"] }
     * @default data
     */
    responsePropertyName?: string | Expression<string>;
    /** If the data gets received via "Form-Data Multipart" it will be the prefix and a number starting with 0 will be attached to it
     * @hint The name of the output binary field to put the file in
     * @displayOptions.show { binaryData: [true] }
     * @default data
     */
    binaryPropertyName?: string | Expression<string>;
    /** Raw body (binary)
     * @displayOptions.hide { binaryData: [true], noResponseBody: [true] }
     * @default false
     */
    rawBody?: boolean | Expression<boolean>;
    /** Whether to return the raw body
     * @displayOptions.hide { noResponseBody: [true] }
     * @default false
     */
    rawBody?: boolean | Expression<boolean>;
    /** Response Code
     * @displayOptions.hide { /responseMode: ["responseNode"] }
     * @default {"values":{"responseCode":200}}
     */
    responseCode?: {
        /** Values
     */
    values?: {
      /** The HTTP response code to return
       * @default 200
       */
      responseCode?: 200 | 201 | 204 | 301 | 302 | 304 | 400 | 401 | 403 | 404 | 'customCode' | Expression<number>;
      /** Code
       * @displayOptions.show { responseCode: ["customCode"] }
       * @default 200
       */
      customCode?: number | Expression<number>;
    };
  };
    /** Set a custom content-type to return if another one as the "application/json" should be returned
     * @displayOptions.show { /responseData: ["firstEntryJson"], /responseMode: ["lastNode"] }
     */
    responseContentType?: string | Expression<string>;
    /** Custom response data to send
     * @displayOptions.show { /responseMode: ["onReceived"] }
     * @displayOptions.hide { noResponseBody: [true] }
     */
    responseData?: string | Expression<string>;
    /** Add headers to the webhook response
     * @default {}
     */
    responseHeaders?: {
        /** Entries
     */
    entries?: Array<{
      /** Name of the header
       */
      name?: string | Expression<string>;
      /** Value of the header
       */
      value?: string | Expression<string>;
    }>;
  };
  };
}

export type WebhookV21Output = {
  headers?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  webhookUrl?: string;
  executionMode?: string;
};

export interface WebhookV21Credentials {
  httpBasicAuth: CredentialReference;
  httpHeaderAuth: CredentialReference;
  jwtAuth: CredentialReference;
}

interface WebhookV21NodeBase {
  type: 'n8n-nodes-base.webhook';
  version: 2.1;
}

export type WebhookV21ParamsNode = WebhookV21NodeBase & {
  config: NodeConfig<WebhookV21Params> & { credentials?: WebhookV21Credentials };
  output?: Items<WebhookV21Output>;
};

export type WebhookV21Node = WebhookV21ParamsNode;
```

---

## n8n-nodes-base.respondToWebhook (v15)

```typescript
/**
 * Respond to Webhook Node - Version 1.5
 * Returns data for Webhook
 */


export interface RespondToWebhookV15Params {
/**
 * Whether to provide an additional output branch with the response sent to the webhook
 * @default false
 */
    enableResponseOutput?: boolean | Expression<boolean>;
/**
 * The data that should be returned
 * @default firstIncomingItem
 */
    respondWith?: 'allIncomingItems' | 'binary' | 'firstIncomingItem' | 'json' | 'jwt' | 'noData' | 'redirect' | 'text';
/**
 * The URL to redirect to
 * @displayOptions.show { respondWith: ["redirect"] }
 */
    redirectURL: string | Expression<string>;
/**
 * The HTTP response JSON data
 * @displayOptions.show { respondWith: ["json"] }
 */
    responseBody?: IDataObject | string | Expression<string>;
/**
 * The payload to include in the JWT token
 * @displayOptions.show { respondWith: ["jwt"] }
 */
    payload?: IDataObject | string | Expression<string>;
/**
 * Response Data Source
 * @displayOptions.show { respondWith: ["binary"] }
 * @default automatically
 */
    responseDataSource?: 'automatically' | 'set' | Expression<string>;
/**
 * The name of the node input field with the binary data
 * @displayOptions.show { respondWith: ["binary"], responseDataSource: ["set"] }
 * @default data
 */
    inputFieldName?: string | Expression<string>;
  options?: {
    /** The HTTP response code to return. Defaults to 200.
     * @default 200
     */
    responseCode?: number | Expression<number>;
    /** Add headers to the webhook response
     * @default {}
     */
    responseHeaders?: {
        /** Entries
     */
    entries?: Array<{
      /** Name of the header
       */
      name?: string | Expression<string>;
      /** Value of the header
       */
      value?: string | Expression<string>;
    }>;
  };
    /** The name of the response field to put all items in
     * @displayOptions.show { /respondWith: ["allIncomingItems", "firstIncomingItem"] }
     */
    responseKey?: string | Expression<string>;
    /** Whether to enable streaming to the response
     * @displayOptions.show { /respondWith: ["allIncomingItems", "firstIncomingItem", "text", "json", "jwt"] }
     * @default true
     */
    enableStreaming?: boolean | Expression<boolean>;
  };
}

export interface RespondToWebhookV15Credentials {
  jwtAuth: CredentialReference;
}

interface RespondToWebhookV15NodeBase {
  type: 'n8n-nodes-base.respondToWebhook';
  version: 1.5;
}

export type RespondToWebhookV15ParamsNode = RespondToWebhookV15NodeBase & {
  config: NodeConfig<RespondToWebhookV15Params> & { credentials?: RespondToWebhookV15Credentials };
};

export type RespondToWebhookV15Node = RespondToWebhookV15ParamsNode;
```

---

## n8n-nodes-base.httpRequest (v45)

```typescript
/**
 * HTTP Request Node - Version 4.5
 * Makes an HTTP request and returns the response data
 */


export interface HttpRequestV45Params {
/**
 * The request method to use
 * @default GET
 */
    method?: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT' | Expression<string>;
/**
 * The URL to make the request to
 */
    url: string | Expression<string>;
/**
 * Authentication
 * @builderHint Prefer "predefinedCredentialType" whenever n8n already ships a credential for the target service: it is less setup for the user and authenticates the request the same way. Look it up by the request URL rather than guessing. Use "genericCredentialType" only for services with no dedicated n8n credential. Keep "none" for unauthenticated requests and for inbound triggers.
 * @default none
 */
    authentication?: 'none' | 'predefinedCredentialType' | 'genericCredentialType';
/**
 * Credential Type
 * @displayOptions.show { authentication: ["predefinedCredentialType"] }
 */
    nodeCredentialType?: string;
/**
 * Generic Auth Type
 * @builderHint Pick by how the API authenticates, not by what the user calls it:
- "Authorization: Bearer &lt;token&gt;" → httpBearerAuth (single token field, best UX). Use this for OpenAI, Anthropic, GitHub PATs, Stripe, Notion, and any service whose docs say "Bearer".
- Custom header like X-API-Key, apikey, X-Auth-Token, or non-Bearer Authorization schemes → httpHeaderAuth (user must enter the header name and/or full value).
- API key in the query string (?api_key=...) → httpQueryAuth.
- username + password → httpBasicAuth.
A user saying "API key" or "header auth" usually means httpBearerAuth only when the docs use the Authorization: Bearer &lt;token&gt; scheme. Use httpHeaderAuth for custom header names or non-Bearer Authorization schemes where the full header value/prefix must be user-controlled.
 * @displayOptions.show { authentication: ["genericCredentialType"] }
 */
    genericAuthType?: 'httpBasicAuth' | 'httpBearerAuth' | 'httpDigestAuth' | 'httpHeaderAuth' | 'httpQueryAuth' | 'httpCustomAuth' | 'oAuth1Api' | 'oAuth2Api' | Expression<string>;
  provideSslCertificates?: boolean | Expression<boolean>;
/**
 * Whether the request has query params or not
 * @default false
 */
    sendQuery?: boolean;
/**
 * Specify Query Parameters
 * @displayOptions.show { sendQuery: [true] }
 * @default keypair
 */
    specifyQuery?: 'keypair' | 'json' | Expression<string>;
/**
 * Query Parameters
 * @displayOptions.show { sendQuery: [true], specifyQuery: ["keypair"] }
 * @default {"parameters":[{"name":"","value":""}]}
 */
    queryParameters?: {
        /** Query Parameter
     * @builderHint NEVER put static authentication values (API keys, tokens, PATs) in queryParameters. It's insecure to store credentials directly in parameters. Instead set authentication to "genericCredentialType", genericAuthType to "httpQueryAuth", and add credentials: { httpQueryAuth:
 newCredential("Name") }. Only use queryParameters for non-auth values. Dynamic values from previous nodes via expr() are acceptable.
     */
    parameters?: Array<{
      /** Name
       */
      name?: string | Expression<string>;
      /** Value
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * JSON
 * @displayOptions.show { sendQuery: [true], specifyQuery: ["json"] }
 */
    jsonQuery?: IDataObject | string | Expression<string>;
/**
 * Whether the request has headers or not
 * @default false
 */
    sendHeaders?: boolean;
/**
 * Specify Headers
 * @displayOptions.show { sendHeaders: [true] }
 * @default keypair
 */
    specifyHeaders?: 'keypair' | 'json' | Expression<string>;
/**
 * Headers
 * @displayOptions.show { sendHeaders: [true], specifyHeaders: ["keypair"] }
 * @default {"parameters":[{"name":"","value":""}]}
 */
    headerParameters?: {
        /** Header
     * @builderHint NEVER put static authentication values (API keys, tokens, PATs) in headerParameters. It's insecure to store credentials directly in parameters. Instead set authentication to "genericCredentialType", genericAuthType to "httpHeaderAuth", and add credentials: { httpHeaderAuth:
 newCredential("Name") }. Only use headerParameters for non-auth headers like Content-Type or Accept. Dynamic values from previous nodes via expr() are acceptable.
     */
    parameters?: Array<{
      /** Name
       */
      name?: string | Expression<string>;
      /** Value
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * JSON
 * @displayOptions.show { sendHeaders: [true], specifyHeaders: ["json"] }
 */
    jsonHeaders?: IDataObject | string | Expression<string>;
/**
 * Whether the request has a body or not
 * @default false
 */
    sendBody?: boolean;
/**
 * Content-Type to use to send body parameters
 * @displayOptions.show { sendBody: [true] }
 * @default json
 */
    contentType?: 'form-urlencoded' | 'multipart-form-data' | 'json' | 'binaryData' | 'raw' | Expression<string>;
/**
 * The body can be specified using explicit fields (&lt;code&gt;keypair&lt;/code&gt;) or using a JavaScript object (&lt;code&gt;json&lt;/code&gt;)
 * @displayOptions.show { sendBody: [true], contentType: ["json"] }
 * @default keypair
 */
    specifyBody?: 'keypair' | 'json' | Expression<string>;
/**
 * Body Parameters
 * @builderHint NEVER put static authentication values (API keys, tokens, PATs) in bodyParameters. It's insecure to store credentials directly in parameters. Instead set authentication to "genericCredentialType", genericAuthType to "customAuth", and add credentials: { customAuth:
 newCredential("Name") }. Only use bodyParameters for non-auth values. Dynamic values from previous nodes via expr() are acceptable.
 * @displayOptions.show { sendBody: [true], contentType: ["json"], specifyBody: ["keypair"] }
 * @default {"parameters":[{"name":"","value":""}]}
 */
    bodyParameters?: {
        /** Body Field
     */
    parameters?: Array<{
      /** ID of the field to set. Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/"&gt;expression&lt;/a&gt;.
       */
      name?: string | Expression<string>;
      /** Value of the field to set
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * JSON
 * @builderHint NEVER put static authentication values (API keys, tokens, PATs) in bodyParameters. It's insecure to store credentials directly in parameters. Instead set authentication to "genericCredentialType", genericAuthType to "customAuth", and add credentials: { customAuth:
 newCredential("Name") }. Only use bodyParameters for non-auth values. Dynamic values from previous nodes via expr() are acceptable.
 * @displayOptions.show { sendBody: [true], contentType: ["json"], specifyBody: ["json"] }
 */
    jsonBody?: IDataObject | string | Expression<string>;
/**
 * Body
 * @displayOptions.show { sendBody: [true], specifyBody: ["string"] }
 */
    body?: string | Expression<string>;
/**
 * The name of the incoming field containing the binary file data to be processed
 * @displayOptions.show { sendBody: [true], contentType: ["binaryData"] }
 */
    inputDataFieldName?: string | Expression<string>;
/**
 * Content Type
 * @displayOptions.show { sendBody: [true], contentType: ["raw"] }
 */
    rawContentType?: string | Expression<string>;
  options?: {
    /** Batching
     * @default {"batch":{}}
     */
    batching?: {
        /** Batching
     */
    batch?: {
      /** Input will be split in batches to throttle requests. -1 for disabled. 0 will be treated as 1.
       * @default 50
       */
      batchSize?: number | Expression<number>;
      /** Time (in milliseconds) between each batch of requests. 0 for disabled.
       * @default 1000
       */
      batchInterval?: number | Expression<number>;
    };
  };
    /** Whether to download the response even if SSL certificate validation is not possible
     * @default false
     */
    allowUnauthorizedCerts?: boolean;
    /** Array Format in Query Parameters
     * @displayOptions.show { /sendQuery: [true] }
     * @default brackets
     */
    queryParameterArrays?: 'repeat' | 'brackets' | 'indices' | Expression<string>;
    /** Whether to lowercase header names
     * @default true
     */
    lowercaseHeaders?: boolean | Expression<boolean>;
    /** Redirects
     * @default {"redirect":{}}
     */
    redirect?: {
        /** Redirect
     */
    redirect?: {
      /** Whether to follow all redirects
       * @default false
       */
      followRedirects?: boolean;
      /** Max number of redirects to follow
       * @displayOptions.show { followRedirects: [true] }
       * @default 21
       */
      maxRedirects?: number | Expression<number>;
    };
  };
    /** Redirects
     * @default {"redirect":{}}
     */
    redirect?: {
        /** Redirect
     */
    redirect?: {
      /** Whether to follow all redirects
       * @default true
       */
      followRedirects?: boolean;
      /** Max number of redirects to follow
       * @displayOptions.show { followRedirects: [true] }
       * @default 21
       */
      maxRedirects?: number | Expression<number>;
    };
  };
    /** Response
     * @default {"response":{}}
     */
    response?: {
        /** Response
     */
    response?: {
      /** Whether to return the full response (headers and response status code) data instead of only the body
       * @default false
       */
      fullResponse?: boolean | Expression<boolean>;
      /** Whether to succeeds also when status code is not 2xx
       * @default false
       */
      neverError?: boolean | Expression<boolean>;
      /** The format in which the data gets returned from the URL
       * @default autodetect
       */
      responseFormat?: 'autodetect' | 'file' | 'json' | 'text';
      /** Name of the binary property to which to write the data of the read file
       * @displayOptions.show { responseFormat: ["file", "text"] }
       * @default data
       */
      outputPropertyName?: string | Expression<string>;
    };
  };
    /** Pagination
     * @default {"pagination":{}}
     */
    pagination?: {
        /** Pagination
     */
    pagination?: {
      /** If pagination should be used
       * @default updateAParameterInEachRequest
       */
      paginationMode?: 'off' | 'updateAParameterInEachRequest' | 'responseContainsNextURL' | Expression<string>;
      /** Should evaluate to the URL of the next page. &lt;a href="https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/#pagination" target="_blank"&gt;More info&lt;/a&gt;.
       * @displayOptions.show { paginationMode: ["responseContainsNextURL"] }
       */
      nextURL?: string | Expression<string>;
      /** Parameters
       * @displayOptions.show { paginationMode: ["updateAParameterInEachRequest"] }
       * @default {"parameters":[{"type":"qs","name":"","value":""}]}
       */
      parameters?: {
        /** Parameter
     */
    parameters?: Array<{
      /** Where the parameter should be set
       * @default qs
       */
      type?: 'body' | 'headers' | 'qs' | Expression<string>;
      /** Name
       */
      name?: string | Expression<string>;
      /** Value
       * @hint Use expression mode and $response to access response data
       */
      value?: string | Expression<string>;
    }>;
  };
      /** When should no further requests be made?
       * @displayOptions.hide { paginationMode: ["off"] }
       * @default responseIsEmpty
       */
      paginationCompleteWhen?: 'responseIsEmpty' | 'receiveSpecificStatusCodes' | 'other' | Expression<string>;
      /** Accepts comma-separated values
       * @displayOptions.show { paginationCompleteWhen: ["receiveSpecificStatusCodes"] }
       */
      statusCodesWhenComplete?: string | Expression<string>;
      /** Should evaluate to true when pagination is complete. &lt;a href="https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/#pagination" target="_blank"&gt;More info&lt;/a&gt;.
       * @displayOptions.show { paginationCompleteWhen: ["other"] }
       */
      completeExpression?: string | Expression<string>;
      /** Whether the number of requests should be limited
       * @displayOptions.hide { paginationMode: ["off"] }
       * @default false
       */
      limitPagesFetched?: boolean;
      /** Maximum amount of request to be make
       * @displayOptions.show { limitPagesFetched: [true] }
       * @default 100
       */
      maxRequests?: number | Expression<number>;
      /** Time in milliseconds to wait between requests
       * @hint At 0 no delay will be added
       * @displayOptions.hide { paginationMode: ["off"] }
       * @default 0
       */
      requestInterval?: number | Expression<number>;
    };
  };
    /** HTTP proxy to use
     */
    proxy?: string | Expression<string>;
    /** Time in ms to wait for the server to send response headers (and start the response body) before aborting the request
     * @default 10000
     */
    timeout?: number | Expression<number>;
    /** Whether to send credentials, like the "Authorization" header, on redirects to a different origin
     * @default false
     */
    sendCredentialsOnCrossOriginRedirect?: boolean | Expression<boolean>;
  };
/**
 * Whether the optimize the tool response to reduce amount of data passed to the LLM that could lead to better result and reduce cost
 * @displayOptions.show { @tool: [true] }
 * @default false
 */
    optimizeResponse?: boolean;
/**
 * Expected Response Type
 * @displayOptions.show { optimizeResponse: [true], @tool: [true] }
 * @default json
 */
    responseType?: 'json' | 'html' | 'text' | Expression<string>;
/**
 * Specify the name of the field in the response containing the data
 * @hint leave blank to use whole response
 * @displayOptions.show { optimizeResponse: [true], responseType: ["json"], @tool: [true] }
 */
    dataField?: string | Expression<string>;
/**
 * What fields response object should include
 * @displayOptions.show { optimizeResponse: [true], responseType: ["json"], @tool: [true] }
 * @default all
 */
    fieldsToInclude?: 'all' | 'selected' | 'except' | Expression<string>;
/**
 * Comma-separated list of the field names. Supports dot notation. You can drag the selected fields from the input panel.
 * @displayOptions.show { optimizeResponse: [true], responseType: ["json"], @tool: [true] }
 * @displayOptions.hide { fieldsToInclude: ["all"] }
 */
    fields?: string | Expression<string>;
/**
 * Select specific element(e.g. body) or multiple elements(e.g. div) of chosen type in the response HTML.
 * @displayOptions.show { optimizeResponse: [true], responseType: ["html"], @tool: [true] }
 * @default body
 */
    cssSelector?: string | Expression<string>;
/**
 * Whether to return only content of html elements, stripping html tags and attributes
 * @hint Uses less tokens and may be easier for model to understand
 * @displayOptions.show { optimizeResponse: [true], responseType: ["html"], @tool: [true] }
 * @default false
 */
    onlyContent?: boolean | Expression<boolean>;
/**
 * Comma-separated list of selectors that would be excluded when extracting content
 * @displayOptions.show { optimizeResponse: [true], responseType: ["html"], onlyContent: [true], @tool: [true] }
 */
    elementsToOmit?: string | Expression<string>;
/**
 * Truncate Response
 * @hint Helps save tokens
 * @displayOptions.show { optimizeResponse: [true], responseType: ["text", "html"], @tool: [true] }
 * @default false
 */
    truncateResponse?: boolean | Expression<boolean>;
/**
 * Max Response Characters
 * @displayOptions.show { optimizeResponse: [true], responseType: ["text", "html"], truncateResponse: [true], @tool: [true] }
 * @default 1000
 */
    maxLength?: number | Expression<number>;
}

export interface HttpRequestV45Credentials {
  httpSslAuth: CredentialReference;
  /** Generic auth credentials - set the 'genericAuthType' config parameter to select which one to use */
  httpBasicAuth?: CredentialReference;
  httpBearerAuth?: CredentialReference;
  httpDigestAuth?: CredentialReference;
  httpHeaderAuth?: CredentialReference;
  httpQueryAuth?: CredentialReference;
  httpCustomAuth?: CredentialReference;
  oAuth1Api?: CredentialReference;
  oAuth2Api?: CredentialReference;
}

interface HttpRequestV45NodeBase {
  type: 'n8n-nodes-base.httpRequest';
  version: 4.5;
}

export type HttpRequestV45ParamsNode = HttpRequestV45NodeBase & {
  config: NodeConfig<HttpRequestV45Params> & { credentials?: HttpRequestV45Credentials };
};

export type HttpRequestV45Node = HttpRequestV45ParamsNode;
```

---

## n8n-nodes-base.postgres (v27)

```typescript
/**
 * Postgres Node - Version 2.7
 * Get, add and update data in Postgres
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

export interface PostgresV27Params {
  resource?: unknown;
/**
 * Operation
 * @displayOptions.show { resource: ["database"] }
 * @default insert
 */
    operation?: 'deleteTable' | 'executeQuery' | 'insert' | 'upsert' | 'select' | 'update';
/**
 * The schema that contains the table you want to work on
 * @searchListMethod schemaSearch
 * @displayOptions.hide { operation: ["executeQuery"] }
 * @default {"mode":"list","value":"public"}
 */
    schema?: { __rl: true; mode: 'list' | 'name'; value: string; cachedResultName?: string };
/**
 * The table you want to work on
 * @searchListMethod tableSearch
 * @displayOptions.hide { operation: ["executeQuery"] }
 * @default {"mode":"list","value":""}
 */
    table?: { __rl: true; mode: 'list' | 'name'; value: string; cachedResultName?: string };
/**
 * Command
 * @displayOptions.show { resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default truncate
 */
    deleteCommand?: 'truncate' | 'delete' | 'drop' | Expression<string>;
/**
 * Whether to reset identity (auto-increment) columns to their initial values
 * @displayOptions.show { deleteCommand: ["truncate"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default false
 */
    restartSequences?: boolean | Expression<boolean>;
/**
 * If not set, all rows will be selected
 * @displayOptions.show { deleteCommand: ["delete"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    where?: {
        /** Values
     */
    values?: Array<{
      /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
       * @loadOptionsMethod getColumns
       */
      column?: string | Expression<string>;
      /** The operator to check the column against. When using 'LIKE' operator percent sign ( %) matches zero or more characters, underscore ( _ ) matches any single character.
       * @default equal
       */
      condition?: 'equal' | '!=' | 'LIKE' | '>' | '<' | '>=' | '<=' | 'IS NULL' | 'IS NOT NULL' | Expression<string>;
      /** Value
       * @displayOptions.hide { condition: ["IS NULL", "IS NOT NULL"] }
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * How to combine the conditions defined in "Select Rows": AND requires all conditions to be true, OR requires at least one condition to be true
 * @displayOptions.show { deleteCommand: ["delete"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default AND
 */
    combineConditions?: 'AND' | 'OR' | Expression<string>;
/**
 * Options
 * @displayOptions.show { resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    options?: {
    /** Whether to drop all objects that depend on the table, such as views and sequences
     * @displayOptions.show { /operation: ["deleteTable"] }
     * @displayOptions.hide { /deleteCommand: ["delete"] }
     * @default false
     */
    cascade?: boolean | Expression<boolean>;
    /** Number of seconds reserved for connecting to the database
     * @default 30
     */
    connectionTimeout?: number | Expression<number>;
    /** Number of seconds to wait before idle connection would be eligible for closing
     * @default 0
     */
    delayClosingIdleConnection?: number | Expression<number>;
    /** The way queries should be sent to the database
     * @default single
     */
    queryBatching?: 'single' | 'independently' | 'transaction';
    /** Comma-separated list of the values you want to use as query parameters. &lt;a href="https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/#use-query-parameters" target="_blank"&gt;More info&lt;/a&gt;.
     * @hint Comma-separated list of values: reference them in your query as $1, $2, $3…
     * @displayOptions.show { /operation: ["executeQuery"] }
     */
    queryReplacement?: string | Expression<string>;
    /** Whether to treat query parameters enclosed in single quotes as text e.g. '$1'
     * @displayOptions.show { queryReplacement: [{"_cnd":{"exists":true}}] }
     * @default false
     */
    treatQueryParametersInSingleQuotesAsText?: boolean | Expression<boolean>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getColumnsMultiOptions
     * @displayOptions.show { /operation: ["select", "insert", "update", "upsert"] }
     * @default []
     */
    outputColumns?: string[];
    /** Output Large-Format Numbers As
     * @hint Applies to NUMERIC and BIGINT columns only
     * @default text
     */
    largeNumbersOutput?: 'numbers' | 'text' | Expression<string>;
    /** Whether to skip the row and do not throw error if a unique constraint or exclusion constraint is violated
     * @displayOptions.show { /operation: ["insert"] }
     * @default false
     */
    skipOnConflict?: boolean | Expression<boolean>;
    /** Whether to replace empty strings with NULL in input, could be useful when data come from spreadsheet
     * @displayOptions.show { /operation: ["insert", "update", "upsert", "executeQuery"] }
     * @default false
     */
    replaceEmptyStrings?: boolean | Expression<boolean>;
  };
/**
 * The SQL query to execute. You can use n8n expressions and $1, $2, $3, etc to refer to the 'Query Parameters' set in options below.
 * @hint Consider using query parameters to prevent SQL injection attacks. Add them in the options below
 * @displayOptions.show { resource: ["database"], operation: ["executeQuery"] }
 */
    query: string;
/**
 * Columns
 * @displayOptions.show { resource: ["database"], operation: ["insert"] }
 * @displayOptions.hide { table: [""] }
 * @default {"mappingMode":"defineBelow","value":null}
 */
    columns?: ResourceMapperValue;
/**
 * Whether to return all results or only up to a given limit
 * @displayOptions.show { resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false], resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Sort
 * @displayOptions.show { resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    sort?: {
        /** Values
     */
    values?: Array<{
      /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
       * @loadOptionsMethod getColumns
       */
      column?: string | Expression<string>;
      /** Direction
       * @default ASC
       */
      direction?: 'ASC' | 'DESC' | Expression<string>;
    }>;
  };
}

export interface PostgresV27Credentials {
  postgres: CredentialReference;
}

interface PostgresV27NodeBase {
  type: 'n8n-nodes-base.postgres';
  version: 2.7;
}

export type PostgresV27ParamsNode = PostgresV27NodeBase & {
  config: NodeConfig<PostgresV27Params> & { credentials?: PostgresV27Credentials };
};

export type PostgresV27Node = PostgresV27ParamsNode;
```

---

## n8n-nodes-base.postgres (v27)

```typescript
/**
 * Postgres Node - Version 2.7
 * Get, add and update data in Postgres
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

export interface PostgresV27Params {
  resource?: unknown;
/**
 * Operation
 * @displayOptions.show { resource: ["database"] }
 * @default insert
 */
    operation?: 'deleteTable' | 'executeQuery' | 'insert' | 'upsert' | 'select' | 'update';
/**
 * The schema that contains the table you want to work on
 * @searchListMethod schemaSearch
 * @displayOptions.hide { operation: ["executeQuery"] }
 * @default {"mode":"list","value":"public"}
 */
    schema?: { __rl: true; mode: 'list' | 'name'; value: string; cachedResultName?: string };
/**
 * The table you want to work on
 * @searchListMethod tableSearch
 * @displayOptions.hide { operation: ["executeQuery"] }
 * @default {"mode":"list","value":""}
 */
    table?: { __rl: true; mode: 'list' | 'name'; value: string; cachedResultName?: string };
/**
 * Command
 * @displayOptions.show { resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default truncate
 */
    deleteCommand?: 'truncate' | 'delete' | 'drop' | Expression<string>;
/**
 * Whether to reset identity (auto-increment) columns to their initial values
 * @displayOptions.show { deleteCommand: ["truncate"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default false
 */
    restartSequences?: boolean | Expression<boolean>;
/**
 * If not set, all rows will be selected
 * @displayOptions.show { deleteCommand: ["delete"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    where?: {
        /** Values
     */
    values?: Array<{
      /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
       * @loadOptionsMethod getColumns
       */
      column?: string | Expression<string>;
      /** The operator to check the column against. When using 'LIKE' operator percent sign ( %) matches zero or more characters, underscore ( _ ) matches any single character.
       * @default equal
       */
      condition?: 'equal' | '!=' | 'LIKE' | '>' | '<' | '>=' | '<=' | 'IS NULL' | 'IS NOT NULL' | Expression<string>;
      /** Value
       * @displayOptions.hide { condition: ["IS NULL", "IS NOT NULL"] }
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * How to combine the conditions defined in "Select Rows": AND requires all conditions to be true, OR requires at least one condition to be true
 * @displayOptions.show { deleteCommand: ["delete"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default AND
 */
    combineConditions?: 'AND' | 'OR' | Expression<string>;
/**
 * Options
 * @displayOptions.show { resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    options?: {
    /** Whether to drop all objects that depend on the table, such as views and sequences
     * @displayOptions.show { /operation: ["deleteTable"] }
     * @displayOptions.hide { /deleteCommand: ["delete"] }
     * @default false
     */
    cascade?: boolean | Expression<boolean>;
    /** Number of seconds reserved for connecting to the database
     * @default 30
     */
    connectionTimeout?: number | Expression<number>;
    /** Number of seconds to wait before idle connection would be eligible for closing
     * @default 0
     */
    delayClosingIdleConnection?: number | Expression<number>;
    /** The way queries should be sent to the database
     * @default single
     */
    queryBatching?: 'single' | 'independently' | 'transaction';
    /** Comma-separated list of the values you want to use as query parameters. &lt;a href="https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/#use-query-parameters" target="_blank"&gt;More info&lt;/a&gt;.
     * @hint Comma-separated list of values: reference them in your query as $1, $2, $3…
     * @displayOptions.show { /operation: ["executeQuery"] }
     */
    queryReplacement?: string | Expression<string>;
    /** Whether to treat query parameters enclosed in single quotes as text e.g. '$1'
     * @displayOptions.show { queryReplacement: [{"_cnd":{"exists":true}}] }
     * @default false
     */
    treatQueryParametersInSingleQuotesAsText?: boolean | Expression<boolean>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getColumnsMultiOptions
     * @displayOptions.show { /operation: ["select", "insert", "update", "upsert"] }
     * @default []
     */
    outputColumns?: string[];
    /** Output Large-Format Numbers As
     * @hint Applies to NUMERIC and BIGINT columns only
     * @default text
     */
    largeNumbersOutput?: 'numbers' | 'text' | Expression<string>;
    /** Whether to skip the row and do not throw error if a unique constraint or exclusion constraint is violated
     * @displayOptions.show { /operation: ["insert"] }
     * @default false
     */
    skipOnConflict?: boolean | Expression<boolean>;
    /** Whether to replace empty strings with NULL in input, could be useful when data come from spreadsheet
     * @displayOptions.show { /operation: ["insert", "update", "upsert", "executeQuery"] }
     * @default false
     */
    replaceEmptyStrings?: boolean | Expression<boolean>;
  };
/**
 * The SQL query to execute. You can use n8n expressions and $1, $2, $3, etc to refer to the 'Query Parameters' set in options below.
 * @hint Consider using query parameters to prevent SQL injection attacks. Add them in the options below
 * @displayOptions.show { resource: ["database"], operation: ["executeQuery"] }
 */
    query: string;
/**
 * Columns
 * @displayOptions.show { resource: ["database"], operation: ["insert"] }
 * @displayOptions.hide { table: [""] }
 * @default {"mappingMode":"defineBelow","value":null}
 */
    columns?: ResourceMapperValue;
/**
 * Whether to return all results or only up to a given limit
 * @displayOptions.show { resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false], resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Sort
 * @displayOptions.show { resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    sort?: {
        /** Values
     */
    values?: Array<{
      /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
       * @loadOptionsMethod getColumns
       */
      column?: string | Expression<string>;
      /** Direction
       * @default ASC
       */
      direction?: 'ASC' | 'DESC' | Expression<string>;
    }>;
  };
}

export interface PostgresV27Credentials {
  postgres: CredentialReference;
}

interface PostgresV27NodeBase {
  type: 'n8n-nodes-base.postgres';
  version: 2.7;
}

export type PostgresV27ParamsNode = PostgresV27NodeBase & {
  config: NodeConfig<PostgresV27Params> & { credentials?: PostgresV27Credentials };
};

export type PostgresV27Node = PostgresV27ParamsNode;
```

---

## n8n-nodes-base.postgres (v27)

```typescript
/**
 * Postgres Node - Version 2.7
 * Get, add and update data in Postgres
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

export interface PostgresV27Params {
  resource?: unknown;
/**
 * Operation
 * @displayOptions.show { resource: ["database"] }
 * @default insert
 */
    operation?: 'deleteTable' | 'executeQuery' | 'insert' | 'upsert' | 'select' | 'update';
/**
 * The schema that contains the table you want to work on
 * @searchListMethod schemaSearch
 * @displayOptions.hide { operation: ["executeQuery"] }
 * @default {"mode":"list","value":"public"}
 */
    schema?: { __rl: true; mode: 'list' | 'name'; value: string; cachedResultName?: string };
/**
 * The table you want to work on
 * @searchListMethod tableSearch
 * @displayOptions.hide { operation: ["executeQuery"] }
 * @default {"mode":"list","value":""}
 */
    table?: { __rl: true; mode: 'list' | 'name'; value: string; cachedResultName?: string };
/**
 * Command
 * @displayOptions.show { resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default truncate
 */
    deleteCommand?: 'truncate' | 'delete' | 'drop' | Expression<string>;
/**
 * Whether to reset identity (auto-increment) columns to their initial values
 * @displayOptions.show { deleteCommand: ["truncate"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default false
 */
    restartSequences?: boolean | Expression<boolean>;
/**
 * If not set, all rows will be selected
 * @displayOptions.show { deleteCommand: ["delete"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    where?: {
        /** Values
     */
    values?: Array<{
      /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
       * @loadOptionsMethod getColumns
       */
      column?: string | Expression<string>;
      /** The operator to check the column against. When using 'LIKE' operator percent sign ( %) matches zero or more characters, underscore ( _ ) matches any single character.
       * @default equal
       */
      condition?: 'equal' | '!=' | 'LIKE' | '>' | '<' | '>=' | '<=' | 'IS NULL' | 'IS NOT NULL' | Expression<string>;
      /** Value
       * @displayOptions.hide { condition: ["IS NULL", "IS NOT NULL"] }
       */
      value?: string | Expression<string>;
    }>;
  };
/**
 * How to combine the conditions defined in "Select Rows": AND requires all conditions to be true, OR requires at least one condition to be true
 * @displayOptions.show { deleteCommand: ["delete"], resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default AND
 */
    combineConditions?: 'AND' | 'OR' | Expression<string>;
/**
 * Options
 * @displayOptions.show { resource: ["database"], operation: ["deleteTable"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    options?: {
    /** Whether to drop all objects that depend on the table, such as views and sequences
     * @displayOptions.show { /operation: ["deleteTable"] }
     * @displayOptions.hide { /deleteCommand: ["delete"] }
     * @default false
     */
    cascade?: boolean | Expression<boolean>;
    /** Number of seconds reserved for connecting to the database
     * @default 30
     */
    connectionTimeout?: number | Expression<number>;
    /** Number of seconds to wait before idle connection would be eligible for closing
     * @default 0
     */
    delayClosingIdleConnection?: number | Expression<number>;
    /** The way queries should be sent to the database
     * @default single
     */
    queryBatching?: 'single' | 'independently' | 'transaction';
    /** Comma-separated list of the values you want to use as query parameters. &lt;a href="https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/#use-query-parameters" target="_blank"&gt;More info&lt;/a&gt;.
     * @hint Comma-separated list of values: reference them in your query as $1, $2, $3…
     * @displayOptions.show { /operation: ["executeQuery"] }
     */
    queryReplacement?: string | Expression<string>;
    /** Whether to treat query parameters enclosed in single quotes as text e.g. '$1'
     * @displayOptions.show { queryReplacement: [{"_cnd":{"exists":true}}] }
     * @default false
     */
    treatQueryParametersInSingleQuotesAsText?: boolean | Expression<boolean>;
    /** Choose from the list, or specify IDs using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
     * @loadOptionsMethod getColumnsMultiOptions
     * @displayOptions.show { /operation: ["select", "insert", "update", "upsert"] }
     * @default []
     */
    outputColumns?: string[];
    /** Output Large-Format Numbers As
     * @hint Applies to NUMERIC and BIGINT columns only
     * @default text
     */
    largeNumbersOutput?: 'numbers' | 'text' | Expression<string>;
    /** Whether to skip the row and do not throw error if a unique constraint or exclusion constraint is violated
     * @displayOptions.show { /operation: ["insert"] }
     * @default false
     */
    skipOnConflict?: boolean | Expression<boolean>;
    /** Whether to replace empty strings with NULL in input, could be useful when data come from spreadsheet
     * @displayOptions.show { /operation: ["insert", "update", "upsert", "executeQuery"] }
     * @default false
     */
    replaceEmptyStrings?: boolean | Expression<boolean>;
  };
/**
 * The SQL query to execute. You can use n8n expressions and $1, $2, $3, etc to refer to the 'Query Parameters' set in options below.
 * @hint Consider using query parameters to prevent SQL injection attacks. Add them in the options below
 * @displayOptions.show { resource: ["database"], operation: ["executeQuery"] }
 */
    query: string;
/**
 * Columns
 * @displayOptions.show { resource: ["database"], operation: ["insert"] }
 * @displayOptions.hide { table: [""] }
 * @default {"mappingMode":"defineBelow","value":null}
 */
    columns?: ResourceMapperValue;
/**
 * Whether to return all results or only up to a given limit
 * @displayOptions.show { resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default false
 */
    returnAll?: boolean | Expression<boolean>;
/**
 * Max number of results to return
 * @displayOptions.show { returnAll: [false], resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default 50
 */
    limit?: number | Expression<number>;
/**
 * Sort
 * @displayOptions.show { resource: ["database"], operation: ["select"] }
 * @displayOptions.hide { table: [""] }
 * @default {}
 */
    sort?: {
        /** Values
     */
    values?: Array<{
      /** Choose from the list, or specify an ID using an &lt;a href="https://docs.n8n.io/code/expressions/" target="_blank"&gt;expression&lt;/a&gt;
       * @loadOptionsMethod getColumns
       */
      column?: string | Expression<string>;
      /** Direction
       * @default ASC
       */
      direction?: 'ASC' | 'DESC' | Expression<string>;
    }>;
  };
}

export interface PostgresV27Credentials {
  postgres: CredentialReference;
}

interface PostgresV27NodeBase {
  type: 'n8n-nodes-base.postgres';
  version: 2.7;
}

export type PostgresV27ParamsNode = PostgresV27NodeBase & {
  config: NodeConfig<PostgresV27Params> & { credentials?: PostgresV27Credentials };
};

export type PostgresV27Node = PostgresV27ParamsNode;
```

---

## n8n-nodes-base.code (v2)

```typescript
/**
 * Code Node - Version 2
 * Discriminator: mode=runOnceForAllItems
 */


/** Run this code only once, no matter how many input items there are */
export type CodeV2RunOnceForAllItemsParams = {
  mode: 'runOnceForAllItems';
/**
 * Language
 * @default javaScript
 */
    language?: 'javaScript' | 'pythonNative';
/**
 * JavaScript code to execute.&lt;br&gt;&lt;br&gt;Tip: You can use luxon vars like &lt;code&gt;$today&lt;/code&gt; for dates and &lt;code&gt;$jmespath&lt;/code&gt; for querying JSON structures. &lt;a href="https://docs.n8n.io/nodes/n8n-nodes-base.function"&gt;Learn more&lt;/a&gt;.
 * @builderHint The sandbox has NO network access: fetch(), axios, XMLHttpRequest and require of http modules are unavailable and fail at runtime. NEVER make HTTP requests here — use the HTTP Request node and process its output in this node instead.
 * @displayOptions.show { language: ["javaScript"] }
 */
    jsCode?: string;
/**
 * Python code to execute.&lt;br&gt;&lt;br&gt;Tip: You can use built-in methods and variables like &lt;code&gt;_today&lt;/code&gt; for dates and &lt;code&gt;_jmespath&lt;/code&gt; for querying JSON structures. &lt;a href="https://docs.n8n.io/code/builtin/"&gt;Learn more&lt;/a&gt;.
 * @builderHint The sandbox has NO network access: requests, urllib, httpx and other HTTP libraries are unavailable and fail at runtime. NEVER make HTTP requests here — use the HTTP Request node and process its output in this node instead.
 * @displayOptions.show { language: ["python", "pythonNative"] }
 */
    pythonCode?: string;
};

export type CodeV2RunOnceForAllItemsNode = {
  type: 'n8n-nodes-base.code';
  version: 2;
  config: NodeConfig<CodeV2RunOnceForAllItemsParams>;
};
```

---

## n8n-nodes-base.code (v2)

```typescript
/**
 * Code Node - Version 2
 * Discriminator: mode=runOnceForEachItem
 */


/** Run this code as many times as there are input items */
export type CodeV2RunOnceForEachItemParams = {
  mode: 'runOnceForEachItem';
/**
 * Language
 * @default javaScript
 */
    language?: 'javaScript' | 'pythonNative';
/**
 * JavaScript code to execute.&lt;br&gt;&lt;br&gt;Tip: You can use luxon vars like &lt;code&gt;$today&lt;/code&gt; for dates and &lt;code&gt;$jmespath&lt;/code&gt; for querying JSON structures. &lt;a href="https://docs.n8n.io/nodes/n8n-nodes-base.function"&gt;Learn more&lt;/a&gt;.
 * @builderHint The sandbox has NO network access: fetch(), axios, XMLHttpRequest and require of http modules are unavailable and fail at runtime. NEVER make HTTP requests here — use the HTTP Request node and process its output in this node instead.
 * @displayOptions.show { language: ["javaScript"] }
 */
    jsCode?: string;
/**
 * Python code to execute.&lt;br&gt;&lt;br&gt;Tip: You can use built-in methods and variables like &lt;code&gt;_today&lt;/code&gt; for dates and &lt;code&gt;_jmespath&lt;/code&gt; for querying JSON structures. &lt;a href="https://docs.n8n.io/code/builtin/"&gt;Learn more&lt;/a&gt;.
 * @builderHint The sandbox has NO network access: requests, urllib, httpx and other HTTP libraries are unavailable and fail at runtime. NEVER make HTTP requests here — use the HTTP Request node and process its output in this node instead.
 * @displayOptions.show { language: ["python", "pythonNative"] }
 */
    pythonCode?: string;
};

export type CodeV2RunOnceForEachItemNode = {
  type: 'n8n-nodes-base.code';
  version: 2;
  config: NodeConfig<CodeV2RunOnceForEachItemParams>;
};
```

---

## n8n-nodes-base.executeWorkflow (v13)

```typescript
/**
 * Execute Sub-workflow Node - Version 1.3
 * Discriminator: mode=once
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

/** Pass all items into a single execution of the sub-workflow */
export type ExecuteWorkflowV13OnceParams = {
  mode: 'once';
/**
 * Where to get the workflow to execute from
 * @default database
 */
    source?: 'database' | 'parameter' | Expression<string>;
/**
 * Workflow
 * @displayOptions.show { source: ["database"] }
 */
    workflowId?: { __rl: true; mode: 'list' | 'id'; value: string | number; cachedResultName?: string; cachedResultUrl?: string } | Expression<string>;
/**
 * The path to local JSON workflow file to execute
 * @displayOptions.show { source: ["localFile"] }
 */
    workflowPath: string | Expression<string>;
/**
 * The workflow JSON code to execute
 * @displayOptions.show { source: ["parameter"] }
 */
    workflowJson?: IDataObject | string | Expression<string>;
/**
 * The URL from which to load the workflow from
 * @displayOptions.show { source: ["url"] }
 */
    workflowUrl: string | Expression<string>;
/**
 * Workflow Inputs
 * @displayOptions.show { source: ["database"] }
 * @displayOptions.hide { workflowId: [""] }
 * @default {"mappingMode":"defineBelow","value":null}
 */
    workflowInputs?: ResourceMapperValue;
  options?: {
    /** Whether the main workflow should wait for the sub-workflow to complete its execution before proceeding
     * @default true
     */
    waitForSubWorkflow?: boolean | Expression<boolean>;
  };
};

export type ExecuteWorkflowV13OnceNode = {
  type: 'n8n-nodes-base.executeWorkflow';
  version: 1.3;
  config: NodeConfig<ExecuteWorkflowV13OnceParams>;
};
```

---

## n8n-nodes-base.executeWorkflow (v13)

```typescript
/**
 * Execute Sub-workflow Node - Version 1.3
 * Discriminator: mode=each
 */


// Helper types for special n8n fields
type ResourceMapperField = { id?: string; displayName?: string; required?: boolean; defaultMatch?: boolean; display?: boolean; type?: string; canBeUsedToMatch?: boolean; [key: string]: unknown };
type ResourceMapperCommon = { matchingColumns?: string[]; cachedResultName?: string; [key: string]: unknown };
type ResourceMapperValue = ResourceMapperCommon & { mappingMode: string; value?: null | Record<string, unknown>; schema?: ResourceMapperField[] };

/** Call the sub-workflow individually for each item */
export type ExecuteWorkflowV13EachParams = {
  mode: 'each';
/**
 * Where to get the workflow to execute from
 * @default database
 */
    source?: 'database' | 'parameter' | Expression<string>;
/**
 * Workflow
 * @displayOptions.show { source: ["database"] }
 */
    workflowId?: { __rl: true; mode: 'list' | 'id'; value: string | number; cachedResultName?: string; cachedResultUrl?: string } | Expression<string>;
/**
 * The path to local JSON workflow file to execute
 * @displayOptions.show { source: ["localFile"] }
 */
    workflowPath: string | Expression<string>;
/**
 * The workflow JSON code to execute
 * @displayOptions.show { source: ["parameter"] }
 */
    workflowJson?: IDataObject | string | Expression<string>;
/**
 * The URL from which to load the workflow from
 * @displayOptions.show { source: ["url"] }
 */
    workflowUrl: string | Expression<string>;
/**
 * Workflow Inputs
 * @displayOptions.show { source: ["database"] }
 * @displayOptions.hide { workflowId: [""] }
 * @default {"mappingMode":"defineBelow","value":null}
 */
    workflowInputs?: ResourceMapperValue;
  options?: {
    /** Whether the main workflow should wait for the sub-workflow to complete its execution before proceeding
     * @default true
     */
    waitForSubWorkflow?: boolean | Expression<boolean>;
  };
};

export type ExecuteWorkflowV13EachNode = {
  type: 'n8n-nodes-base.executeWorkflow';
  version: 1.3;
  config: NodeConfig<ExecuteWorkflowV13EachParams>;
};
```

---

## n8n-nodes-base.executeWorkflowTrigger (v12)

```typescript
/**
 * Execute Workflow Trigger Node - Version 1.2
 * Helpers for calling other n8n workflows. Used for designing modular, microservice-like workflows.
 */


export interface ExecuteWorkflowTriggerV12Params {
  events?: unknown;
/**
 * Input data mode
 * @default workflowInputs
 */
    inputSource?: 'workflowInputs' | 'jsonExample' | 'passthrough';
/**
 * JSON Example
 * @displayOptions.show { inputSource: ["jsonExample"] }
 */
    jsonExample?: IDataObject | string;
/**
 * Define expected input fields. If no inputs are provided, all data from the calling workflow will be passed through.
 * @displayOptions.show { inputSource: ["workflowInputs"] }
 * @default {}
 */
    workflowInputs: {
        /** Values
     * @minItems 1
     */
    values: [{
      /** A unique name for this workflow input, used to reference it from another workflows
       */
      name?: string;
      /** Expected data type for this input value. Determines how this field's values are stored, validated, and displayed.
       * @default string
       */
      type?: 'any' | 'string' | 'number' | 'boolean' | 'array' | 'object';
    }, ...Array<{
      /** A unique name for this workflow input, used to reference it from another workflows
       */
      name?: string;
      /** Expected data type for this input value. Determines how this field's values are stored, validated, and displayed.
       * @default string
       */
      type?: 'any' | 'string' | 'number' | 'boolean' | 'array' | 'object';
    }>];
  };
}

interface ExecuteWorkflowTriggerV12NodeBase {
  type: 'n8n-nodes-base.executeWorkflowTrigger';
  version: 1.2;
  isTrigger: true;
}

export type ExecuteWorkflowTriggerV12ParamsNode = ExecuteWorkflowTriggerV12NodeBase & {
  config: NodeConfig<ExecuteWorkflowTriggerV12Params>;
};

export type ExecuteWorkflowTriggerV12Node = ExecuteWorkflowTriggerV12ParamsNode;
```

---

## n8n-nodes-base.scheduleTrigger (v13)

```typescript
/**
 * Schedule Trigger Node - Version 1.3
 * Triggers the workflow on a given schedule
 */


export interface ScheduleTriggerV13Params {
  rule?: {
        /** Trigger Interval
     * @builderHint You can add multiple intervals to trigger at different times. Use "Custom (Cron)" for more specific scheduling patterns.
     */
    interval?: Array<{
      /** Trigger Interval
       * @default days
       */
      field?: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'cronExpression' | Expression<string>;
      /** Number of seconds between each workflow trigger
       * @hint Must be in range 1-59
       * @displayOptions.show { field: ["seconds"] }
       * @default 30
       */
      secondsInterval?: number | Expression<number>;
      /** Number of minutes between each workflow trigger
       * @hint Must be in range 1-59
       * @displayOptions.show { field: ["minutes"] }
       * @default 5
       */
      minutesInterval?: number | Expression<number>;
      /** Number of hours between each workflow trigger
       * @hint Must be in range 1-23
       * @displayOptions.show { field: ["hours"] }
       * @default 1
       */
      hoursInterval?: number | Expression<number>;
      /** Number of days between each workflow trigger
       * @hint Must be in range 1-31
       * @displayOptions.show { field: ["days"] }
       * @default 1
       */
      daysInterval?: number | Expression<number>;
      /** Would run every week unless specified otherwise
       * @displayOptions.show { field: ["weeks"] }
       * @default 1
       */
      weeksInterval?: number | Expression<number>;
      /** Would run every month unless specified otherwise
       * @displayOptions.show { field: ["months"] }
       * @default 1
       */
      monthsInterval?: number | Expression<number>;
      /** The day of the month to trigger (1-31)
       * @hint If a month doesn’t have this day, the node won’t trigger
       * @displayOptions.show { field: ["months"] }
       * @default 1
       */
      triggerAtDayOfMonth?: number | Expression<number>;
      /** Trigger on Weekdays
       * @displayOptions.show { field: ["weeks"] }
       * @default [0]
       */
      triggerAtDay?: Array<1 | 2 | 3 | 4 | 5 | 6 | 0>;
      /** The hour of the day to trigger
       * @displayOptions.show { field: ["days", "weeks", "months"] }
       * @default 0
       */
      triggerAtHour?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | Expression<number>;
      /** The minute past the hour to trigger (0-59)
       * @displayOptions.show { field: ["hours", "days", "weeks", "months"] }
       * @default 0
       */
      triggerAtMinute?: number | Expression<number>;
      /** Expression
       * @hint Format: ([Second]) [Minute] [Hour] [Day of Month] [Month] [Day of Week]
       * @displayOptions.show { field: ["cronExpression"] }
       */
      expression?: string | Expression<string>;
    }>;
  };
/**
 * Whether to run this trigger through the legacy in-memory scheduler instead of the durable scheduler
 * @default false
 */
    skipDurableScheduler?: boolean | Expression<boolean>;
}

interface ScheduleTriggerV13NodeBase {
  type: 'n8n-nodes-base.scheduleTrigger';
  version: 1.3;
  isTrigger: true;
}

export type ScheduleTriggerV13ParamsNode = ScheduleTriggerV13NodeBase & {
  config: NodeConfig<ScheduleTriggerV13Params>;
};

export type ScheduleTriggerV13Node = ScheduleTriggerV13ParamsNode;
```

---

## n8n-nodes-base.if (v23)

```typescript
/**
 * If Node - Version 2.3
 * Route items to different branches (true/false)
 */


// Helper types for special n8n fields
type FilterOptionsValue = { caseSensitive?: boolean; leftValue?: string; typeValidation?: 'strict' | 'loose' };
type FilterConditionValue = { id?: string; leftValue: unknown; operator: { type: string; operation: string }; rightValue: unknown };
type FilterValue = { options: FilterOptionsValue; conditions: FilterConditionValue[]; combinator: 'and' | 'or' };

export interface IfV23Params {
/**
 * Conditions
 * @builderHint Must always contain these three sibling keys:
- combinator: 'and' or 'or', default to 'and'
- conditions: [ a list of condition objects ]
- options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 }
e.g.: { combinator: 'and', options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: expr('{{ $json.field }}'), rightValue: 'value', operator: { type: 'string', operation: 'equals' } }] }
 * @default {}
 */
    conditions?: FilterValue;
/**
 * If the type of an expression doesn't match the type of the comparison, n8n will try to cast the expression to the required type. E.g. for booleans &lt;code&gt;"false"&lt;/code&gt; or &lt;code&gt;0&lt;/code&gt; will be cast to &lt;code&gt;false&lt;/code&gt;
 * @default false
 */
    looseTypeValidation?: boolean | Expression<boolean>;
  options?: {
    /** Whether to ignore letter case when evaluating conditions
     * @default true
     */
    ignoreCase?: boolean | Expression<boolean>;
    /** If the type of an expression doesn't match the type of the comparison, n8n will try to cast the expression to the required type. E.g. for booleans &lt;code&gt;"false"&lt;/code&gt; or &lt;code&gt;0&lt;/code&gt; will be cast to &lt;code&gt;false&lt;/code&gt;
     * @default true
     */
    looseTypeValidation?: boolean | Expression<boolean>;
  };
}

interface IfV23NodeBase {
  type: 'n8n-nodes-base.if';
  version: 2.3;
}

export type IfV23ParamsNode = IfV23NodeBase & {
  config: NodeConfig<IfV23Params>;
};

export type IfV23Node = IfV23ParamsNode;
```

---

## n8n-nodes-base.set (v35)

```typescript
/**
 * Edit Fields (Set) Node - Version 3.5
 * Discriminator: mode=manual
 */


// Helper types for special n8n fields
/**
 * Assignment type determines how the value is interpreted.
 * - string: Direct string value or expression evaluating to string
 * - number: Direct number value or expression evaluating to number
 * - boolean: Direct boolean value or expression evaluating to boolean
 * - array: Expression that evaluates to an array, e.g. ={{ [1, 2, 3] }} or ={{ $json.items }}
 * - object: Expression that evaluates to a plain object (not an array — use the array type for arrays), e.g. ={{ { key: 'value' } }} or ={{ $json.data }}
 * - binary: Property name of binary data in the input item, or expression to access binary data from previous nodes, e.g. ={{ $('Node').item.binary.data }}
 */
type AssignmentType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'binary';
type AssignmentCollectionValue = { assignments: Array<{ id: string; name: string; value: unknown; type: AssignmentType }> };

/** Edit item fields one by one */
export type SetV35ManualParams = {
  mode: 'manual';
/**
 * Whether this item should be duplicated a set number of times
 * @default false
 */
    duplicateItem?: boolean | Expression<boolean>;
/**
 * How many times the item should be duplicated, mainly used for testing and debugging
 * @displayOptions.show { duplicateItem: [true] }
 * @default 0
 */
    duplicateCount?: number | Expression<number>;
/**
 * Fields to Set
 * @default {}
 */
    assignments?: AssignmentCollectionValue;
/**
 * Whether to pass to the output all the input fields (along with the fields set in 'Fields to Set')
 * @default false
 */
    includeOtherFields?: boolean | Expression<boolean>;
/**
 * How to select the fields you want to include in your output items
 * @displayOptions.hide { /includeOtherFields: [false] }
 * @default all
 */
    include?: 'all' | 'selected' | 'except' | Expression<string>;
/**
 * Comma-separated list of the field names you want to include in the output. You can drag the selected fields from the input panel.
 * @displayOptions.show { include: ["selected"], /includeOtherFields: [true] }
 */
    includeFields?: string | Expression<string>;
/**
 * Comma-separated list of the field names you want to exclude from the output. You can drag the selected fields from the input panel.
 * @displayOptions.show { include: ["except"], /includeOtherFields: [true] }
 */
    excludeFields?: string | Expression<string>;
  options?: {
    /** Whether binary data should be included if present in the input item
     * @default true
     */
    includeBinary?: boolean | Expression<boolean>;
    /** Whether binary data should be stripped from the input item. Only applies when "Include Other Input Fields" is enabled.
     * @displayOptions.show { /includeOtherFields: [true] }
     * @default true
     */
    stripBinary?: boolean | Expression<boolean>;
    /** Whether to ignore field type errors and apply a less strict type conversion
     * @default false
     */
    ignoreConversionErrors?: boolean | Expression<boolean>;
    /** By default, dot-notation is used in property names. This means that "a.b" will set the property "b" underneath "a" so { "a": { "b": value} }. If that is not intended this can be deactivated, it will then set { "a.b": value } instead.
     * @default true
     */
    dotNotation?: boolean | Expression<boolean>;
  };
};

export type SetV35ManualNode = {
  type: 'n8n-nodes-base.set';
  version: 3.5;
  config: NodeConfig<SetV35ManualParams>;
};
```

---

## n8n-nodes-base.set (v35)

```typescript
/**
 * Edit Fields (Set) Node - Version 3.5
 * Discriminator: mode=raw
 */


/** Customize item output with JSON */
export type SetV35RawParams = {
  mode: 'raw';
/**
 * Whether this item should be duplicated a set number of times
 * @default false
 */
    duplicateItem?: boolean | Expression<boolean>;
/**
 * How many times the item should be duplicated, mainly used for testing and debugging
 * @displayOptions.show { duplicateItem: [true] }
 * @default 0
 */
    duplicateCount?: number | Expression<number>;
/**
 * JSON
 */
    jsonOutput?: IDataObject | string | Expression<string>;
/**
 * Whether to pass to the output all the input fields (along with the fields set in 'Fields to Set')
 * @default false
 */
    includeOtherFields?: boolean | Expression<boolean>;
/**
 * How to select the fields you want to include in your output items
 * @displayOptions.hide { /includeOtherFields: [false] }
 * @default all
 */
    include?: 'all' | 'selected' | 'except' | Expression<string>;
/**
 * Comma-separated list of the field names you want to include in the output. You can drag the selected fields from the input panel.
 * @displayOptions.show { include: ["selected"], /includeOtherFields: [true] }
 */
    includeFields?: string | Expression<string>;
/**
 * Comma-separated list of the field names you want to exclude from the output. You can drag the selected fields from the input panel.
 * @displayOptions.show { include: ["except"], /includeOtherFields: [true] }
 */
    excludeFields?: string | Expression<string>;
  options?: {
    /** Whether binary data should be included if present in the input item
     * @default true
     */
    includeBinary?: boolean | Expression<boolean>;
    /** Whether binary data should be stripped from the input item. Only applies when "Include Other Input Fields" is enabled.
     * @displayOptions.show { /includeOtherFields: [true] }
     * @default true
     */
    stripBinary?: boolean | Expression<boolean>;
    /** Whether to ignore field type errors and apply a less strict type conversion
     * @displayOptions.show { /mode: ["manual"] }
     * @default false
     */
    ignoreConversionErrors?: boolean | Expression<boolean>;
    /** By default, dot-notation is used in property names. This means that "a.b" will set the property "b" underneath "a" so { "a": { "b": value} }. If that is not intended this can be deactivated, it will then set { "a.b": value } instead.
     * @default true
     */
    dotNotation?: boolean | Expression<boolean>;
  };
};

export type SetV35RawNode = {
  type: 'n8n-nodes-base.set';
  version: 3.5;
  config: NodeConfig<SetV35RawParams>;
};
```

---

## n8n-nodes-base.errorTrigger (v1)

```typescript
/**
 * Error Trigger Node - Version 1
 * Triggers the workflow when another workflow has an error
 */


export interface ErrorTriggerV1Params {
}

interface ErrorTriggerV1NodeBase {
  type: 'n8n-nodes-base.errorTrigger';
  version: 1;
  isTrigger: true;
}

export type ErrorTriggerV1ParamsNode = ErrorTriggerV1NodeBase & {
  config: NodeConfig<ErrorTriggerV1Params>;
};

export type ErrorTriggerV1Node = ErrorTriggerV1ParamsNode;
```

---

## n8n-nodes-base.wait (v11)

```typescript
/**
 * Wait Node - Version 1.1
 * Wait before continue with execution
 */


export interface WaitV11Params {
/**
 * Determines the waiting mode to use before the workflow continues
 * @builderHint For user approval workflows, consider using nodes with operation: "sendAndWait" (e.g., email, Slack) instead of Wait node. If using "webhook", the URL will be generated at runtime and can be referenced with {{ $execution.resumeUrl }}.
 * @default timeInterval
 */
    resume?: 'timeInterval' | 'specificTime' | 'webhook' | 'form' | Expression<string>;
/**
 * If and how incoming resume-webhook-requests to $execution.resumeFormUrl should be authenticated for additional security
 * @displayOptions.show { resume: ["form"] }
 * @default none
 */
    incomingAuthentication?: 'basicAuth' | 'none' | Expression<string>;
/**
 * The date and time to wait for before continuing
 * @displayOptions.show { resume: ["specificTime"] }
 */
    dateTime: string | Expression<string>;
/**
 * The time to wait
 * @displayOptions.show { resume: ["timeInterval"] }
 * @default 5
 */
    amount?: number | Expression<number>;
/**
 * The time unit of the Wait Amount value
 * @displayOptions.show { resume: ["timeInterval"] }
 * @default seconds
 */
    unit?: 'seconds' | 'minutes' | 'hours' | 'days' | Expression<string>;
/**
 * Shown at the top of the form
 * @displayOptions.show { resume: ["form"] }
 */
    formTitle: string | Expression<string>;
/**
 * Shown underneath the Form Title. Can be used to prompt the user on how to complete the form. Accepts HTML. Does not accept &lt;code&gt;&lt;script&gt;&lt;/code&gt;, &lt;code&gt;&lt;style&gt;&lt;/code&gt; or &lt;code&gt;&lt;input&gt;&lt;/code&gt; tags.
 * @displayOptions.show { resume: ["form"] }
 */
    formDescription?: string | Expression<string>;
/**
 * Form Elements
 * @displayOptions.show { resume: ["form"] }
 * @default {}
 */
    formFields?: {
        /** Values
     */
    values?: Array<{
      /** The name of the field, used in input attributes and referenced by the workflow
       * @displayOptions.hide { fieldType: ["html"] }
       */
      fieldName?: string | Expression<string>;
      /** Label that appears above the input field
       * @displayOptions.hide { fieldType: ["hiddenField", "html"] }
       */
      fieldLabel?: string | Expression<string>;
      /** Label that appears above the input field
       * @displayOptions.hide { fieldType: ["hiddenField", "html"] }
       */
      fieldLabel?: string | Expression<string>;
      /** The name of the field, used in input attributes and referenced by the workflow
       * @displayOptions.show { fieldType: ["hiddenField"] }
       */
      fieldName?: string | Expression<string>;
      /** The type of field to add to the form
       * @builderHint Valid values: text, number, email, textarea, dropdown, date, file, html, hiddenField, radio, checkbox, password. There is NO 'time' type — use fieldType: 'text' with placeholder 'e.g. 2:30 PM' for time-of-day inputs.
       * @default text
       */
      fieldType?: 'checkbox' | 'html' | 'date' | 'dropdown' | 'email' | 'file' | 'hiddenField' | 'number' | 'password' | 'radio' | 'text' | 'textarea' | Expression<string>;
      /** Optional field. It can be used to include the html in the output.
       * @displayOptions.show { fieldType: ["html"] }
       */
      elementName?: string | Expression<string>;
      /** The name of the field, used in input attributes and referenced by the workflow
       * @displayOptions.hide { fieldType: ["html"] }
       */
      fieldName?: string | Expression<string>;
      /** Sample text to display inside the field
       * @displayOptions.hide { fieldType: ["dropdown", "date", "file", "html", "hiddenField", "radio", "checkbox"] }
       */
      placeholder?: string | Expression<string>;
      /** Default value that will be pre-filled in the form field
       * @displayOptions.show { fieldType: ["text", "number", "email", "textarea"] }
       */
      defaultValue?: string | Expression<string>;
      /** Default date value that will be pre-filled in the form field (format: YYYY-MM-DD)
       * @displayOptions.show { fieldType: ["date"] }
       */
      defaultValue?: string | Expression<string>;
      /** Default value that will be pre-selected. Must match one of the option labels.
       * @displayOptions.show { fieldType: ["dropdown", "radio"] }
       */
      defaultValue?: string | Expression<string>;
      /** Default value(s) that will be pre-selected. Must match one or multiple of the option labels. Separate multiple pre-selected options with a comma.
       * @displayOptions.show { fieldType: ["checkbox"] }
       */
      defaultValue?: string | Expression<string>;
      /** Input value can be set here or will be passed as a query parameter via Field Name if no value is set
       * @displayOptions.show { fieldType: ["hiddenField"] }
       */
      fieldValue?: string | Expression<string>;
      /** List of options that can be selected from the dropdown
       * @displayOptions.show { fieldType: ["dropdown"] }
       * @default {"values":[{"option":""}]}
       */
      fieldOptions?: {
        /** Values
     */
    values?: Array<{
      /** Option
       */
      option?: string | Expression<string>;
    }>;
  };
      /** Checkboxes
       * @displayOptions.show { fieldType: ["checkbox"] }
       * @default {"values":[{"option":""}]}
       */
      fieldOptions?: {
        /** Values
     */
    values?: Array<{
      /** Checkbox Label
       */
      option?: string | Expression<string>;
    }>;
  };
      /** Radio Buttons
       * @displayOptions.show { fieldType: ["radio"] }
       * @default {"values":[{"option":""}]}
       */
      fieldOptions?: {
        /** Values
     */
    values?: Array<{
      /** Radio Button Label
       */
      option?: string | Expression<string>;
    }>;
  };
      /** Whether to allow the user to select multiple options from the dropdown list
       * @displayOptions.show { fieldType: ["dropdown"] }
       * @default false
       */
      multiselect?: boolean | Expression<boolean>;
      /** Limit Selection
       * @displayOptions.show { fieldType: ["checkbox"] }
       * @default unlimited
       */
      limitSelection?: 'exact' | 'range' | 'unlimited' | Expression<string>;
      /** Number of Selections
       * @displayOptions.show { fieldType: ["checkbox"], limitSelection: ["exact"] }
       * @default 1
       */
      numberOfSelections?: number | Expression<number>;
      /** Minimum Selections
       * @displayOptions.show { fieldType: ["checkbox"], limitSelection: ["range"] }
       * @default 0
       */
      minSelections?: number | Expression<number>;
      /** Maximum Selections
       * @displayOptions.show { fieldType: ["checkbox"], limitSelection: ["range"] }
       * @default 1
       */
      maxSelections?: number | Expression<number>;
      /** HTML elements to display on the form page
       * @hint Does not accept &lt;code&gt;&lt;script&gt;&lt;/code&gt;, &lt;code&gt;&lt;style&gt;&lt;/code&gt; or &lt;code&gt;&lt;input&gt;&lt;/code&gt; tags
       * @displayOptions.show { fieldType: ["html"] }
       */
      html?: string;
      /** Whether to allow the user to select multiple files from the file input or just one
       * @displayOptions.show { fieldType: ["file"] }
       * @default true
       */
      multipleFiles?: boolean | Expression<boolean>;
      /** Comma-separated list of allowed file extensions
       * @hint Leave empty to allow all file types
       * @displayOptions.show { fieldType: ["file"] }
       */
      acceptFileTypes?: string | Expression<string>;
      /** Whether to require the user to enter a value for this field before submitting the form
       * @displayOptions.hide { fieldType: ["html", "hiddenField"] }
       * @default false
       */
      requiredField?: boolean | Expression<boolean>;
    }>;
  };
/**
 * When to respond to the form submission
 * @displayOptions.show { resume: ["form"] }
 * @default onReceived
 */
    responseMode?: 'onReceived' | 'lastNode' | 'responseNode' | Expression<string>;
/**
 * The HTTP method of the Webhook call
 * @displayOptions.show { resume: ["webhook"] }
 * @default GET
 */
    httpMethod?: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT' | Expression<string>;
/**
 * The HTTP Response code to return
 * @displayOptions.show { resume: ["webhook"] }
 * @displayOptions.hide { responseMode: ["responseNode"] }
 * @default 200
 */
    responseCode?: number | Expression<number>;
/**
 * What data should be returned. If it should return all items as an array or only the first item as object.
 * @displayOptions.show { responseMode: ["lastNode"], resume: ["webhook"] }
 * @default firstEntryJson
 */
    responseData?: 'allEntries' | 'firstEntryJson' | 'firstEntryBinary' | 'noData' | Expression<string>;
/**
 * Name of the binary property to return
 * @displayOptions.show { responseData: ["firstEntryBinary"], resume: ["webhook"] }
 * @default data
 */
    responseBinaryPropertyName?: string | Expression<string>;
/**
 * Whether to limit the time this node should wait for a user response before execution resumes
 * @displayOptions.show { resume: ["webhook", "form"] }
 * @default false
 */
    limitWaitTime?: boolean | Expression<boolean>;
/**
 * Sets the condition for the execution to resume. Can be a specified date or after some time.
 * @displayOptions.show { limitWaitTime: [true], resume: ["webhook", "form"] }
 * @default afterTimeInterval
 */
    limitType?: 'afterTimeInterval' | 'atSpecifiedTime' | Expression<string>;
/**
 * The time to wait
 * @displayOptions.show { limitType: ["afterTimeInterval"], limitWaitTime: [true], resume: ["webhook", "form"] }
 * @default 1
 */
    resumeAmount?: number | Expression<number>;
/**
 * Unit of the interval value
 * @displayOptions.show { limitType: ["afterTimeInterval"], limitWaitTime: [true], resume: ["webhook", "form"] }
 * @default hours
 */
    resumeUnit?: 'seconds' | 'minutes' | 'hours' | 'days' | Expression<string>;
/**
 * Continue execution after the specified date and time
 * @displayOptions.show { limitType: ["atSpecifiedTime"], limitWaitTime: [true], resume: ["webhook", "form"] }
 */
    maxDateAndTime?: string | Expression<string>;
/**
 * Options
 * @displayOptions.show { resume: ["webhook"] }
 * @default {}
 */
    options?: {
    /** Whether the webhook will receive binary data
     * @displayOptions.show { /httpMethod: ["PATCH", "PUT", "POST"] }
     * @default false
     */
    binaryData?: boolean | Expression<boolean>;
    /** If the data gets received via "Form-Data Multipart" it will be the prefix and a number starting with 0 will be attached to it
     * @hint The name of the output binary field to put the file in
     * @displayOptions.show { binaryData: [true] }
     * @default data
     */
    binaryPropertyName?: string | Expression<string>;
    /** The name of the output field to put any binary file data in. Only relevant if binary data is received.
     * @default data
     */
    binaryPropertyName?: string | Expression<string>;
    /** Whether to ignore requests from bots like link previewers and web crawlers
     * @default false
     */
    ignoreBots?: boolean | Expression<boolean>;
    /** Expression evaluated against the incoming request. The workflow will run only if the expression returns true. &lt;code&gt;$json&lt;/code&gt; exposes the request as &lt;code&gt;{ body, headers, params, query }&lt;/code&gt;. Requests that do not match receive a 200 response, without creating an execution. If the expression fails to evaluate, the request is allowed through and the error is logged.
     */
    onlyRunIf?: string | Expression<string>;
    /** Comma-separated list of allowed IP addresses or CIDR ranges. Leave empty to allow all IPs.
     */
    ipWhitelist?: string | Expression<string>;
    /** Whether to send any body in the response
     * @displayOptions.show { /responseMode: ["onReceived"] }
     * @displayOptions.hide { rawBody: [true] }
     * @default false
     */
    noResponseBody?: boolean | Expression<boolean>;
    /** Raw body (binary)
     * @displayOptions.hide { binaryData: [true], noResponseBody: [true] }
     * @default false
     */
    rawBody?: boolean | Expression<boolean>;
    /** Whether to return the raw body
     * @displayOptions.hide { noResponseBody: [true] }
     * @default false
     */
    rawBody?: boolean | Expression<boolean>;
    /** Custom response data to send
     * @displayOptions.show { /responseMode: ["onReceived"] }
     * @displayOptions.hide { noResponseBody: [true] }
     */
    responseData?: string | Expression<string>;
    /** Set a custom content-type to return if another one as the "application/json" should be returned
     * @displayOptions.show { /responseData: ["firstEntryJson"], /responseMode: ["lastNode"] }
     */
    responseContentType?: string | Expression<string>;
    /** Add headers to the webhook response
     * @default {}
     */
    responseHeaders?: {
        /** Entries
     */
    entries?: Array<{
      /** Name of the header
       */
      name?: string | Expression<string>;
      /** Value of the header
       */
      value?: string | Expression<string>;
    }>;
  };
    /** Name of the property to return the data of instead of the whole JSON
     * @displayOptions.show { /responseData: ["firstEntryJson"], /responseMode: ["lastNode"] }
     * @default data
     */
    responsePropertyName?: string | Expression<string>;
    /** This suffix path will be appended to the restart URL. Helpful when using multiple wait nodes.
     */
    webhookSuffix?: string;
    /** Whether to include the link “Form automated with n8n” at the bottom of the form
     * @default true
     */
    appendAttribution?: boolean | Expression<boolean>;
    /** Form Response
     * @default {"values":{"respondWith":"text"}}
     */
    respondWithOptions?: {
        /** Values
     */
    values?: {
      /** Respond With
       * @default text
       */
      respondWith?: 'text' | 'redirect' | Expression<string>;
      /** The text displayed to users after they fill the form. Leave it empty if don't want to show any additional text.
       * @displayOptions.show { respondWith: ["text"] }
       * @default Your response has been recorded
       */
      formSubmittedText?: string | Expression<string>;
      /** The URL to redirect users to after they fill the form. Must be a valid URL.
       * @displayOptions.show { respondWith: ["redirect"] }
       */
      redirectUrl?: string | Expression<string>;
    };
  };
  };
}

export interface WaitV11Credentials {
  httpBasicAuth: CredentialReference;
  httpHeaderAuth: CredentialReference;
  jwtAuth: CredentialReference;
}

interface WaitV11NodeBase {
  type: 'n8n-nodes-base.wait';
  version: 1.1;
}

export type WaitV11ParamsNode = WaitV11NodeBase & {
  config: NodeConfig<WaitV11Params> & { credentials?: WaitV11Credentials };
};

export type WaitV11Node = WaitV11ParamsNode;
```
