import { useState, useEffect } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { PlusIcon, TrashIcon } from '../shared/icons'
import { useTasksStore } from '../../stores/tasks'
import type { TaskGateConfig } from '@shared/types.js'

interface GatesEditorProps {
  projectId: string
  onClose: () => void
}

const NEW_GATE_ID = () => `gate_${crypto.randomUUID().slice(0, 8)}`

export function GatesEditor({ projectId, onClose }: GatesEditorProps) {
  const gates = useTasksStore((state) => state.gates)
  const loadGates = useTasksStore((state) => state.loadGates)
  const setGateConfig = useTasksStore((state) => state.setGateConfig)
  const [localGates, setLocalGates] = useState<TaskGateConfig[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void loadGates(projectId)
  }, [projectId, loadGates])

  useEffect(() => {
    setLocalGates(gates)
  }, [gates])

  const updateGate = (index: number, patch: Partial<TaskGateConfig>) => {
    setLocalGates((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)))
  }

  const addGate = () => {
    setLocalGates((prev) => [
      ...prev,
      { id: NEW_GATE_ID(), name: '', description: '', required: true, variant: 'done' },
    ])
  }

  const removeGate = (index: number) => {
    setLocalGates((prev) => prev.filter((_, i) => i !== index))
  }

  const save = async () => {
    const clean = localGates
      .filter((g) => g.name.trim().length > 0)
      .map((g, i) => ({ ...g, id: g.id || `gate_${i}`, name: g.name.trim() }))
    setSaving(true)
    await setGateConfig(projectId, clean)
    setSaving(false)
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Definition of Done"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-text-muted">
            Gates define what a task must carry before it may enter <strong>Done</strong>. Values are set by you or the
            agent, each recorded with actor + timestamp.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save gates'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {localGates.length === 0 && (
          <p className="text-sm text-text-muted">
            No gates configured — any task can move straight to Done. Add a gate like “all green” (every criterion
            passes with evidence) or “commit” (work committed with a commit reference).
          </p>
        )}

        {localGates.map((gate, index) => (
          <div key={gate.id} className="border border-border rounded-lg p-3 space-y-2 bg-bg-tertiary/40">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={gate.name}
                onChange={(e) => updateGate(index, { name: e.target.value })}
                placeholder="Gate name, e.g. “all green” or “commit”"
                className="flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => removeGate(index)}
                className="p-1.5 rounded hover:bg-accent-error/10 text-text-muted hover:text-accent-error transition-colors"
                title="Remove gate"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={gate.description}
              onChange={(e) => updateGate(index, { description: e.target.value })}
              rows={2}
              placeholder="What counts as acceptable proof? e.g. “every acceptance criterion passes with evidence, or work is committed with a commit SHA”"
              className="w-full px-2.5 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary resize-y"
            />
            <div className="flex items-center gap-4 text-sm text-text-muted">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={gate.required}
                  onChange={(e) => updateGate(index, { required: e.target.checked })}
                />
                Required
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`variant-${gate.id}`}
                  checked={gate.variant === 'done'}
                  onChange={() => updateGate(index, { variant: 'done' })}
                />
                Blocks Done
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`variant-${gate.id}`}
                  checked={gate.variant === 'ready'}
                  onChange={() => updateGate(index, { variant: 'ready' })}
                />
                Definition of ready (blocks In Progress)
              </label>
            </div>
          </div>
        ))}

        <Button onClick={addGate}>
          <PlusIcon className="w-3.5 h-3.5 mr-1 inline-block" /> Add gate
        </Button>
      </div>
    </Modal>
  )
}
