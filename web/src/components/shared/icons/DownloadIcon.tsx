interface DownloadIconProps {
  className?: string
}

export function DownloadIcon({ className = 'w-4 h-4' }: DownloadIconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5a.75.75 0 0 1 .75.75v6.69l2.22-2.22a.75.75 0 1 1 1.06 1.06L8 10.56 3.97 7.78a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5ZM2.5 10.75a.75.75 0 0 1 .75.75v1.5h9.5v-1.5a.75.75 0 0 1 1.5 0v2.25a.75.75 0 0 1-.75.75h-11a.75.75 0 0 1-.75-.75v-2.25a.75.75 0 0 1 .75-.75Z" />
    </svg>
  )
}
