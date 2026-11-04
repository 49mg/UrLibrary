import { readFile, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import type { ExtractOptions, ExtractResult, ExtractedChapter } from '../types'
import { throwIfAborted } from '../types'
import { htmlToBlocks, htmlToText } from '../html'
import { cleanText } from '../textUtils'

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  textNodeName: '#text',
  isArray: (name) =>
    ['item', 'itemref', 'meta', 'navPoint', 'li', 'creator', 'title'].includes(name)
})

type Node = Record<string, unknown>
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** Text of an XML node that may be a string, a number, or { '#text': ... }. */
function textOf(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(textOf).join(' ')
  if (typeof v === 'object') {
    const n = v as Node
    if ('#text' in n) return textOf(n['#text'])
    return Object.entries(n)
      .filter(([k]) => !k.startsWith('@'))
      .map(([, c]) => textOf(c))
      .join(' ')
  }
  return ''
}

/** Resolves an href relative to the file it appears in, dropping any #fragment. */
function resolveHref(fromFile: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0])
  return posix.normalize(posix.join(posix.dirname(fromFile), clean)).replace(/^\.\//, '')
}

interface ManifestItem {
  id: string
  path: string
  mediaType: string
  properties: string[]
}

/** Maps content file path → TOC title, from EPUB3 nav or EPUB2 NCX. First entry per file wins. */
function tocTitles(
  files: Record<string, Uint8Array>,
  manifest: ManifestItem[],
  ncxId?: string
): Map<string, string> {
  const titles = new Map<string, string>()
  const nav = manifest.find((m) => m.properties.includes('nav'))
  if (nav && files[nav.path]) {
    const html = strFromU8(files[nav.path])
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    for (const m of html.matchAll(re)) {
      const target = resolveHref(nav.path, m[1])
      const title = cleanText(htmlToText(m[2]))
      if (title && !titles.has(target)) titles.set(target, title)
    }
  }
  const ncx =
    manifest.find((m) => m.id === ncxId) ??
    manifest.find((m) => m.mediaType === 'application/x-dtbncx+xml')
  if (titles.size === 0 && ncx && files[ncx.path]) {
    const doc = xml.parse(strFromU8(files[ncx.path])) as Node
    const walk = (points: Node[]): void => {
      for (const p of points) {
        const src = (p.content as Node | undefined)?.['@src']
        const title = cleanText(textOf((p.navLabel as Node | undefined)?.text))
        if (typeof src === 'string' && title) {
          const target = resolveHref(ncx.path, src)
          if (!titles.has(target)) titles.set(target, title)
        }
        walk(arr(p.navPoint as Node[] | undefined))
      }
    }
    walk(
      arr(
        ((doc.ncx as Node | undefined)?.navMap as Node | undefined)?.navPoint as Node[] | undefined
      )
    )
  }
  return titles
}

function findCover(opf: Node, manifest: ManifestItem[]): ManifestItem | undefined {
  const isImage = (m: ManifestItem): boolean => m.mediaType.startsWith('image/')
  const byProp = manifest.find((m) => m.properties.includes('cover-image') && isImage(m))
  if (byProp) return byProp
  const metas = arr(
    ((opf.package as Node)?.metadata as Node | undefined)?.meta as Node[] | undefined
  )
  const coverId = metas.find((m) => m['@name'] === 'cover')?.['@content']
  const byMeta = manifest.find((m) => m.id === coverId && isImage(m))
  if (byMeta) return byMeta
  return manifest.find((m) => isImage(m) && /cover/i.test(m.id + m.path))
}

export async function extractEpub(opts: ExtractOptions): Promise<ExtractResult> {
  const files = unzipSync(new Uint8Array(await readFile(opts.filePath)))
  const container = files['META-INF/container.xml']
  if (!container) throw new Error('Not a valid EPUB (missing META-INF/container.xml)')
  const containerDoc = xml.parse(strFromU8(container)) as Node
  const rootfiles = (containerDoc.container as Node | undefined)?.rootfiles as Node | undefined
  const rootfile = arr(rootfiles?.rootfile as Node | Node[] | undefined)[0]
  const opfPath = rootfile?.['@full-path']
  if (typeof opfPath !== 'string' || !files[opfPath])
    throw new Error('Not a valid EPUB (missing package file)')

  const opf = xml.parse(strFromU8(files[opfPath])) as Node
  const pkg = opf.package as Node
  const metadata = (pkg.metadata ?? {}) as Node
  const manifest: ManifestItem[] = arr(
    (pkg.manifest as Node | undefined)?.item as Node[] | undefined
  ).map((i) => ({
    id: String(i['@id'] ?? ''),
    path: resolveHref(opfPath, String(i['@href'] ?? '')),
    mediaType: String(i['@media-type'] ?? ''),
    properties: String(i['@properties'] ?? '')
      .split(/\s+/)
      .filter(Boolean)
  }))
  const byId = new Map(manifest.map((m) => [m.id, m]))
  const spineNode = (pkg.spine ?? {}) as Node
  const spine = arr(spineNode.itemref as Node[] | undefined)
    .filter((r) => r['@linear'] !== 'no')
    .map((r) => byId.get(String(r['@idref'])))
    .filter((m): m is ManifestItem => !!m && !!files[m.path] && /html|xml/.test(m.mediaType))

  const titles = tocTitles(
    files,
    manifest,
    typeof spineNode['@toc'] === 'string' ? spineNode['@toc'] : undefined
  )

  const chapters: ExtractedChapter[] = []
  spine.forEach((item, i) => {
    throwIfAborted(opts.signal)
    const blocks = htmlToBlocks(strFromU8(files[item.path]))
    const paragraphs = blocks.map((b) => b.text)
    opts.onProgress?.((i + 1) / spine.length)
    if (paragraphs.length === 0) return // cover pages, image-only pages
    const tocTitle = titles.get(item.path)
    const heading = blocks.find((b) => b.kind !== 'p')?.text
    const prev = chapters[chapters.length - 1]
    // A file with no TOC entry and no heading is usually the continuation of the previous chapter.
    if (!tocTitle && !heading && prev) {
      prev.paragraphs.push(...paragraphs)
      return
    }
    chapters.push({
      title: tocTitle ?? heading?.split('\n')[0] ?? `Section ${chapters.length + 1}`,
      location: `href:${item.path}`,
      paragraphs
    })
  })

  let coverPath: string | null = null
  const cover = findCover(opf, manifest)
  if (cover && files[cover.path]) {
    const ext = cover.mediaType.includes('png')
      ? 'png'
      : cover.mediaType.includes('svg')
        ? 'svg'
        : 'jpg'
    if (ext !== 'svg') {
      coverPath = `cover.${ext}`
      await writeFile(join(opts.bookDir, coverPath), files[cover.path])
    }
  }

  const description = textOf(metadata.description)
  return {
    meta: {
      title: cleanText(textOf(arr(metadata.title as unknown[])[0])) || null,
      author:
        arr(metadata.creator as unknown[])
          .map((c) => cleanText(textOf(c)))
          .filter(Boolean)
          .join(', ') || null,
      language: cleanText(textOf(arr(metadata.language as unknown[])[0])) || null,
      description: description ? cleanText(htmlToText(description)) : null
    },
    pageCount: null,
    chapters,
    coverPath,
    needsOcr: false
  }
}
