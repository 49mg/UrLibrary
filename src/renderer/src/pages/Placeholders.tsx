import { Sparkles } from 'lucide-react'
import { EmptyState, PageHeader } from '../components/ui'

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
