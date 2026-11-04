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
    services/  FileStore (library folder + book:// protocol), SecretStore (safeStorage), ...
  preload/     exposes a typed, minimal `window.api` via contextBridge
  renderer/    React UI (Tailwind v4, Zustand, React Router)
```

**Security defaults:** `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP, IPC only
from our own renderer, all arguments validated, the Anthropic API key encrypted with Electron
`safeStorage` and never sent to the renderer.

**Data location:** `<userData>/library.db` (SQLite) and `<userData>/library/<bookId>/…` for files.
Book files reach the UI through the `book://<bookId>/<path>` protocol, which refuses paths outside
the book's folder.
