interface TerminalIconProps {
  className?: string
}

export function TerminalIcon({ className = 'w-4 h-4' }: TerminalIconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3 1h10v1H5V6zm10 7H5v1h10v-1zm-10 2H5v1h10v-1z" clipRule="evenodd" />
    </svg>
  )
}