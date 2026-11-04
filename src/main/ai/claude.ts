import Anthropic from '@anthropic-ai/sdk'
import type { AiEffort } from '../../shared/ipc'

/** The model AI Studio uses. Opus 5.5 is Anthropic's current default model. */
export const AI_MODEL = 'claude-opus-5-5'
/** Price per million tokens (USD) for the cost estimate shown before a job starts. */
export const PRICE_PER_MTOK = { input: 4, output: 20 }

export interface StreamRequest {
  system: string
  /** Book text and the instruction for one part. */
  user: string
  effort: AiEffort
  maxTokens: number
  signal: AbortSignal
  onText: (delta: string) => void
}

export interface StreamResult {
  text: string
  stopReason: string | null
  inputTokens: number
  outputTokens: number
  /** Model that produced the answer (differs when a refusal fallback ran). */
  model: string
}

export interface ChatRequest {
  system: string
  /** Full conversation; earlier assistant turns are replayed exactly as the API returned them. */
  messages: Anthropic.Beta.BetaMessageParam[]
  effort: AiEffort
  signal: AbortSignal
  onText: (delta: string) => void
}

export interface ChatResult {
  /** Raw content blocks (thinking, text with citations, fallback markers) to store and replay. */
  content: Anthropic.Beta.BetaContentBlock[]
  stopReason: string | null
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
}

/** What the rest of the app needs from Claude; tests substitute a fake. */
export interface ClaudeClient {
  stream(req: StreamRequest): Promise<StreamResult>
  chat(req: ChatRequest): Promise<ChatResult>
  countTokens(system: string, user: string): Promise<number>
}

/** A user-facing error with a clear message (bad key, rate limit, refusal…). */
export class AiError extends Error {
  constructor(
    message: string,
    /** true when trying again later may succeed */
    public retryable = false
  ) {
    super(message)
  }
}

/** Turns SDK errors into messages a reader can act on. Most specific first. */
export function friendlyError(err: unknown): AiError {
  if (err instanceof AiError) return err
  if (err instanceof Anthropic.APIUserAbortError) return new AiError('Cancelled')
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('Your Anthropic API key was rejected. Check it in Settings → AI.')
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('Your API key isn’t allowed to use this model.')
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('Anthropic’s rate limit was reached. Try again in a minute.', true)
  }
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.message.toLowerCase()
    if (msg.includes('credit') || msg.includes('billing')) {
      return new AiError(
        'Your Anthropic account has no credit left. Add credit in the Anthropic Console.'
      )
    }
    return new AiError(`The request was rejected: ${err.message}`)
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AiError('Anthropic’s servers had a problem. Try again shortly.', true)
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('Couldn’t reach Anthropic. Check your internet connection.', true)
  }
  if (err instanceof Anthropic.APIError)
    return new AiError(`Anthropic error ${err.status ?? ''}: ${err.message}`)
  return new AiError(err instanceof Error ? err.message : String(err))
}

/** Real client: streams with adaptive thinking and server-side refusal fallback. */
export function createClaudeClient(apiKey: string): ClaudeClient {
  const client = new Anthropic({ apiKey, maxRetries: 2 })
  return {
    async stream(req) {
      try {
        const stream = client.beta.messages.stream(
          {
            model: AI_MODEL,
            max_tokens: req.maxTokens,
            // If the model's safety filter declines, the API re-runs the request on the model
            // Anthropic recommends for that refusal category instead of failing the part.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: req.effort },
            // The instructions are identical for every part of a job, so they're cached.
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: req.user }]
          },
          { signal: req.signal }
        )
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            req.onText(event.delta.text)
          }
        }
        const final = await stream.finalMessage()
        if (final.stop_reason === 'refusal') {
          throw new AiError(
            'Claude declined to process this text, even after retrying on a fallback model.'
          )
        }
        const text = final.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        return {
          text,
          stopReason: final.stop_reason,
          inputTokens:
            final.usage.input_tokens +
            (final.usage.cache_read_input_tokens ?? 0) +
            (final.usage.cache_creation_input_tokens ?? 0),
          outputTokens: final.usage.output_tokens,
          model: final.model
        }
      } catch (err) {
        throw friendlyError(err)
      }
    },
    async chat(req) {
      try {
        const stream = client.beta.messages.stream(
          {
            model: AI_MODEL,
            max_tokens: 16_000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: req.effort },
            system: req.system,
            messages: req.messages
          },
          { signal: req.signal }
        )
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            req.onText(event.delta.text)
          }
        }
        const final = await stream.finalMessage()
        if (final.stop_reason === 'refusal') {
          throw new AiError(
            'Claude declined to answer this question, even after retrying on a fallback model.'
          )
        }
        return {
          content: final.content,
          stopReason: final.stop_reason,
          inputTokens: final.usage.input_tokens + (final.usage.cache_creation_input_tokens ?? 0),
          cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
          outputTokens: final.usage.output_tokens
        }
      } catch (err) {
        throw friendlyError(err)
      }
    },
    async countTokens(system, user) {
      try {
        const r = await client.messages.countTokens({
          model: AI_MODEL,
          system,
          messages: [{ role: 'user', content: user }]
        })
        return r.input_tokens
      } catch (err) {
        throw friendlyError(err)
      }
    }
  }
}
