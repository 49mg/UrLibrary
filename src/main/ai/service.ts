import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import type {
  AiEffort,
  AiEstimate,
  AiJob,
  AiJobRequest,
  AskAction,
  ChapterInfo
} from '../../shared/ipc'
import type { AiRepo } from '../db/aiRepo'
import type { BooksRepo } from '../db/booksRepo'
import type { FileStore } from '../services/fileStore'
import type { JobQueue } from '../services/jobQueue'
import type { ChunksFile } from '../import/importService'
import { AppError } from '../ipc/handler'
import { AI_MODEL, AiError, PRICE_PER_MTOK, type ClaudeClient } from './claude'
import {
  askPrompt,
  actionInstruction,
  jobTitle,
  OUTPUT_RATIO,
  partPrompt,
  systemPrompt
} from './prompts'

/** ~15k tokens of book text per request: enough context, quick to stream, cheap to retry. */
export const MAX_PART_CHARS = 60_000
/** Chapters shorter than this are merged with the next one, so tiny sections don't each cost a call. */
export const MIN_PART_CHARS = 1_500
const MAX_OUTPUT_TOKENS = 64_000
const TAIL_CHARS = 600

export interface Part {
  title: string
  source: string
}

/** Groups the extracted text into request-sized parts at chunk (paragraph group) boundaries. */
export function buildParts(file: ChunksFile, chapterIndexes?: number[]): Part[] {
  const wanted = chapterIndexes ? new Set(chapterIndexes) : null
  const chapters = file.chapters
    .filter((c) => !wanted || wanted.has(c.index))
    .map((c) => ({
      title: c.title,
      chunks: file.chunks.filter((k) => k.chunkId.startsWith(`${c.index}-`)).map((k) => k.content)
    }))
    .filter((c) => c.chunks.length > 0)

  const parts: Part[] = []
  let pending: Part | null = null
  for (const ch of chapters) {
    // Split long chapters into numbered parts.
    const pieces: string[] = []
    let cur = ''
    for (const chunk of ch.chunks) {
      if (cur && cur.length + chunk.length + 2 > MAX_PART_CHARS) {
        pieces.push(cur)
        cur = ''
      }
      cur = cur ? `${cur}\n\n${chunk}` : chunk
    }
    if (cur) pieces.push(cur)
    pieces.forEach((source, i) => {
      const title = pieces.length > 1 ? `${ch.title} (part ${i + 1})` : ch.title
      // Merge short sections forward (e.g. a dedication before chapter 1).
      if (pending) {
        if (pending.source.length + source.length + 2 <= MAX_PART_CHARS) {
          pending = {
            title: `${pending.title} · ${title}`,
            source: `${pending.source}\n\n${source}`
          }
        } else {
          parts.push(pending)
          pending = { title, source }
        }
      } else {
        pending = { title, source }
      }
      if (pending.source.length >= MIN_PART_CHARS) {
        parts.push(pending)
        pending = null
      }
    })
  }
  if (pending) parts.push(pending)
  return parts
}

export interface AiDeps {
  repo: AiRepo
  books: BooksRepo
  files: FileStore
  /** Runs one AI job at a time (rate limits, predictable cost). */
  queue: JobQueue
  /** null when no API key is set. */
  client: () => ClaudeClient | null
  effort: () => AiEffort
  language: () => string
  emitJob: (job: AiJob) => void
  emitDelta: (d: { jobId?: string; idx?: number; requestId?: string; text: string }) => void
  /** Called when a version is created or deleted, so the UI can refresh. */
  onVersionsChanged: (bookId: string) => void
}

export class AiService {
  /** ai job id → queue job id, to cancel/pause the running one. */
  private queued = new Map<string, string>()
  /** Jobs the user paused (vs cancelled) while running. */
  private pausing = new Set<string>()
  private asks = new Map<string, AbortController>()

  constructor(private d: AiDeps) {}

  private requireClient(): ClaudeClient {
    const c = this.d.client()
    if (!c) throw new AppError('NO_API_KEY', 'Add your Anthropic API key in Settings → AI first.')
    return c
  }

  private async chunks(bookId: string): Promise<ChunksFile> {
    const book = this.d.books.get(bookId)
    if (!book) throw new AppError('NOT_FOUND', 'That book is no longer in your library.')
    if (book.textStatus !== 'done') {
      throw new AppError(
        'NO_TEXT',
        'This book’s text isn’t available yet (still reading it, or it needs OCR).'
      )
    }
    try {
      return JSON.parse(
        await readFile(this.d.files.resolveInBook(bookId, 'text/chunks.json'), 'utf8')
      ) as ChunksFile
    } catch {
      throw new AppError(
        'NO_TEXT',
        'This book’s text couldn’t be read. Try “Re-read text” in the library.'
      )
    }
  }

