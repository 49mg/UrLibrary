import { z } from 'zod'
import {
  HIGHLIGHT_COLORS,
  OCR_LANGUAGES,
  type InvokeArgs,
  type InvokeChannel,
  type OcrLanguage
} from '../../shared/ipc'

const none = z.undefined()
const PROVIDER_IDS = ['gutenberg', 'standardebooks', 'openlibrary', 'archive', 'arxiv'] as const

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
      .optional(),
    discover: z
      .object({
        providers: z.partialRecord(z.enum(PROVIDER_IDS), z.boolean()).optional()
      })
      .strict()
      .optional()
  })
  .strict()

const id = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/, 'Invalid id')
const name = z.string().trim().min(1, 'Name is required').max(80)
const nullableText = (max: number): z.ZodType<string | null> =>
  z.string().trim().max(max).nullable()

const frac = z.number().min(0).max(1)
const color = z.enum(HIGHLIGHT_COLORS)
const anchor = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('pdf'),
      page: z.number().int().min(1),
      rects: z
        .array(z.tuple([frac, frac, frac, frac]))
        .min(1)
        .max(500)
    })
    .strict(),
  z.object({ kind: z.literal('epub'), cfi: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      kind: z.literal('text'),
      exact: z.string().min(1).max(20_000),
      prefix: z.string().max(200),
      suffix: z.string().max(200),
      start: z.number().int().min(0),
      end: z.number().int().min(0)
    })
    .strict(),
  z.object({ kind: z.literal('location') }).strict()
])

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
  'reader:open': z.object({ id }).strict(),
  'reader:saveProgress': z
    .object({ id, location: z.string().min(1).max(2000), progress: z.number().min(0).max(1) })
    .strict(),
  'reader:savePrefs': z
    .object({
      id,
      prefs: z
        .object({
          theme: z.enum(['light', 'dark', 'sepia']).optional(),
          fontFamily: z.enum(['serif', 'sans']).optional(),
          fontSize: z.number().int().min(10).max(40).optional(),
          lineHeight: z.number().min(1).max(3).optional(),
          flow: z.enum(['paginated', 'scrolled']).optional(),
          pdfZoom: z
            .union([z.enum(['page-width', 'page-fit', 'auto']), z.number().min(0.25).max(5)])
            .optional()
        })
        .strict()
    })
    .strict(),
  'reader:html': z.object({ id }).strict(),
  'annotations:list': z.object({ bookId: id }).strict(),
  'annotations:create': z
    .object({
      bookId: id,
      type: z.enum(['highlight', 'bookmark']),
      anchor,
      location: z.string().min(1).max(2000),
      sortKey: frac,
      chapter: z.string().max(500).nullable().optional(),
      text: z.string().max(20_000).nullable().optional(),
      note: z.string().max(20_000).nullable().optional(),
      color: color.nullable().optional()
    })
    .strict(),
  'annotations:update': z
    .object({ id, note: z.string().max(20_000).nullable().optional(), color: color.optional() })
    .strict(),
  'annotations:delete': z.object({ id }).strict(),
  'annotations:search': z
    .object({
      query: z.string().max(500).optional(),
      color: color.optional(),
      type: z.enum(['highlight', 'bookmark']).optional(),
      limit: z.number().int().min(1).max(2000).optional()
    })
    .strict(),
  'notebook:get': z.object({ bookId: id }).strict(),
  'notebook:save': z.object({ bookId: id, content: z.string().max(2_000_000) }).strict(),
  'export:markdown': z.object({ bookId: id }).strict(),
  'export:annotatedPdf': z.object({ bookId: id }).strict(),
  'discover:providers': none,
  'discover:search': z
    .object({ provider: z.enum(PROVIDER_IDS), query: z.string().max(300) })
    .strict(),
  'discover:details': z
    .object({ provider: z.enum(PROVIDER_IDS), id: z.string().min(1).max(200) })
    .strict(),
  'discover:download': z
    .object({
      provider: z.enum(PROVIDER_IDS),
      id: z.string().min(1).max(200),
      format: z.enum(['epub', 'pdf', 'txt'])
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
