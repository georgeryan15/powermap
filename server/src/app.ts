import express from 'express'

import healthRoutes from './routes/health.routes'
import { errorHandler, notFound } from './middleware/error.middleware'

const app = express()

app.disable('x-powered-by')
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/', (req, res) => {
  res.json({ name: 'PowerMap API', status: 'ok' })
})

app.use('/api/v1/health', healthRoutes)

app.use(notFound)
app.use(errorHandler)

export default app
