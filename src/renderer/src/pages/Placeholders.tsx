import { BookOpen, Compass, Sparkles } from 'lucide-react'
import { EmptyState, PageHeader } from '../components/ui'

export function DiscoverPage(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Discover" subtitle="Free, public-domain and openly licensed books" />
      <EmptyState icon={Compass} title="Book search is coming next">
        Search Project Gutenberg, Open Library, Internet Archive and more, then download books
        straight into your library.
      </EmptyState>
    </>
  )
}

export function ReaderPage(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Reader" />
      <EmptyState icon={BookOpen} title="No book open">
        Open a book from your library to start reading. PDF, EPUB and Word files are supported.
      </EmptyState>
    </>
  )
}

export function AiStudioPage(): React.JSX.Element {
  return (
    <>
      <PageHeader
        title="AI Studio"
        subtitle="Summarize, simplify, translate or rewrite your books"
      />
      <EmptyState icon={Sparkles} title="Pick a book to transform">
        AI Studio will rewrite books chapter by chapter and save each result as a new version, so
        the original is never changed. Add your Anthropic API key in Settings to get ready.
      </EmptyState>
    </>
  )
}
