import { Router, type Request, type Response } from 'express'
import type { SessionManager } from '../session/manager.js'
import { toggleFavorite } from '../db/sessions.js'
import { serverT } from '../i18n.js'

export function registerSessionFavoriteRoute(router: Router, sessionManager: Pick<SessionManager, 'getSession'>): void {
  router.put('/sessions/:id/favorite', (req: Request, res: Response) => {
    const id = req.params['id'] as string
    const { isFavorite } = req.body
    if (typeof isFavorite !== 'boolean') {
      return res.status(400).json({
        error: serverT({
          en: 'isFavorite is required and must be a boolean',
          fr: 'isFavorite est requis et doit être un booléen',
        }),
      })
    }
    const session = sessionManager.getSession(id)
    if (!session) {
      return res.status(404).json({ error: serverT({ en: 'Session not found', fr: 'Session introuvable' }) })
    }
    toggleFavorite(id, isFavorite)
    res.json({ success: true })
  })
}
