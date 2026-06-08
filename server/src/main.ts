import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { Request, Response, NextFunction } from 'express'

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') })

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  app.enableCors({
    origin: true,
    credentials: true,
  })

  // SPA fallback: serve index.html for non-API, non-asset routes
  const indexPath = path.resolve(__dirname, '..', '..', '..', 'web', 'dist', 'index.html')
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next()
    if (req.path.startsWith('/assets/')) return next()
    if (req.path.includes('.')) return next()
    res.sendFile(indexPath)
  })

  const port = parseInt(process.env.SERVER_PORT || '3000', 10)
  const host = process.env.SERVER_HOST || '0.0.0.0'
  await app.listen(port, host)
  console.log(`Server running on http://${host}:${port}`)
}

bootstrap()
