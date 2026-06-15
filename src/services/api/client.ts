import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import type { GoogleAuth } from 'google-auth-library'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKey,
  getApiKeyFromApiKeyHelper,
  getClaudeAIOAuthTokens,
  isClaudeAISubscriber,
  refreshAndGetAwsCredentials,
  refreshGcpCredentialsIfNeeded,
} from 'src/utils/auth.js'
import { getUserAgent } from 'src/utils/http.js'
import { getSmallFastModel } from 'src/utils/model/model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { isDebugToStdErr, logForDebugging } from '../../utils/debug.js'
import {
  getAWSRegion,
  getVertexRegionForModel,
  isEnvTruthy,
} from '../../utils/envUtils.js'

/**
 * Environment variables for different client types:
 *
 * Direct API:
 * - ANTHROPIC_API_KEY: Required for direct API access
 *
 * AWS Bedrock:
 * - AWS credentials configured via aws-sdk defaults
 * - AWS_REGION or AWS_DEFAULT_REGION: Sets the AWS region for all models (default: us-east-1)
 * - ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: Optional. Override AWS region specifically for the small fast model (Haiku)
 *
 * Foundry (Azure):
 * - ANTHROPIC_FOUNDRY_RESOURCE: Your Azure resource name (e.g., 'my-resource')
 *   For the full endpoint: https://{resource}.services.ai.azure.com/anthropic/v1/messages
 * - ANTHROPIC_FOUNDRY_BASE_URL: Optional. Alternative to resource - provide full base URL directly
 *   (e.g., 'https://my-resource.services.ai.azure.com')
 *
 * Authentication (one of the following):
 * - ANTHROPIC_FOUNDRY_API_KEY: Your Microsoft Foundry API key (if using API key auth)
 * - Azure AD authentication: If no API key is provided, uses DefaultAzureCredential
 *   which supports multiple auth methods (environment variables, managed identity,
 *   Azure CLI, etc.). See: https://docs.microsoft.com/en-us/javascript/api/@azure/identity
 *
 * Vertex AI:
 * - Model-specific region variables (highest priority):
 *   - VERTEX_REGION_CLAUDE_3_5_HAIKU: Region for Claude 3.5 Haiku model
 *   - VERTEX_REGION_CLAUDE_HAIKU_4_5: Region for Claude Haiku 4.5 model
 *   - VERTEX_REGION_CLAUDE_3_5_SONNET: Region for Claude 3.5 Sonnet model
 *   - VERTEX_REGION_CLAUDE_3_7_SONNET: Region for Claude 3.7 Sonnet model
 * - CLOUD_ML_REGION: Optional. The default GCP region to use for all models
 *   If specific model region not specified above
 * - ANTHROPIC_VERTEX_PROJECT_ID: Required. Your GCP project ID
 * - Standard GCP credentials configured via google-auth-library
 *
 * Priority for determining region:
 * 1. Hardcoded model-specific environment variables
 * 2. Global CLOUD_ML_REGION variable
 * 3. Default region from config
 * 4. Fallback region (us-east5)
 */

