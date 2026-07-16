import type { Request, Response } from 'express'

export const getHealth = (req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    service: 'powermap-api',
    timestamp: new Date().toISOString()
  })
}
