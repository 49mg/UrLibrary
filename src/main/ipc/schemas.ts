import { z } from 'zod'
import {
  OCR_LANGUAGES,
  type InvokeArgs,
  type InvokeChannel,
  type OcrLanguage
} from '../../shared/ipc'

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

const id = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/, 'Invalid id')
const name = z.string().trim().min(1, 'Name is required').max(80)
const nullableText = (max: number): z.ZodType<string | null> =>
  z.string().trim().max(max).nullable()

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
  'books:get': z.object({ id }).strict(),
  'books:update': z
    .object({
      id,
      title: z.string().trim().min(1, 'Title is required').max(300).optional(),
      author: nullableText(300).optional(),
      language: nullableText(40).optional(),
      description: nullableText(5000).optional(),
      status: z.enum(['unread', 'reading', 'finished']).optional()
    })
    .strict(),
  'books:delete': z.object({ id }).strict(),
  'books:showInFolder': z.object({ id }).strict(),
  'books:reextract': z.object({ id }).strict(),
  'books:runOcr': z
    .object({
      id,
      language: z.enum(OCR_LANGUAGES.map((l) => l.code) as [OcrLanguage, ...OcrLanguage[]])
    })
    .strict(),
  'library:openFolder': none,
  'library:importDialog': z.object({ mode: z.enum(['files', 'folder']) }).strict(),
  'library:importPaths': z
    .object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(1000) })
    .strict(),
  'search:fullText': z
    .object({ query: z.string().max(500), limit: z.number().int().min(1).max(200).optional() })
    .strict(),
  'collections:list': none,
  'collections:create': z.object({ name }).strict(),
  'collections:rename': z.object({ id, name }).strict(),
  'collections:delete': z.object({ id }).strict(),
  'collections:addBook': z.object({ collectionId: id, bookId: id }).strict(),
  'collections:removeBook': z.object({ collectionId: id, bookId: id }).strict(),
  'jobs:list': none,
  'jobs:cancel': z.object({ id }).strict()
}
