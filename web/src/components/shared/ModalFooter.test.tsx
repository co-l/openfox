// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModalFooter } from './ModalFooter'
import { setLocale } from '@shared/i18n/index.js'

function renderFooter(props: Partial<Parameters<typeof ModalFooter>[0]> = {}) {
  const onCancel = vi.fn()
  const onSave = vi.fn()
  render(<ModalFooter onCancel={onCancel} onSave={onSave} saving={false} {...props} />)
  return { onCancel, onSave }
}

describe('ModalFooter', () => {
  beforeEach(() => {
    setLocale('en')
  })

  it('renders English labels by default', () => {
    renderFooter()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('renders English saving state', () => {
    renderFooter({ saving: true })
    const save = screen.getByRole('button', { name: 'Saving...' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders French labels in fr locale', () => {
    setLocale('fr')
    renderFooter()
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('renders French saving state in fr locale', () => {
    setLocale('fr')
    renderFooter({ saving: true })
    const save = screen.getByRole('button', { name: 'Enregistrement…' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets cancelLabel and saveLabel override the defaults', () => {
    setLocale('fr')
    renderFooter({ cancelLabel: 'Reculer', saveLabel: 'Baptiser' })
    expect(screen.getByRole('button', { name: 'Reculer' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Baptiser' })).toBeTruthy()
  })

  it('wires the buttons to onCancel and onSave', async () => {
    const user = userEvent.setup()
    const { onCancel, onSave } = renderFooter()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('respects saveDisabled', () => {
    renderFooter({ saveDisabled: true })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
