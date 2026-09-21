interface UploadIconProps {
  className?: string
}

export function UploadIcon({ className = 'w-4 h-4' }: UploadIconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 14.5a.75.75 0 0 1-.75-.75V7.06L5.03 9.28a.75.75 0 1 1-1.06-1.06L8 4.44l4.03 3.78a.75.75 0 1 1-1.06 1.06L8.75 7.06v6.69a.75.75 0 0 1-.75.75ZM2.5 1.75h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1 0-1.5Z" />
    </svg>
  )
}
