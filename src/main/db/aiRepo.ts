import { randomUUID } from 'node:crypto'
import type { Db } from './index'
import type {
  AiAction,
  AiActionOptions,
  AiJob,
  AiJobStatus,
  AiPartDetail,
  AiPartStatus,
  BookVersion
} from '../../shared/ipc'

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

interface JobRow {
  id: string
  book_id: string
  book_title: string
  action: AiAction
  title: string
  options_json: string
  status: AiJobStatus
  model: string
  error: string | null
  version_id: string | null
  input_tokens: number
  output_tokens: number
  created_at: string
}

interface PartRow {
  idx: number
  title: string
  status: AiPartStatus
  source_chars: number
  output_chars: number
}

export interface PartToRun {
  idx: number
  title: string
  source: string
  output: string | null
  status: AiPartStatus
}

export class AiRepo {
  constructor(private db: Db) {}

  createJob(j: {
    bookId: string
    action: AiAction
    title: string
    options: AiActionOptions
    model: string
    parts: Array<{ title: string; source: string }>
  }): string {
    const id = randomUUID()
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO ai_jobs (id, book_id, action, title, options_json, status, model)
           VALUES (?, ?, ?, ?, ?, 'queued', ?)`
        )
        .run(id, j.bookId, j.action, j.title, JSON.stringify(j.options), j.model)
      const ins = this.db.prepare(
        'INSERT INTO ai_job_parts (job_id, idx, title, source) VALUES (?, ?, ?, ?)'
      )
      j.parts.forEach((p, i) => ins.run(id, i, p.title, p.source))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return id
  }

  private toJob(r: JobRow): AiJob {
    const parts = this.db
      .prepare(
        `SELECT idx, title, status, length(source) AS source_chars, COALESCE(length(output), 0) AS output_chars
         FROM ai_job_parts WHERE job_id = ? ORDER BY idx`
      )
      .all(r.id) as unknown as PartRow[]
    return {
      id: r.id,
      bookId: r.book_id,
      bookTitle: r.book_title,
      action: r.action,
      title: r.title,
      status: r.status,
      model: r.model,
      error: r.error,
      versionId: r.version_id,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      createdAt: r.created_at,
      parts: parts.map((p) => ({
        idx: p.idx,
        title: p.title,
        status: p.status,
        sourceChars: Number(p.source_chars),
        outputChars: Number(p.output_chars)
      }))
    }
  }

  job(id: string): AiJob | null {
    const r = this.db
      .prepare(
        'SELECT j.*, b.title AS book_title FROM ai_jobs j JOIN books b ON b.id = j.book_id WHERE j.id = ?'
      )
      .get(id) as unknown as JobRow | undefined
    return r ? this.toJob(r) : null
  }

  jobs(bookId?: string): AiJob[] {
    const rows = (bookId
      ? this.db
          .prepare(
            'SELECT j.*, b.title AS book_title FROM ai_jobs j JOIN books b ON b.id = j.book_id WHERE j.book_id = ? ORDER BY j.created_at DESC'
          )
          .all(bookId)
      : this.db
          .prepare(
            'SELECT j.*, b.title AS book_title FROM ai_jobs j JOIN books b ON b.id = j.book_id ORDER BY j.created_at DESC LIMIT 100'
          )
          .all()) as unknown as JobRow[]
    return rows.map((r) => this.toJob(r))
  }

  jobOptions(
    id: string
  ): { action: AiAction; options: AiActionOptions; bookId: string; title: string } | null {
    const r = this.db
      .prepare('SELECT action, options_json, book_id, title FROM ai_jobs WHERE id = ?')
      .get(id) as
      { action: AiAction; options_json: string; book_id: string; title: string } | undefined
    return r
      ? {
          action: r.action,
          options: JSON.parse(r.options_json) as AiActionOptions,
          bookId: r.book_id,
          title: r.title
        }
      : null
  }

  setStatus(id: string, status: AiJobStatus, error: string | null = null): void {
    this.db
      .prepare(`UPDATE ai_jobs SET status = ?, error = ?, updated_at = ${NOW} WHERE id = ?`)
      .run(status, error, id)
  }

  parts(jobId: string): PartToRun[] {
    return this.db
      .prepare(
        'SELECT idx, title, source, output, status FROM ai_job_parts WHERE job_id = ? ORDER BY idx'
      )
      .all(jobId) as unknown as PartToRun[]
  }

  part(jobId: string, idx: number): AiPartDetail | null {
    const r = this.db
      .prepare('SELECT idx, title, source, output FROM ai_job_parts WHERE job_id = ? AND idx = ?')
      .get(jobId, idx) as
      { idx: number; title: string; source: string; output: string | null } | undefined
    return r ? { idx: r.idx, title: r.title, source: r.source, output: r.output ?? '' } : null
  }

  setPartStatus(jobId: string, idx: number, status: AiPartStatus): void {
    this.db
      .prepare('UPDATE ai_job_parts SET status = ? WHERE job_id = ? AND idx = ?')
      .run(status, jobId, idx)
  }

  savePart(
    jobId: string,
    idx: number,
    output: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `UPDATE ai_job_parts SET output = ?, status = 'done', input_tokens = ?, output_tokens = ?
           WHERE job_id = ? AND idx = ?`
        )
        .run(output, inputTokens, outputTokens, jobId, idx)
      this.db
        .prepare(
          `UPDATE ai_jobs SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, updated_at = ${NOW}
           WHERE id = ?`
        )
        .run(inputTokens, outputTokens, jobId)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** Parts left in 'running' by a crash or pause go back to pending. */
  resetRunningParts(jobId: string): void {
    this.db
      .prepare(
        "UPDATE ai_job_parts SET status = 'pending' WHERE job_id = ? AND status IN ('running','error')"
      )
      .run(jobId)
  }

  deleteJob(id: string): void {
    this.db.prepare('DELETE FROM ai_jobs WHERE id = ?').run(id)
  }

  interruptedJobs(): string[] {
    return (
      this.db
        .prepare("SELECT id FROM ai_jobs WHERE status IN ('queued','running')")
        .all() as Array<{ id: string }>
    ).map((r) => r.id)
  }

  // ---------- versions ----------

  createVersion(v: {
    id: string
    bookId: string
    kind: string
    title: string
    prompt: string
    model: string
    filePath: string
    inputTokens: number
    outputTokens: number
    jobId: string
  }): void {
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO versions (id, book_id, kind, title, prompt, model, file_path, input_tokens, output_tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          v.id,
          v.bookId,
          v.kind,
          v.title,
          v.prompt,
          v.model,
          v.filePath,
          v.inputTokens,
          v.outputTokens
        )
      this.db
        .prepare(`UPDATE ai_jobs SET version_id = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(v.id, v.jobId)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  versions(bookId: string): BookVersion[] {
    return (
      this.db
        .prepare(
          `SELECT id, book_id, kind, title, model, created_at, input_tokens, output_tokens
           FROM versions WHERE book_id = ? ORDER BY created_at DESC`
        )
        .all(bookId) as Array<{
        id: string
        book_id: string
        kind: string
        title: string
        model: string | null
        created_at: string
        input_tokens: number | null
        output_tokens: number | null
      }>
    ).map((r) => ({
      id: r.id,
      bookId: r.book_id,
      kind: r.kind,
      title: r.title,
      model: r.model,
      createdAt: r.created_at,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens
    }))
  }

  version(id: string): (BookVersion & { filePath: string }) | null {
    const r = this.db.prepare('SELECT * FROM versions WHERE id = ?').get(id) as
      | {
          id: string
          book_id: string
          kind: string
          title: string
          model: string | null
          created_at: string
          input_tokens: number | null
          output_tokens: number | null
          file_path: string
        }
      | undefined
    if (!r) return null
    return {
      id: r.id,
      bookId: r.book_id,
      kind: r.kind,
      title: r.title,
      model: r.model,
      createdAt: r.created_at,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      filePath: r.file_path
    }
  }

  renameVersion(id: string, title: string): void {
    this.db.prepare('UPDATE versions SET title = ? WHERE id = ?').run(title, id)
  }

  /** Deletes the version row (its annotations cascade). Returns its file path for cleanup. */
  deleteVersion(id: string): { bookId: string; filePath: string } | null {
    const v = this.version(id)
    if (!v) return null
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE ai_jobs SET version_id = NULL WHERE version_id = ?').run(id)
      this.db.prepare('DELETE FROM versions WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return { bookId: v.bookId, filePath: v.filePath }
  }
}
