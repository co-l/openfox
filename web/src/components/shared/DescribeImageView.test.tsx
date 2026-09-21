// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./ImageModal', () => ({
  ImageModal: () => null,
}))
vi.mock('./Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

import { DescribeImageView } from './DescribeImageView'

const PNG_SRC = 'data:image/png;base64,AAAA'

describe('DescribeImageView', () => {
  it('renders the thumbnail, the question and the vision fallback answer', () => {
    render(
      <DescribeImageView
        args={{ path: 'shot.png', question: 'What does the button say?' }}
        result='It says "Save".'
        metadata={{
          mimeType: 'image/png',
          base64Data: 'AAAA',
          dataUrl: PNG_SRC,
          path: '/w/shot.png',
          question: 'What does the button say?',
        }}
      />,
    )
    const img = screen.getByAltText('/w/shot.png') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(PNG_SRC)
    expect(screen.getByText('What does the button say?')).toBeTruthy()
    expect(screen.getByTestId('markdown').textContent).toBe('It says "Save".')
  })

  it('omits the thumbnail when no image metadata is present', () => {
    render(<DescribeImageView args={{ path: 'shot.png', question: 'Q?' }} result="A" metadata={undefined} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Q?')).toBeTruthy()
    expect(screen.getByTestId('markdown').textContent).toBe('A')
  })
})
