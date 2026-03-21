interface SummaryDisplayProps {
  summary: string | null
}

export function SummaryDisplay({ summary }: SummaryDisplayProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text-primary">Summary</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {summary ? (
          <p className="text-sm text-text-primary leading-relaxed">{summary}</p>
        ) : (
          <div className="text-text-muted text-sm text-center py-2">
            No summary yet
          </div>
        )}
      </div>
    </div>
  )
}
