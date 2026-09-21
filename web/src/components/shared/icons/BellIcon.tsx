import { IconBase } from './IconBase'

export function BellIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2c0 .5-.2 1-.6 1.4L4 17h11Zm0 0a3 3 0 0 1-6 0"
      />
    </IconBase>
  )
}
