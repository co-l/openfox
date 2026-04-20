import { Modal } from './Modal'

interface ImageModalProps {
  src: string
  alt: string
  isOpen: boolean
  onClose: () => void
}

export function ImageModal({ src, alt, isOpen, onClose }: ImageModalProps) {
  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="full">
      <div className="flex items-center justify-center h-full">
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
        />
      </div>
    </Modal>
  )
}
