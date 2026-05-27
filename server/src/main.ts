import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') })

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.enableCors({
    origin: true,
    credentials: true,
  })

  const port = parseInt(process.env.SERVER_PORT || '3000', 10)
  const host = process.env.SERVER_HOST || '0.0.0.0'
  await app.listen(port, host)
  console.log(`Server running on http://${host}:${port}`)
}

bootstrap()
