import Anthropic from '@anthropic-ai/sdk'
import type { ApiKeyTestResult } from '../../shared/ipc'

/** Checks a key with a cheap, free call (list models) instead of spending tokens. */
export async function testApiKey(apiKey: string | null): Promise<ApiKeyTestResult> {
  if (!apiKey) return { ok: false, message: 'No API key saved yet.' }
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 })
  try {
    await client.models.list({ limit: 1 })
    return { ok: true, message: 'Key works.' }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError)
      return { ok: false, message: 'The key was rejected (invalid or revoked).' }
    if (err instanceof Anthropic.PermissionDeniedError)
      return { ok: false, message: 'The key lacks permission for this request.' }
    if (err instanceof Anthropic.RateLimitError)
      return { ok: true, message: 'Key is valid, but currently rate limited.' }
    if (err instanceof Anthropic.APIConnectionError)
      return { ok: false, message: 'Could not reach the Anthropic API. Check your connection.' }
    if (err instanceof Anthropic.APIError)
      return { ok: false, message: `API error ${err.status ?? ''}: ${err.message}` }
    return { ok: false, message: 'Unexpected error while testing the key.' }
  }
}
