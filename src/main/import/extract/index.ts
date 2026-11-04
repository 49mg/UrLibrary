import type { ExtractOptions, ExtractResult } from '../types'
import { extractPdf } from './pdf'
import { extractEpub } from './epub'
import { extractDocx } from './docx'
import { extractPlain } from './plain'

export async function extractBook(opts: ExtractOptions): Promise<ExtractResult> {
  switch (opts.format) {
    case 'pdf':
      return extractPdf(opts)
    case 'epub':
      return extractEpub(opts)
    case 'docx':
      return extractDocx(opts)
    case 'txt':
    case 'md':
      return extractPlain(opts)
  }
}
