interface TasksIconProps {
  className?: string
}

export function TasksIcon({ className = 'w-5 h-5' }: TasksIconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4.5" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <rect x="3" y="10.5" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <rect x="3" y="16.5" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <path d="M10 6.75h11" />
      <path d="M10 12.75h8" />
      <path d="M10 18.75h9" />
    </svg>
  )
}
