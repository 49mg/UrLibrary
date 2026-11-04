import type { z } from 'zod'
import type { IpcEnvelope } from '../../shared/ipc'

/** An error whose code and message are safe to show in the UI. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

/**
 * Wraps a handler so it validates its input and always resolves to an envelope.
 * Pure (no electron import) so it can be unit tested.
 */
export function createHandler<A, R>(
  schema: z.ZodType<A>,
  fn: (args: A) => R | Promise<R>
): (raw: unknown) => Promise<IpcEnvelope<R>> {
  return async (raw) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: parsed.error.issues.map((i) => i.message).join('; ')
        }
      }
    }
    try {
      return { ok: true, data: await fn(parsed.data) }
    } catch (err) {
      if (err instanceof AppError)
        return { ok: false, error: { code: err.code, message: err.message } }
      console.error('[ipc] unexpected error', err)
      return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. See logs.' } }
    }
  }
}
