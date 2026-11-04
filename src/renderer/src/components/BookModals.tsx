import { useEffect, useState } from 'react'
import {
  OCR_LANGUAGES,
  type BookDetails,
  type BookSummary,
  type OcrLanguage
} from '../../../shared/ipc'
import { Modal, ConfirmModal } from './Modal'
import { Button, Field, inputClass } from './ui'
import { toast } from '../stores/toasts'
import { FORMAT_LABEL } from '../lib/format'

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function formatBytes(n: number | null): string {
  if (!n) return '—'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function EditBookModal({
  bookId,
  onClose
}: {
  bookId: string
  onClose: () => void
}): React.JSX.Element {
  const [book, setBook] = useState<BookDetails | null>(null)
  const [form, setForm] = useState({ title: '', author: '', language: '', description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.books
      .get(bookId)
      .then((b) => {
        setBook(b)
        setForm({
          title: b.title,
          author: b.author ?? '',
          language: b.language ?? '',
          description: b.description ?? ''
        })
      })
      .catch((e) => {
        toast.error(err(e))
        onClose()
      })
  }, [bookId, onClose])

  const save = async (): Promise<void> => {
    if (!form.title.trim()) return toast.error('Title is required.')
    setSaving(true)
    try {
      await window.api.books.update({
        id: bookId,
        title: form.title.trim(),
        author: form.author.trim() || null,
        language: form.language.trim() || null,
        description: form.description.trim() || null
      })
      toast.success('Book details saved.')
      onClose()
    } catch (e) {
      toast.error(err(e))
    } finally {
      setSaving(false)
    }
  }

  const field = (
    key: keyof typeof form
  ): {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  } => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))
  })

  return (
    <Modal
      title="Book details"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!book || saving}>
            Save
          </Button>
        </>
      }
    >
      {!book ? (
        <div className="h-64" />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Title" htmlFor="b-title">
            <input id="b-title" className={inputClass} {...field('title')} />
          </Field>
          <Field label="Author" htmlFor="b-author">
            <input id="b-author" className={inputClass} {...field('author')} />
          </Field>
          <Field label="Language" htmlFor="b-lang" hint="e.g. en, ar, fr">
            <input id="b-lang" className={`${inputClass} max-w-40`} {...field('language')} />
          </Field>
          <Field label="Description" htmlFor="b-desc">
            <textarea
              id="b-desc"
              rows={4}
              className={`${inputClass} resize-y`}
              {...field('description')}
            />
          </Field>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-sunken px-4 py-3 text-xs text-muted">
            <dt>File</dt>
            <dd className="truncate">{book.originalName ?? '—'}</dd>
            <dt>Format</dt>
            <dd>
              {FORMAT_LABEL[book.format]} · {formatBytes(book.sizeBytes)}
              {book.pageCount ? ` · ${book.pageCount} pages` : ''}
              {book.wordCount ? ` · ${book.wordCount.toLocaleString()} words` : ''}
            </dd>
            {book.textError && (
              <>
                <dt>Text</dt>
                <dd className="text-danger">{book.textError}</dd>
              </>
            )}
          </dl>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  )
}

export function DeleteBookModal({
  book,
  onClose
}: {
  book: BookSummary
  onClose: () => void
}): React.JSX.Element {
  return (
    <ConfirmModal
      title="Delete book?"
      danger
      confirmLabel="Delete"
      onClose={onClose}
      onConfirm={() =>
        window.api.books
          .delete(book.id)
          .then(() => toast.info(`Deleted “${book.title}”.`))
          .catch((e) => toast.error(err(e)))
      }
      message={
        <>
          “<span className="text-text">{book.title}</span>” will be removed from your library
          together with its notes and AI versions. The original file you imported from is not
          touched.
        </>
      }
    />
  )
}

export function OcrModal({
  book,
  onClose
}: {
  book: BookSummary
  onClose: () => void
}): React.JSX.Element {
  const [lang, setLang] = useState<OcrLanguage>(book.language?.startsWith('ar') ? 'ara' : 'eng')
  const start = async (): Promise<void> => {
    try {
      await window.api.books.runOcr(book.id, lang)
      toast.info('Recognizing text. This can take a few minutes for long books.')
      onClose()
    } catch (e) {
      toast.error(err(e))
    }
  }
  return (
    <Modal
      title="Recognize text (OCR)"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={start}>
            Start
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="leading-relaxed text-muted">
          “{book.title}” looks like a scanned book with no selectable text. OCR reads the page
          images so you can search the book and use AI features. The first run downloads the
          language data (about 10–20 MB).
        </p>
        <Field label="Book language" htmlFor="ocr-lang">
          <select
            id="ocr-lang"
            className={`${inputClass} max-w-60`}
            value={lang}
            onChange={(e) => setLang(e.target.value as OcrLanguage)}
          >
            {OCR_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  )
}
