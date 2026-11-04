/** Normalizes whitespace inside a paragraph and drops control characters. */
export function cleanText(s: string): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/­/g, '') // soft hyphen
      .replace(/[ \t\u00a0]+/g, ' ')
      .trim()
  )
}

/** Splits text into paragraphs on blank lines; single newlines inside a paragraph become spaces. */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => cleanText(p.replace(/\n/g, ' ')))
    .filter((p) => p.length > 0)
}

export function countWords(paragraphs: string[]): number {
  let n = 0
  for (const p of paragraphs) {
    const m = p.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
    if (m) n += m.length
  }
  return n
}

/** Decodes bytes as UTF-8, falling back to Windows-1252 for legacy text files. Strips a BOM. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Title-ish cleanup for file names: "the_time-machine (1895).epub" → "the time-machine (1895)". */
export function titleFromFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '')
  const t = stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t || 'Untitled'
}

/**
 * PDF/DOCX title fields are often junk written by the producing app ("Microsoft Word - draft.docx",
 * "untitled", "Document1"). Returns null for those so the file name is used instead.
 */
export function plausibleTitle(t: string | null | undefined): string | null {
  if (!t) return null
  const s = cleanText(t)
  if (s.length < 2 || s.length > 300) return null
  if (/^(untitled|document\d*|doc\d*|title|unknown|none|null)$/i.test(s)) return null
  if (/^microsoft (word|powerpoint) - /i.test(s)) return null
  if (/\.(docx?|pdf|txt|rtf|odt|indd|tex|dvi|ps)$/i.test(s)) return null
  return s
}
