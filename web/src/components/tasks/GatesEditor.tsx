import { useState, useEffect } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { Input } from '../shared/Input'
import { PlusIcon, TrashIcon } from '../shared/icons'
import { SaveCancelButtons } from '../shared/SaveCancelButtons'
import { useTasksStore } from '../../stores/tasks'
import { useResource } from '../../hooks/useResource'
import { boardResource } from '../../lib/resources'
import type { TaskGateConfig } from '@shared/types.js'
import { useT } from '../../hooks/useT'

interface GatesEditorProps {
  projectId: string
  onClose: () => void
}

const NEW_GATE_ID = () => `gate_${crypto.randomUUID().slice(0, 8)}`

export function GatesEditor({ projectId, onClose }: GatesEditorProps) {
  const t = useT()
  const { data: board } = useResource(boardResource, projectId)
  const gates = board?.gates ?? []
  const setGateConfig = useTasksStore((state) => state.setGateConfig)
  const [localGates, setLocalGates] = useState<TaskGateConfig[]>([])
  const [saving, setSaving] = useState(false)

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
      title={t({ en: 'Definition of Done', fr: 'Définition de Terminé' })}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-text-muted">
            {t({
              en: 'Gates define what a task must carry before it may enter',
              fr: 'Les portes définissent ce qu’une tâche doit comporter avant d’entrer dans',
            })}{' '}
            <strong>{t({ en: 'Done', fr: 'Terminé' })}</strong>.{' '}
            {t({
              en: 'Values are set by you or the agent, each recorded with actor + timestamp.',
              fr: 'Les valeurs sont définies par vous ou l’agent, chacune enregistrée avec acteur + horodatage.',
            })}
          </p>
          <SaveCancelButtons
            onCancel={onClose}
            onSave={() => void save()}
            saving={saving}
            saveLabel={t({ en: 'Save gates', fr: 'Enregistrer les portes' })}
          />
        </div>
      }
    >
      <div className="space-y-3">
        {localGates.length === 0 && (
          <p className="text-sm text-text-muted">
            {t({
              en: 'No gates configured — any task can move straight to Done. Add a gate like “all green” (every criterion passes with evidence) or “commit” (work committed with a commit reference).',
              fr: 'Aucune porte configurée — toute tâche peut passer directement à Terminé. Ajoutez une porte comme « all green » (chaque critère passe avec preuve) ou « commit » (travail validé avec une référence de commit).',
            })}
          </p>
        )}

        {localGates.map((gate, index) => (
          <div key={gate.id} className="border border-border rounded-lg p-3 space-y-2 bg-bg-tertiary/40">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={gate.name}
                onChange={(e) => updateGate(index, { name: e.target.value })}
                placeholder={t({
                  en: 'Gate name, e.g. “all green” or “commit”',
                  fr: 'Nom de la porte, ex. « all green » ou « commit »',
                })}
                className="flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => removeGate(index)}
                className="p-1.5 rounded hover:bg-accent-error/10 text-text-muted hover:text-accent-error transition-colors"
                title={t({ en: 'Remove gate', fr: 'Supprimer la porte' })}
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={gate.description}
              onChange={(e) => updateGate(index, { description: e.target.value })}
              rows={2}
              placeholder={t({
                en: 'What counts as acceptable proof? e.g. “every acceptance criterion passes with evidence, or work is committed with a commit SHA”',
                fr: 'Qu’est-ce qui compte comme preuve acceptable ? ex. « chaque critère d’acceptation passe avec preuve, ou le travail est validé avec un SHA de commit »',
              })}
              className="w-full px-2.5 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary resize-y"
            />
            <div className="flex items-center gap-4 text-sm text-text-muted">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={gate.required}
                  onChange={(e) => updateGate(index, { required: e.target.checked })}
                />
                {t({ en: 'Required', fr: 'Requise' })}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`variant-${gate.id}`}
                  checked={gate.variant === 'done'}
                  onChange={() => updateGate(index, { variant: 'done' })}
                />
                {t({ en: 'Blocks Done', fr: 'Bloque Terminé' })}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`variant-${gate.id}`}
                  checked={gate.variant === 'ready'}
                  onChange={() => updateGate(index, { variant: 'ready' })}
                />
                {t({ en: 'Definition of ready (blocks In Progress)', fr: 'Définition de prêt (bloque En cours)' })}
              </label>
            </div>
          </div>
        ))}

        <Button onClick={addGate}>
          <PlusIcon className="w-3.5 h-3.5 mr-1 inline-block" /> {t({ en: 'Add gate', fr: 'Ajouter une porte' })}
        </Button>
      </div>
    </Modal>
  )
}
