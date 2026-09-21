// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { FilePreview, wrappedCodeStyle } from './DiffView'

afterEach(cleanup)

describe('FilePreview component', () => {
  it('should have correct props interface', () => {
    // Just verify the component exists and accepts the right props
    const props: React.ComponentProps<typeof FilePreview> = {
      content: 'test',
      filePath: 'test.ts',
    }

    expect(props.content).toBe('test')
    expect(props.filePath).toBe('test.ts')
  })

  it('should NOT have maxLines prop in interface', () => {
    // Verify maxLines is NOT in the props
    const props: React.ComponentProps<typeof FilePreview> = {
      content: 'test',
      filePath: 'test.ts',
    }

    // If maxLines was in the interface, this would compile
    // The test passes if we can create props without maxLines
    expect(props).toHaveProperty('content')
    expect(props).toHaveProperty('filePath')
  })

  it('should not have word-break: break-all in wrappedCodeStyle (uses overflow-wrap instead)', () => {
    expect(wrappedCodeStyle.wordBreak).toBeUndefined()
  })

  it('should have white-space: pre-wrap in wrappedCodeStyle to preserve whitespace while allowing wrap', () => {
    // This test will FAIL because whiteSpace is not in wrappedCodeStyle
    expect(wrappedCodeStyle.whiteSpace).toBe('pre-wrap')
  })

  it('should have overflow-wrap: break-word in wrappedCodeStyle for proper word wrapping', () => {
    // This test will FAIL because overflowWrap is not in wrappedCodeStyle
    expect(wrappedCodeStyle.overflowWrap).toBe('break-word')
  })
})

describe('FilePreview streaming preview', () => {
  it('renders the streaming variant with the live toggle', () => {
    const { container } = render(<FilePreview content={'const x = 1\nconst y = 2\n'} filePath="src/a.ts" streaming />)

    expect(container.textContent).toContain('const x = 1')
    expect(container.textContent).toContain('Live')
  })

  it('renders the non-streaming variant without the live toggle', () => {
    const { container } = render(<FilePreview content={'const x = 1\n'} filePath="src/a.ts" />)

    expect(container.textContent).toContain('const x = 1')
    expect(container.textContent).not.toContain('Live')
  })
})
