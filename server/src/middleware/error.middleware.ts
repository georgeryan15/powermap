import type { ErrorRequestHandler, RequestHandler } from 'express'

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`
  })
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500
  if (statusCode >= 500) console.error(err)
  const name = typeof err.name === 'string' ? err.name : 'Internal Server Error'
  const message = statusCode >= 500 ? 'Data is temporarily unavailable. Please try again.' : err instanceof Error ? err.message : 'Something went wrong'

  res.status(statusCode).json({ error: name, message })
}