function createStderrLogger(): ClientOptions['logger'] {
  return {
    error: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[Anthropic SDK ERROR]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    warn: (msg, ...args) => console.error('[Anthropic SDK WARN]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    info: (msg, ...args) => console.error('[Anthropic SDK INFO]', msg, ...args),
    debug: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[Anthropic SDK DEBUG]', msg, ...args),
  }
}

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}): Promise<Anthropic> {
  const containerId = process.env.CLAUDE_CODE_CONTAINER_ID
  const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
  const customHeaders = getCustomHeaders()
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
    ...customHeaders,
    ...(containerId ? { 'x-claude-remote-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-claude-remote-session-id': remoteSessionId }
      : {}),
    // SDK consumers can identify their app/library for backend analytics
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
  }

  // Log API client configuration for HFI debugging
  logForDebugging(
    `[API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: ${!!process.env.ANTHROPIC_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders['Authorization']}`,
  )

  // Add additional protection header if enabled via env var
  const additionalProtectionEnabled = isEnvTruthy(
    process.env.CLAUDE_CODE_ADDITIONAL_PROTECTION,
  )
  if (additionalProtectionEnabled) {
    defaultHeaders['x-anthropic-additional-protection'] = 'true'
  }

  logForDebugging('[API:auth] OAuth token check starting')
  await checkAndRefreshOAuthTokenIfNeeded()
  logForDebugging('[API:auth] OAuth token check complete')

  if (!isClaudeAISubscriber()) {
    await configureApiKeyHeaders(defaultHeaders, getIsNonInteractiveSession())
  }

  const resolvedFetch = buildFetch(fetchOverride, source)

  const ARGS = {
    defaultHeaders,
    maxRetries,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    fetchOptions: getProxyFetchOptions({
      forAnthropicAPI: true,
    }) as ClientOptions['fetchOptions'],
    ...(resolvedFetch && {
      fetch: resolvedFetch,
    }),
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) {
    const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
    // Use region override for small fast model if specified
    const awsRegion =
      model === getSmallFastModel() &&
      process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
        ? process.env.ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION
        : getAWSRegion()

    const bedrockArgs: ConstructorParameters<typeof AnthropicBedrock>[0] = {
      ...ARGS,
      awsRegion,
      ...(isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH) && {
        skipAuth: true,
      }),
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }

    // Add API key authentication if available
    if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
      bedrockArgs.skipAuth = true
      // Add the Bearer token for Bedrock API key authentication
      bedrockArgs.defaultHeaders = {
        ...bedrockArgs.defaultHeaders,
        Authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
      }
    } else if (!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) {
      // Refresh auth and get credentials with cache clearing
      const cachedCredentials = await refreshAndGetAwsCredentials()
      if (cachedCredentials) {
        bedrockArgs.awsAccessKey = cachedCredentials.accessKeyId
        bedrockArgs.awsSecretKey = cachedCredentials.secretAccessKey
        bedrockArgs.awsSessionToken = cachedCredentials.sessionToken
      }
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicBedrock(bedrockArgs) as unknown as Anthropic
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)) {
    const { AnthropicFoundry } = await import('@anthropic-ai/foundry-sdk')
    // Determine Azure AD token provider based on configuration
    // SDK reads ANTHROPIC_FOUNDRY_API_KEY by default
    let azureADTokenProvider: (() => Promise<string>) | undefined
    if (!process.env.ANTHROPIC_FOUNDRY_API_KEY) {
      if (isEnvTruthy(process.env.CLAUDE_CODE_SKIP_FOUNDRY_AUTH)) {
        // Mock token provider for testing/proxy scenarios (similar to Vertex mock GoogleAuth)
        azureADTokenProvider = () => Promise.resolve('')
      } else {
        // Use real Azure AD authentication with DefaultAzureCredential
        const {
          DefaultAzureCredential: AzureCredential,
          getBearerTokenProvider,
        } = await import('@azure/identity')
        azureADTokenProvider = getBearerTokenProvider(
          new AzureCredential(),
          'https://cognitiveservices.azure.com/.default',
        )
      }
    }

    const foundryArgs: ConstructorParameters<typeof AnthropicFoundry>[0] = {
      ...ARGS,
      ...(azureADTokenProvider && { azureADTokenProvider }),
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicFoundry(foundryArgs) as unknown as Anthropic
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)) {
    // Refresh GCP credentials if gcpAuthRefresh is configured and credentials are expired
    // This is similar to how we handle AWS credential refresh for Bedrock
    if (!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) {
      await refreshGcpCredentialsIfNeeded()
    }

    const [{ AnthropicVertex }, { GoogleAuth }] = await Promise.all([
      import('@anthropic-ai/vertex-sdk'),
      import('google-auth-library'),
    ])
    // TODO: Cache either GoogleAuth instance or AuthClient to improve performance
    // Currently we create a new GoogleAuth instance for every getAnthropicClient() call
    // This could cause repeated authentication flows and metadata server checks
    // However, caching needs careful handling of:
    // - Credential refresh/expiration
    // - Environment variable changes (GOOGLE_APPLICATION_CREDENTIALS, project vars)
    // - Cross-request auth state management
    // See: https://github.com/googleapis/google-auth-library-nodejs/issues/390 for caching challenges

    // Prevent metadata server timeout by providing projectId as fallback
    // google-auth-library checks project ID in this order:
    // 1. Environment variables (GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT, etc.)
    // 2. Credential files (service account JSON, ADC file)
    // 3. gcloud config
    // 4. GCE metadata server (causes 12s timeout outside GCP)
    //
    // We only set projectId if user hasn't configured other discovery methods
    // to avoid interfering with their existing auth setup

    // Check project environment variables in same order as google-auth-library
    // See: https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/googleauth.ts
    const hasProjectEnvVar =
      process.env['GCLOUD_PROJECT'] ||
      process.env['GOOGLE_CLOUD_PROJECT'] ||
      process.env['gcloud_project'] ||
      process.env['google_cloud_project']

    // Check for credential file paths (service account or ADC)
    // Note: We're checking both standard and lowercase variants to be safe,
    // though we should verify what google-auth-library actually checks
    const hasKeyFile =
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] ||
      process.env['google_application_credentials']

    const googleAuth = isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)
      ? ({
          // Mock GoogleAuth for testing/proxy scenarios
          getClient: () => ({
            getRequestHeaders: () => ({}),
          }),
        } as unknown as GoogleAuth)
      : new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
          // Only use ANTHROPIC_VERTEX_PROJECT_ID as last resort fallback
          // This prevents the 12-second metadata server timeout when:
          // - No project env vars are set AND
          // - No credential keyfile is specified AND
          // - ADC file exists but lacks project_id field
          //
          // Risk: If auth project != API target project, this could cause billing/audit issues
          // Mitigation: Users can set GOOGLE_CLOUD_PROJECT to override
          ...(hasProjectEnvVar || hasKeyFile
            ? {}
            : {
                projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
              }),
        })

    const vertexArgs: ConstructorParameters<typeof AnthropicVertex>[0] = {
      ...ARGS,
      region: getVertexRegionForModel(model),
      googleAuth,
      ...(isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicVertex(vertexArgs) as unknown as Anthropic
  }

  // Determine authentication method based on available tokens
  // ── Provider routing ──────────────────────────────────────────────
  // When ANTHROPIC_BASE_URL points to a non-Anthropic provider, we
  // bypass the Anthropic SDK entirely and use a generic HTTP client
  // that speaks the same interface.
  const baseURL = process.env.ANTHROPIC_BASE_URL
  if (baseURL && !isFirstPartyAnthropicBaseUrl()) {
    return createGenericProviderClient({
      baseURL,
      apiKey: (apiKey || getAnthropicApiKey()) ?? undefined,
      model,
      source,
      ...ARGS,
    }) as unknown as Anthropic
  }

  const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey: isClaudeAISubscriber() ? null : apiKey || getAnthropicApiKey(),
    authToken: isClaudeAISubscriber()
      ? getClaudeAIOAuthTokens()?.accessToken
      : undefined,
    // Set baseURL from OAuth config when using staging OAuth
    ...(process.env.USER_TYPE === 'ant' &&
    isEnvTruthy(process.env.USE_STAGING_OAUTH)
      ? { baseURL: getOauthConfig().BASE_API_URL }
      : {}),
    ...ARGS,
    ...(isDebugToStdErr() && { logger: createStderrLogger() }),
  }

  return new Anthropic(clientConfig)
}

