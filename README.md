# Ur Library

Desktop app (Electron + React + TypeScript) to discover free public-domain books, read and annotate
them, import your own PDF/EPUB/DOCX files, and transform books with Claude (summarize, simplify,
translate, chat).

## Development

```bash
npm install
npm run dev        # start the app with hot reload
npm run lint && npm run typecheck
```

## Architecture

```
src/
  shared/      IPC contract (channel names + types) and default settings, used by all processes
  main/        Electron main process — all file, network, database and AI work
    db/        SQLite via node:sqlite (built into Electron's Node), migrations, repositories
    ipc/       zod-validated handlers; every response is an { ok, data | error } envelope
    import/    import pipeline: hashing/dedup, per-format text extractors (PDF, EPUB, DOCX, TXT/MD),
               chunking for search and AI, OCR (tesseract.js) for scanned PDFs
    workers/   utility-process entry that runs extraction/OCR off the main thread
    services/  FileStore (library folder + book:// protocol), SecretStore (safeStorage), JobQueue
  preload/     exposes a typed, minimal `window.api` via contextBridge
  renderer/    React UI (Tailwind v4, Zustand, React Router)
    reader/    PDF (pdf.js viewer), EPUB (epub.js) and HTML (DOCX/TXT/MD) readers behind one
               ReaderHandle interface, plus the shared chrome (TOC, search, display, focus mode)
```

**Security defaults:** `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, IPC only
from our own renderer, all arguments validated, the Anthropic API key encrypted with Electron
`safeStorage` and never sent to the renderer.

**Import pipeline:** files are hashed (duplicates are detected by content), copied into the
library, then a utility process extracts metadata, a cover and the text, which is split into
~2,000-character chunks, indexed with SQLite FTS5 and saved as `text/chunks.json` for AI features.
Scanned PDFs are flagged and can be OCR'd; language data is downloaded once on first use.

**Reader locations:** positions are strings shared by search, progress and (later) notes:
`page:12` (PDF), `cfi:epubcfi(...)` / `href:<file>` (EPUB), `heading:3` (DOCX/MD, the n-th
heading), `section:2` (TXT), `scroll:0.42` (saved scroll position in HTML views). Untrusted book
content is sandboxed: EPUB pages render in script-less iframes, DOCX/MD/TXT HTML is sanitized
with DOMPurify.

**Highlights & notes:** stored in SQLite, never written into the original file. Each one keeps a
format-specific anchor (PDF page + rectangles as page fractions, EPUB CFI, or a text quote with
surrounding context for DOCX/MD/TXT that is re-found if the text shifts — see
`src/shared/anchoring.ts`). Notes export to Markdown, and PDF highlights export as standard PDF
Highlight annotations in a copy of the file.

**Data location:** `<userData>/library.db` (SQLite) and `<userData>/library/<bookId>/…` for files.
Book files reach the UI through the `book://<bookId>/<path>` protocol, which refuses paths outside
the book's folder.