  async chapters(bookId: string): Promise<ChapterInfo[]> {
    const file = await this.chunks(bookId)
    return file.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      chars: file.chunks
        .filter((k) => k.chunkId.startsWith(`${c.index}-`))
        .reduce((n, k) => n + k.content.length, 0)
    }))
  }

  private async parts(req: AiJobRequest): Promise<Part[]> {
    if (req.scope.kind === 'text') {
      const text = req.scope.text.trim()
      if (!text) throw new AppError('EMPTY', 'There’s no text to process.')
      return [
        {
          title: req.scope.label?.trim() || 'Selected passage',
          source: text.slice(0, MAX_PART_CHARS)
        }
      ]
    }
    const file = await this.chunks(req.bookId)
    const parts = buildParts(file, req.scope.kind === 'chapters' ? req.scope.indexes : undefined)
    if (!parts.length) throw new AppError('EMPTY', 'No text selected. Pick at least one chapter.')
    return parts
  }

  /** Exact input token count when a key is set (free API call), otherwise a character-based guess. */
  async estimate(req: AiJobRequest): Promise<AiEstimate> {
    const parts = await this.parts(req)
    const system = systemPrompt(req.action, req.options)
    const allText = parts.map((p) => partPrompt(p.title, p.source)).join('\n\n')
    const client = this.d.client()
    let inputTokens: number
    try {
      // System prompt is sent with every part; count it once per part.
      const once = client
        ? await client.countTokens(system, allText)
        : Math.ceil(allText.length / 3.6)
      const systemTokens = Math.ceil(system.length / 3.6)
      inputTokens = once + systemTokens * (parts.length - 1)
    } catch (err) {
      if (err instanceof AiError && /key/i.test(err.message))
        throw new AppError('BAD_KEY', err.message)
      inputTokens = Math.ceil((allText.length + system.length * parts.length) / 3.6)
    }
    // Output: the action's typical length, plus room for adaptive thinking.
    const outputTokensEstimate = Math.ceil(
      inputTokens * OUTPUT_RATIO[req.action] * 1.15 + parts.length * 150
    )
    const costUsd =
      (inputTokens * PRICE_PER_MTOK.input + outputTokensEstimate * PRICE_PER_MTOK.output) / 1e6
    return { parts: parts.length, inputTokens, outputTokensEstimate, costUsd, model: AI_MODEL }
  }

  async start(req: AiJobRequest): Promise<AiJob> {
    this.requireClient()
    const parts = await this.parts(req)
    const id = this.d.repo.createJob({
      bookId: req.bookId,
      action: req.action,
      title: jobTitle(req.action, req.options),
      options: req.options,
      model: AI_MODEL,
      parts
    })
    this.enqueue(id)
    return this.d.repo.job(id) as AiJob
  }

  jobs(bookId?: string): AiJob[] {
    return this.d.repo.jobs(bookId)
  }

  private emit(id: string): void {
    const job = this.d.repo.job(id)
    if (job) this.d.emitJob(job)
  }

  private enqueue(id: string): void {
    this.d.repo.resetRunningParts(id)
    this.d.repo.setStatus(id, 'queued')
    this.emit(id)
    const job = this.d.queue.add('ai', `AI: ${this.d.repo.job(id)?.title ?? 'job'}`, (ctx) =>
      this.run(id, ctx.signal, ctx.progress)
    )
    this.queued.set(id, job.id)
  }

  private async run(
    id: string,
    signal: AbortSignal,
    progress: (f: number | null) => void
  ): Promise<void> {
    const meta = this.d.repo.jobOptions(id)
    if (!meta) return
    const client = this.d.client()
    if (!client) {
      this.d.repo.setStatus(id, 'error', 'Add your Anthropic API key in Settings → AI first.')
      this.emit(id)
      return
    }
    this.d.repo.setStatus(id, 'running')
    this.emit(id)
    const system = systemPrompt(meta.action, meta.options)
    const parts = this.d.repo.parts(id)
    let previous = ''
    try {
      for (const part of parts) {
        if (part.status === 'done') {
          previous = part.output ?? ''
          continue
        }
        if (signal.aborted) throw new Error('Cancelled')
        this.d.repo.setPartStatus(id, part.idx, 'running')
        this.emit(id)
        // Batch streamed text into ~60ms chunks so the UI isn't flooded with events.
        let buffer = ''
        let timer: ReturnType<typeof setTimeout> | null = null
        const flush = (): void => {
          if (buffer) this.d.emitDelta({ jobId: id, idx: part.idx, text: buffer })
          buffer = ''
          timer = null
        }
        const result = await client.stream({
          system,
          user: partPrompt(part.title, part.source, previous.slice(-TAIL_CHARS)),
          effort: this.d.effort(),
          maxTokens: MAX_OUTPUT_TOKENS,
          signal,
          onText: (t) => {
            buffer += t
            timer ??= setTimeout(flush, 60)
          }
        })
        if (timer) clearTimeout(timer)
        flush()
        let output = result.text.trim()
        if (result.stopReason === 'max_tokens')
          output += '\n\n_(This part was cut off because it was too long.)_'
        this.d.repo.savePart(id, part.idx, output, result.inputTokens, result.outputTokens)
        previous = output
        const done = this.d.repo.parts(id).filter((p) => p.status === 'done').length
        progress(done / parts.length)
        this.emit(id)
      }
      await this.createVersion(id)
      this.d.repo.setStatus(id, 'done')
    } catch (err) {
      const paused = this.pausing.delete(id)
      this.d.repo.resetRunningParts(id)
      if (signal.aborted) this.d.repo.setStatus(id, paused ? 'paused' : 'cancelled')
      else this.d.repo.setStatus(id, 'error', err instanceof Error ? err.message : String(err))
      if (!signal.aborted) throw err
    } finally {
      this.queued.delete(id)
      this.emit(id)
    }
  }

  /** Joins the parts into one Markdown document saved next to the book. */
  private async createVersion(id: string): Promise<void> {
    const job = this.d.repo.job(id)
    const meta = this.d.repo.jobOptions(id)
    if (!job || !meta) return
    const book = this.d.books.get(job.bookId)
    const body = this.d.repo
      .parts(id)
      .map((p) => p.output ?? '')
      .join('\n\n')
    const versionId = randomUUID()
    const rel = `versions/${versionId}.md`
    const header = `# ${book?.title ?? 'Book'} — ${job.title}\n\n_Generated with ${job.model} on ${new Date().toISOString().slice(0, 10)}._\n\n`
    this.d.files.ensureBookDir(job.bookId)
    await writeFile(this.d.files.resolveInBook(job.bookId, rel), header + body + '\n', 'utf8')
    this.d.repo.createVersion({
      id: versionId,
      bookId: job.bookId,
      kind: job.action,
      title: job.title,
      prompt: actionInstruction(meta.action, meta.options),
      model: job.model,
      filePath: rel,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      jobId: id
    })
    this.d.onVersionsChanged(job.bookId)
  }

  pause(id: string): void {
    const queueId = this.queued.get(id)
    const job = this.d.repo.job(id)
    if (!job || !queueId) return
    if (job.status === 'queued') {
      this.d.queue.cancel(queueId)
      this.queued.delete(id)
      this.d.repo.setStatus(id, 'paused')
      this.emit(id)
      return
    }
    this.pausing.add(id)
    this.d.queue.cancel(queueId)
  }

  resume(id: string): void {
    this.requireClient()
    const job = this.d.repo.job(id)
    if (!job) throw new AppError('NOT_FOUND', 'That AI job no longer exists.')
    if (!['paused', 'error', 'cancelled'].includes(job.status)) return
    this.enqueue(id)
  }

  cancel(id: string): void {
    const queueId = this.queued.get(id)
    if (queueId) this.d.queue.cancel(queueId)
    else {
      const job = this.d.repo.job(id)
      if (job && (job.status === 'paused' || job.status === 'queued')) {
        this.d.repo.setStatus(id, 'cancelled')
        this.emit(id)
      }
    }
  }

  deleteJob(id: string): void {
    this.cancel(id)
    this.d.repo.deleteJob(id)
  }

  /** Re-queues jobs that were running when the app quit. They continue from the first unfinished part. */
  resumeInterrupted(): void {
    if (!this.d.client()) return
    for (const id of this.d.repo.interruptedJobs()) this.enqueue(id)
  }

  async deleteVersion(id: string): Promise<void> {
    const v = this.d.repo.deleteVersion(id)
    if (!v) return
    await rm(this.d.files.resolveInBook(v.bookId, v.filePath), { force: true })
    this.d.onVersionsChanged(v.bookId)
  }

  async versionMarkdown(id: string): Promise<{ bookId: string; title: string; markdown: string }> {
    const v = this.d.repo.version(id)
    if (!v) throw new AppError('NOT_FOUND', 'That version no longer exists.')
    const markdown = await readFile(this.d.files.resolveInBook(v.bookId, v.filePath), 'utf8')
    return { bookId: v.bookId, title: v.title, markdown }
  }

  /** A quick, streamed answer about a passage (explain, define, translate, simplify). */
  async ask(
    requestId: string,
    bookId: string,
    text: string,
    action: AskAction,
    context?: string
  ): Promise<{ text: string }> {
    const client = this.requireClient()
    const book = this.d.books.get(bookId)
    const ctrl = new AbortController()
    this.asks.set(requestId, ctrl)
    try {
      const p = askPrompt(
        action,
        text.slice(0, 8000),
        book?.title ?? 'a book',
        this.d.language(),
        context?.slice(0, 4000)
      )
      const r = await client.stream({
        system: p.system,
        user: p.user,
        effort: 'low',
        maxTokens: 4000,
        signal: ctrl.signal,
        onText: (t) => this.d.emitDelta({ requestId, text: t })
      })
      return { text: r.text.trim() }
    } catch (err) {
      if (ctrl.signal.aborted) throw new AppError('CANCELLED', 'Cancelled')
      throw new AppError('AI_FAILED', err instanceof Error ? err.message : String(err))
    } finally {
      this.asks.delete(requestId)
    }
  }

  cancelAsk(requestId: string): void {
    this.asks.get(requestId)?.abort()
  }
}
