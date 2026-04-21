interface TaskCheckIconProps {
  className?: string
  color?: string
}

export function TaskCheckIcon({ className = 'w-3.5 h-3.5 shrink-0', color }: TaskCheckIconProps) {
  return (
    <svg className={className} fill="none" stroke={color} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}