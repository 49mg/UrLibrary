import { z } from 'zod'
import type { InvokeArgs, InvokeChannel } from '../../shared/ipc'

const none = z.undefined()

const settingsPatch = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    reader: z
      .object({
        theme: z.enum(['light', 'dark', 'sepia']).optional(),
        fontFamily: z.enum(['serif', 'sans']).optional(),
        fontSize: z.number().int().min(10).max(40).optional(),
        lineHeight: z.number().min(1).max(3).optional()
      })
      .strict()
      .optional(),
    ai: z
      .object({
        effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
        targetLanguage: z.string().trim().min(1).max(60).optional()
      })
      .strict()
      .optional()
  })
  .strict()

/** Runtime validation for every channel's arguments. Main rejects anything that doesn't match. */
export const invokeSchemas: { [K in InvokeChannel]: z.ZodType<InvokeArgs<K>> } = {
  'app:info': none,
  'settings:get': none,
  'settings:update': settingsPatch,
  'apiKey:status': none,
  'apiKey:set': z.object({ key: z.string().trim().min(20).max(400) }).strict(),
  'apiKey:clear': none,
  'apiKey:test': none,
  'books:list': none,
  'library:openFolder': none
}
