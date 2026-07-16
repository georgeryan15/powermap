import app from './app'
import config from './config'

const server = app.listen(config.port, () => {
  console.log(`PowerMap API listening on port ${config.port}`)
})

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`${signal} received. Shutting down gracefully.`)
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
