import type { ImportResult } from '../../../shared/ipc'
import { toast } from '../stores/toasts'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Shows one clear summary toast for an import, however many files it touched. */
export function reportImport(r: ImportResult | null): void {
  if (!r) return
  const { imported, duplicates, failed } = r
  if (imported.length) {
    toast.success(
      imported.length === 1
        ? `Added “${imported[0].title}”. Reading its text in the background…`
        : `Added ${plural(imported.length, 'book')}. Reading their text in the background…`
    )
  }
  if (duplicates.length) {
    toast.info(
      duplicates.length === 1
        ? `“${duplicates[0].title}” is already in your library.`
        : `${plural(duplicates.length, 'file')} were already in your library.`
    )
  }
  if (failed.length) {
    const name = failed[0].path.split(/[\\/]/).pop()
    toast.error(
      failed.length === 1
        ? `Couldn’t add ${name}: ${failed[0].reason}`
        : `Couldn’t add ${plural(failed.length, 'file')} (e.g. ${name}: ${failed[0].reason})`
    )
  }
  if (!imported.length && !duplicates.length && !failed.length) {
    toast.info('No supported books found (PDF, EPUB, DOCX, TXT or Markdown).')
  }
}

export async function importWith(fn: () => Promise<ImportResult | null>): Promise<void> {
  try {
    reportImport(await fn())
  } catch (e) {
    toast.error(`Import failed: ${(e as Error).message}`)
  }
}