// ── Generic Provider Client (for non-Anthropic backends) ──────────────

type GenericClientConfig = {
  baseURL: string
  apiKey: string | undefined
  model: string | undefined
  source: string | undefined
  defaultHeaders: Record<string, string>
  maxRetries: number
  timeout: number
  fetchOptions?: Record<string, unknown>
}

/**
 * Creates a drop-in replacement for the Anthropic SDK client that routes
 * requests to any OpenAI-compatible API endpoint (OpenAI, DeepSeek,
 * OpenRouter, local models, etc.).
 *
 * The returned object has the same shape as the Anthropic SDK client
 * ({ beta: { messages: { create } } }) so the rest of the codebase
 * works without modification.
 */
function createGenericProviderClient(config: GenericClientConfig): unknown {
  const { baseURL, apiKey, defaultHeaders, timeout } = config

  // Normalize base URL: strip trailing slash, ensure /v1 prefix is handled
  const normalizedBase = baseURL.replace(/\/+$/, '')

  // Detect if this is an OpenAI-style endpoint (has /v1 in path) or
  // an Anthropic-style proxy (expects /v1/messages appended by SDK).
  // OpenAI endpoints: https://api.openai.com/v1
  // DeepSeek Anthropic proxy: https://api.deepseek.com/anthropic
  const isAnthropicProxy = normalizedBase.includes('/anthropic') ||
    normalizedBase.includes('/claude')

  const apiPath = isAnthropicProxy
    ? `${normalizedBase}/v1/messages`
    : `${normalizedBase}/chat/completions`

  // For Anthropic-compatible proxies, the auth header is 'x-api-key'
  // For native OpenAI endpoints, it's 'Authorization: Bearer ...'
  const authHeader = isAnthropicProxy
    ? { 'x-api-key': apiKey || '' }
    : { 'Authorization': `Bearer ${apiKey || ''}` }

  // Filter out Anthropic-specific headers for non-Anthropic providers
  const cleanHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(defaultHeaders)) {
    // Skip Anthropic-specific headers that other providers reject
    if (
      key.startsWith('x-claude-') ||
      key === 'x-app' ||
      key.startsWith('x-anthropic-')
    ) {
      continue
    }
    cleanHeaders[key] = value
  }

  // ── Message format conversion: Anthropic ↔ OpenAI ────────────
  function convertMessagesToOpenAI(
    messages: Array<{ role: string; content: unknown }>,
    systemBlocks?: Array<{ text: string; cache_control?: unknown }>,
  ): Array<{ role: string; content: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown[] }> {
    const openaiMessages: Array<{ role: string; content: unknown; tool_call_id?: string; name?: string; tool_calls?: unknown[] }> = []

    // System prompt as first message
    if (systemBlocks && systemBlocks.length > 0) {
      const systemText = systemBlocks.map(s => s.text).join('\n\n')
      openaiMessages.push({ role: 'system', content: systemText })
    }

    for (const msg of messages) {
      const role = msg.role as string

      if (typeof msg.content === 'string') {
        openaiMessages.push({ role, content: msg.content })
        continue
      }

      if (!Array.isArray(msg.content)) {
        openaiMessages.push({ role, content: String(msg.content) })
        continue
      }

      const textParts: string[] = []
      const toolCallsForMsg: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }> = []
      const toolResults: Array<{ tool_call_id: string; content: string }> = []
      let imageBlocks: Array<Record<string, unknown>> | null = null

      for (const block of msg.content as Array<Record<string, unknown>>) {
        switch (block.type) {
          case 'text':
            textParts.push(block.text as string)
            break
          case 'tool_use':
            toolCallsForMsg.push({
              id: block.id as string,
              type: 'function',
              function: {
                name: block.name as string,
                arguments: typeof block.input === 'string'
                  ? block.input as string
                  : JSON.stringify(block.input ?? {}),
              },
            })
            break
          case 'tool_result':
            toolResults.push({
              tool_call_id: block.tool_use_id as string,
              content: typeof block.content === 'string'
                ? block.content as string
                : JSON.stringify(block.content),
            })
            break
          case 'thinking':
          case 'redacted_thinking':
            break
          case 'image':
            if (!imageBlocks) imageBlocks = []
            imageBlocks.push({
              type: 'image_url',
              image_url: {
                url: `data:${(block.source as Record<string, string>)?.media_type};base64,${(block.source as Record<string, string>)?.data}`,
              },
            })
            break
        }
      }

      if (toolCallsForMsg.length > 0) {
        openaiMessages.push({
          role: 'assistant',
          content: textParts.length ? textParts.join('\n') : null,
          tool_calls: toolCallsForMsg,
        })
      } else if (imageBlocks?.length) {
        const parts: Array<Record<string, unknown>> = []
        if (textParts.length) parts.push({ type: 'text', text: textParts.join('\n') })
        parts.push(...imageBlocks)
        openaiMessages.push({ role, content: parts })
      } else if (textParts.length) {
        openaiMessages.push({ role, content: textParts.join('\n') })
      }

      for (const tr of toolResults) {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: tr.tool_call_id,
          content: tr.content,
        })
      }
    }

    return openaiMessages
  }

  // ── Tool schema conversion: Anthropic → OpenAI ──────────────
  function convertToolsToOpenAI(
    tools: Array<Record<string, unknown>> | undefined,
  ): Array<Record<string, unknown>> | undefined {
    if (!tools || tools.length === 0) return undefined
    return tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
        ...(t.strict !== undefined ? {} : {}), // OpenAI doesn't have strict mode
      },
    }))
  }

  // ── SSE stream parser → Anthropic-like events ──────────────
  //
  // Translates OpenAI SSE streaming protocol to Anthropic's stream
  // event protocol. The core code in claude.ts expects these events:
  //
  //   message_start
  //   content_block_start (index=N, type: text|tool_use)
  //   content_block_delta  (index=N, type: text_delta|input_json_delta)
  //   content_block_stop   (index=N)  ← one per block
  //   message_delta (usage, stop_reason)
  //   message_stop
  //
  // Tool_use blocks MUST have input: '' initially (not {}). The core
  // code treats it as a string and appends input_json_delta.partial_json.
  async function* parseOpenAIStream(
    response: Response,
  ): AsyncGenerator<Record<string, unknown>> {
    if (!response.body) {
      throw new Error('Response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const messageId = crypto.randomUUID?.() ?? `msg_${Date.now()}`
    let model = ''
    let blockIndex = 0
    let inputTokens = 0
    let outputTokens = 0
    let hasStartedMessage = false

    // Track the currently-open content block so we can emit
    // content_block_stop when the block type changes.
    type OpenBlock = { type: 'text'; index: number } | { type: 'tool_use'; index: number; id: string; name: string }
    let openBlock: OpenBlock | null = null

    // Accumulated tool call state by OpenAI tool call index.
    // OpenAI streams tool call fields incrementally across SSE chunks.
    type PendingToolCall = { id?: string; name?: string; arguments: string }
    const pendingToolCalls = new Map<number, PendingToolCall>()

    function flushBlock(): void {
      if (openBlock) {
        // Emit content_block_stop for the completed block
        // (the core code yields a message from this)
        // Must call this BEFORE advancing, not after
      }
    }

    function emitBlockStop(idx: number): Record<string, unknown> {
      return { type: 'content_block_stop', index: idx }
    }

    function emitBlockStart(block: OpenBlock): Record<string, unknown> {
      if (block.type === 'tool_use') {
        return {
          type: 'content_block_start',
          index: block.index,
          content_block: {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: '',  // ← string, not {} — core code appends partial_json
          },
        }
      }
      return {
        type: 'content_block_start',
        index: block.index,
        content_block: {
          type: 'text',
          text: '',
        },
      }
    }

    function emitMessageStop(stopReason: string | null): Array<Record<string, unknown>> {
      const events: Array<Record<string, unknown>> = []

      // Close any open block first
      if (openBlock) {
        events.push(emitBlockStop(openBlock.index))
        openBlock = null
      }

      // Emit message_delta with usage + stop_reason
      events.push({
        type: 'message_delta',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
        delta: {
          stop_reason: stopReason,
        },
      })

      // Emit message_stop
      events.push({
        type: 'message_stop',
        stop_reason: stopReason,
      })

      return events
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue  // redundant if finish_reason already sent

          try {
            const parsed = JSON.parse(data)
            const choice = parsed.choices?.[0]
            if (!choice) continue

            model = parsed.model || model

            if (parsed.usage) {
              inputTokens = parsed.usage.prompt_tokens || 0
              outputTokens = parsed.usage.completion_tokens || 0
            }

            const delta = choice.delta || {}

            // ── message_start (once) ──
            if (!hasStartedMessage) {
              hasStartedMessage = true
              yield {
                type: 'message_start',
                message: {
                  id: messageId,
                  model,
                  role: 'assistant',
                  usage: {
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                  },
                },
              }
            }

            // ── Tool calls (process before text — finish_reason='tool_calls'
            //    often arrives in the same chunk as the last tool delta) ──
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const oaiIdx = tc.index ?? 0
                let pending = pendingToolCalls.get(oaiIdx)
                if (!pending) {
                  pending = { id: undefined, name: undefined, arguments: '' }
                  pendingToolCalls.set(oaiIdx, pending)
                }

                // Tool call ID (first appearance or update)
                if (tc.id) pending.id = tc.id

                // Tool name — when name appears, the tool_use block starts
                if (tc.function?.name && pending.name === undefined) {
                  pending.name = tc.function.name

                  // Flush previous block if any
                  if (openBlock) {
                    yield emitBlockStop(openBlock.index)
                  }

                  // Start new tool_use block
                  openBlock = {
                    type: 'tool_use',
                    index: blockIndex,
                    id: pending.id ?? `toolu_${Date.now()}`,
                    name: pending.name,
                  }
                  yield emitBlockStart(openBlock)
                }

                // Tool arguments — stream as partial JSON
                if (tc.function?.arguments) {
                  // Ensure the block is open (name might arrive in same chunk as first args)
                  if (!openBlock || openBlock.type !== 'tool_use') {
                    // Flush any text block first
                    if (openBlock) {
                      yield emitBlockStop(openBlock.index)
                    }
                    openBlock = {
                      type: 'tool_use',
                      index: blockIndex,
                      id: pending.id ?? `toolu_${Date.now()}`,
                      name: pending.name ?? '',
                    }
                    yield emitBlockStart(openBlock)
                  }
                  yield {
                    type: 'content_block_delta',
                    index: openBlock.index,
                    delta: {
                      type: 'input_json_delta',
                      partial_json: tc.function.arguments,
                    },
                  }
                }
              }
            }

            // ── Text content ──
            if (delta.content) {
              // If currently in a tool_use block, close it first
              if (openBlock?.type === 'tool_use') {
                yield emitBlockStop(openBlock.index)
                openBlock = null
                blockIndex++
              }

              if (!openBlock || openBlock.type !== 'text') {
                // Close any previous block (shouldn't happen but be safe)
                if (openBlock) {
                  yield emitBlockStop(openBlock.index)
                  blockIndex++
                }
                // Start a new text block
                openBlock = { type: 'text', index: blockIndex }
                yield emitBlockStart(openBlock)
              }

              yield {
                type: 'content_block_delta',
                index: openBlock.index,
                delta: {
                  type: 'text_delta',
                  text: delta.content,
                },
              }
            }

            // ── Finish reason → wrap up ──
            if (choice.finish_reason) {
              const stopReasonMap: Record<string, string> = {
                'stop': 'end_turn',
                'length': 'max_tokens',
                'tool_calls': 'tool_use',
                'content_filter': 'refusal',
              }
              const stopReason = stopReasonMap[choice.finish_reason] || choice.finish_reason

              const events = emitMessageStop(stopReason)
              for (const ev of events) yield ev
            }
          } catch {
            // Skip malformed SSE lines
            continue
          }
        }
      }
    } finally {
      // If the stream ended without finish_reason, force cleanup
      if (openBlock) {
        // We can't yield in finally, but emitMessageStop would have been
        // called if finish_reason was received. Fall through gracefully.
      }
      reader.releaseLock()
    }
  }

  async function* parseAnthropicNativeStream(
    response: Response,
  ): AsyncGenerator<Record<string, unknown>> {
    if (!response.body) throw new Error('Response body is null')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            yield JSON.parse(payload) as Record<string, unknown>
          } catch {
            continue
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  function buildAnthropicRequestBody(params: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      max_tokens: params.max_tokens || 4096,
      stream: params.stream === true,
    }
    if (params.system) body.system = params.system
    if (params.tools) body.tools = params.tools
    if (params.tool_choice) body.tool_choice = params.tool_choice
    if (params.temperature != null) body.temperature = params.temperature
    if (params.thinking) body.thinking = params.thinking
    if (params.metadata) body.metadata = params.metadata
    return body
  }

  function wrapStreamingResponse(
    response: Response,
    stream: AsyncGenerator<Record<string, unknown>>,
  ) {
    return {
      [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
      controller: {},
      withResponse: async () => {
        const firstChunk = await stream.next()
        return {
          data: (async function* () {
            if (!firstChunk.done) yield firstChunk.value
            yield* stream
          })(),
          request_id: response.headers.get('request-id') || `req_${Date.now()}`,
          response,
        }
      },
    }
  }

  function throwProviderError(status: number, message: string, headers: Headers) {
    const err = new Error(message) as Error & { status: number; headers: Headers; name: string }
    err.status = status
    err.headers = headers
    err.name = 'APIError'
    throw err
  }

  // ── The fake Anthropic client ──────────────────────────────────
  async function executeGenericMessageCreate(
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeout?: number; headers?: Record<string, string> },
  ) {
      const isStreaming = params.stream === true
      const systemBlocks = params.system as Array<{ text: string }> | undefined

      let requestBody: Record<string, unknown>
      if (isAnthropicProxy) {
        requestBody = buildAnthropicRequestBody(params)
      } else {
      const openaiBody: Record<string, unknown> = {
        model: params.model,
        messages: convertMessagesToOpenAI(
          params.messages as Array<{ role: string; content: unknown }>,
          systemBlocks,
        ),
        max_tokens: params.max_tokens || 4096,
        temperature: params.temperature ?? 1,
        stream: isStreaming,
      }

      // Convert tools if present
      const openaiTools = convertToolsToOpenAI(
        params.tools as Array<Record<string, unknown>> | undefined,
      )
      if (openaiTools) {
        openaiBody.tools = openaiTools
        // Map tool_choice
        if (params.tool_choice) {
          const tc = params.tool_choice as Record<string, unknown>
          if (tc.type === 'auto') openaiBody.tool_choice = 'auto'
          else if (tc.type === 'tool') openaiBody.tool_choice = { type: 'function', function: { name: tc.name } }
          else if (tc.type === 'any') openaiBody.tool_choice = 'required'
        }
      }

      // Strip Anthropic-specific fields that OpenAI rejects
      delete openaiBody.metadata
      delete openaiBody.system
      // Remove cache_control from content blocks
      if (openaiBody.messages) {
        for (const msg of openaiBody.messages as Array<Record<string, unknown>>) {
          if (Array.isArray(msg.content)) {
            for (const block of msg.content as Array<Record<string, unknown>>) {
              delete block.cache_control
              delete block.cache_scope
            }
          }
        }
      }

      // Thinking → OpenAI reasoning_effort (if supported)
      if (params.thinking) {
        const thinking = params.thinking as Record<string, unknown>
        if (thinking.type === 'enabled' && thinking.budget_tokens) {
          // Map to OpenAI's reasoning effort — rough heuristic
          const budget = thinking.budget_tokens as number
          if (budget > 16000) openaiBody.reasoning_effort = 'high'
          else if (budget > 4000) openaiBody.reasoning_effort = 'medium'
          else openaiBody.reasoning_effort = 'low'
        } else if (thinking.type === 'adaptive') {
          openaiBody.reasoning_effort = 'medium'
        }
      }
      requestBody = openaiBody
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...authHeader,
        ...cleanHeaders,
        ...options?.headers,
        ...(isAnthropicProxy
          ? { 'anthropic-version': '2023-06-01' }
          : {}),
      }

      // Filter headers that non-Anthropic providers reject
      const filteredHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(headers)) {
        if (
          key === 'x-claude-code-session-id' ||
          key.startsWith('x-claude-remote-')
        ) {
          continue
        }
        filteredHeaders[key] = value
      }

      const controller = new AbortController()
      const signal = options?.signal
      if (signal) {
        signal.addEventListener('abort', () => controller.abort())
      }

      const fetchTimeout = options?.timeout || timeout
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      if (fetchTimeout > 0) {
        timeoutId = setTimeout(() => controller.abort(), fetchTimeout)
      }

      const response = await fetch(apiPath, {
        method: 'POST',
        headers: filteredHeaders,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        let errorData: Record<string, unknown> = {}
        try { errorData = JSON.parse(errorText) } catch { /* raw text */ }

        const status = response.status
        const message = (errorData.error as Record<string, string>)?.message
          || (typeof errorData.error === 'string' ? errorData.error : null)
          || errorText
          || `HTTP ${status}`

        throwProviderError(status, message, response.headers)
      }

      if (isStreaming) {
        const stream = isAnthropicProxy
          ? parseAnthropicNativeStream(response)
          : parseOpenAIStream(response)
        return wrapStreamingResponse(response, stream)
      }

      if (isAnthropicProxy) {
        const json = await response.json() as Record<string, unknown>
        return { ...json, __httpResponse: response }
      }

      // Non-streaming OpenAI: parse the complete response
      const json = await response.json() as Record<string, unknown>
      const choice = (json.choices as Array<Record<string, unknown>>)?.[0]
      const msg = choice?.message as Record<string, unknown>

      // Convert OpenAI response back to Anthropic format
      const content: Array<Record<string, unknown>> = []

      // Text content
      if (msg?.content) {
        content.push({ type: 'text', text: msg.content })
      }

      // Tool calls
      if (msg?.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
          const func = tc.function as Record<string, unknown>
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: func.name,
            input: typeof func.arguments === 'string'
              ? JSON.parse(func.arguments as string)
              : func.arguments,
          })
        }
      }

      const stopReasonMap: Record<string, string> = {
        'stop': 'end_turn',
        'length': 'max_tokens',
        'tool_calls': 'tool_use',
        'content_filter': 'refusal',
      }

      return {
        id: json.id || messageId,
        model: json.model || config.model || 'unknown',
        type: 'message',
        role: 'assistant',
        content,
        stop_reason: stopReasonMap[choice?.finish_reason as string] || choice?.finish_reason,
        usage: json.usage
          ? {
              input_tokens: (json.usage as Record<string, number>).prompt_tokens || 0,
              output_tokens: (json.usage as Record<string, number>).completion_tokens || 0,
            }
          : { input_tokens: 0, output_tokens: 0 },
        __httpResponse: response,
      }
  }

  const genericBetaMessages = {
    /** Sync entry — matches Anthropic SDK APIPromise (.withResponse before await) */
    create(
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal; timeout?: number; headers?: Record<string, string> },
    ) {
      const promise = executeGenericMessageCreate(params, options)
      return Object.assign(promise, {
        withResponse: async () => {
          const value = await promise
          if (value && typeof (value as { withResponse?: () => Promise<unknown> }).withResponse === 'function') {
            return (value as { withResponse: () => Promise<{ data: unknown; request_id: string; response: Response }> }).withResponse()
          }
          return {
            data: value,
            request_id: `req_${Date.now()}`,
            response: (value as { __httpResponse?: Response })?.__httpResponse ?? new Response(),
          }
        },
      })
    },
  }

  return {
    beta: {
      messages: genericBetaMessages,
    },
    messages: genericBetaMessages,
  }
}

