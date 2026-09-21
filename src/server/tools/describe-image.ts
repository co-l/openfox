import { readFile, stat } from 'node:fs/promises'
import { relative } from 'node:path'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'
import { detectImageType } from './read.js'
import { computeFileHash } from './file-tracker.js'
import { describeImageFromDataUrl, isVisionFallbackFailure } from '../llm/vision-fallback.js'
import { loadResolvedVisionModel } from '../context/image-processor.js'
import { modelSupportsVision } from '../llm/profiles.js'
import { serverT } from '../i18n.js'

interface DescribeImageArgs {
  path: string
  question: string
}

/**
 * Whether the describe_image tool should be offered to the model: the active
 * model must not support vision (it already sees images directly) AND a
 * vision fallback must be configured. Fails closed when the model is unknown.
 */
export async function isDescribeImageEligible(modelName?: string): Promise<boolean> {
  if (!modelName) return false
  if (modelSupportsVision(modelName)) return false
  const visionModel = await loadResolvedVisionModel()
  return !!visionModel
}

export const describeImageTool = createTool<DescribeImageArgs>(
  'describe_image',
  {
    type: 'function',
    function: {
      name: 'describe_image',
      description: 'Ask a vision fallback model a specific question about an image file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the image file (relative to workdir or absolute)',
          },
          question: {
            type: 'string',
            description:
              'The precise detail to extract from the image (e.g. "What does the button in the top-right corner say?")',
          },
        },
        required: ['path', 'question'],
      },
    },
  },
  async (args, context, helpers) => {
    const question = String(args.question ?? '').trim()
    if (!question) {
      return helpers.error(
        serverT({
          en: 'A question is required for describe_image.',
          fr: 'Une question est requise pour describe_image.',
        }),
      )
    }

    const fullPath = helpers.resolvePath(args.path)
    await helpers.checkPathAccess([fullPath])

    // Guard: this tool only exists for non-vision models
    const activeModel = context.llmClient?.getModel()
    if (activeModel && modelSupportsVision(activeModel)) {
      return helpers.error(
        serverT({
          en: 'describe_image is only available when the active model cannot see images. The active model supports vision, so read the image directly with read_file instead.',
          fr: 'describe_image n’est disponible que lorsque le modèle actif ne voit pas les images. Le modèle actif supporte la vision : lisez plutôt l’image directement avec read_file.',
        }),
      )
    }

    // Validate the image on disk
    let size: number
    try {
      const stats = await stat(fullPath)
      size = stats.size
    } catch {
      return helpers.error(
        serverT({ en: 'File not found: {{path}}', fr: 'Fichier introuvable : {{path}}' }, { path: args.path }),
      )
    }

    if (size > OUTPUT_LIMITS.read_file.maxFileBytes) {
      return helpers.error(
        serverT(
          {
            en: 'File size ({{size}} bytes) exceeds maximum file size (20MB). Use a shell command to process large files.',
            fr: 'La taille du fichier ({{size}} octets) dépasse la taille maximale (20 Mo). Utilisez une commande shell pour traiter les fichiers volumineux.',
          },
          { size },
        ),
      )
    }

    if (size > OUTPUT_LIMITS.read_file.maxImageBytes) {
      return helpers.error(
        serverT(
          {
            en: 'File size ({{size}} bytes) exceeds image size limit (2MB). Use a shell command to process large files.',
            fr: 'La taille du fichier ({{size}} octets) dépasse la limite pour les images (2 Mo). Utilisez une commande shell pour traiter les fichiers volumineux.',
          },
          { size },
        ),
      )
    }

    const rawBuffer = await readFile(fullPath)
    const mimeType = await detectImageType(rawBuffer, args.path)
    if (!mimeType) {
      return helpers.error(
        serverT(
          {
            en: 'Not an image file: {{path}}. describe_image only works on images (PNG, JPEG, GIF, WebP, BMP, SVG).',
            fr: 'Ce n’est pas une image : {{path}}. describe_image ne fonctionne que sur des images (PNG, JPEG, GIF, WebP, BMP, SVG).',
          },
          { path: args.path },
        ),
      )
    }

    // Resolve the vision fallback model
    const visionModel = await loadResolvedVisionModel()
    if (!visionModel) {
      return helpers.error(
        serverT({
          en: 'No vision fallback is configured. Configure a vision fallback to use describe_image.',
          fr: 'Aucun fallback vision n’est configuré. Configurez un fallback vision pour utiliser describe_image.',
        }),
      )
    }

    const base64Data = rawBuffer.toString('base64')
    const dataUrl = `data:${mimeType};base64,${base64Data}`

    // Record the file read for write validation (same as read_file images)
    const contentHash = await computeFileHash(fullPath)
    if (contentHash) {
      context.sessionManager.recordFileRead(
        context.sessionId,
        fullPath,
        contentHash,
        relative(context.workdir, fullPath),
      )
    }

    const answer = await describeImageFromDataUrl(dataUrl, visionModel, {
      question,
      signal: context.signal,
    })

    // The vision fallback returns marker strings on failure rather than throwing
    if (isVisionFallbackFailure(answer)) {
      return helpers.error(answer)
    }

    return helpers.success(answer, false, {
      metadata: {
        mimeType,
        size,
        base64Data,
        dataUrl,
        path: fullPath,
        question,
        description: answer,
      },
    })
  },
)
