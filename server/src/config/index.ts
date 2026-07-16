const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000
} as const

export default config