async function configureApiKeyHeaders(
  headers: Record<string, string>,
  isNonInteractiveSession: boolean,
): Promise<void> {
  const token =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    (await getApiKeyFromApiKeyHelper(isNonInteractiveSession))
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
}

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.ANTHROPIC_CUSTOM_HEADERS

  if (!customHeadersEnv) return customHeaders

  // Split by newlines to support multiple headers
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    // Parse header in format "Name: Value" (curl style). Split on first `:`
    // then trim — avoids regex backtracking on malformed long header lines.
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

function buildFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const inner = fetchOverride ?? globalThis.fetch
  // Only send to the first-party API — Bedrock/Vertex/Foundry don't log it
  // and unknown headers risk rejection by strict proxies (inc-4029 class).
  const injectClientRequestId =
    getAPIProvider() === 'firstParty' && isFirstPartyAnthropicBaseUrl()
  return (input, init) => {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const headers = new Headers(init?.headers)
    // Generate a client-side request ID so timeouts (which return no server
    // request ID) can still be correlated with server logs by the API team.
    // Callers that want to track the ID themselves can pre-set the header.
    if (injectClientRequestId && !headers.has(CLIENT_REQUEST_ID_HEADER)) {
      headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID())
    }
    try {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const url = input instanceof Request ? input.url : String(input)
      const id = headers.get(CLIENT_REQUEST_ID_HEADER)
      logForDebugging(
        `[API REQUEST] ${new URL(url).pathname}${id ? ` ${CLIENT_REQUEST_ID_HEADER}=${id}` : ''} source=${source ?? 'unknown'}`,
      )
    } catch {
      // never let logging crash the fetch
    }
    return inner(input, { ...init, headers })
  }
}
