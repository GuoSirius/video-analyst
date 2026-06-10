import { Injectable } from '@nestjs/common'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs'

const execAsync = promisify(exec)

@Injectable()
export class TranscoderService {
  private ffmpegPath: string

  constructor() {
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
  }

  getFfmpegPath(): string {
    return this.ffmpegPath
  }

  async checkFfmpeg(): Promise<{ found: boolean; version?: string }> {
    try {
      const { stdout } = await execAsync(`"${this.ffmpegPath}" -version`)
      const match = stdout.match(/ffmpeg version (\S+)/)
      return { found: true, version: match?.[1] }
    } catch {
      return { found: false }
    }
  }

  async transcode(inputPath: string, outputDir: string, onProgress?: (pct: number) => void): Promise<string> {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`File not found: ${inputPath}`)
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const basename = path.basename(inputPath, path.extname(inputPath))
    const outputPath = path.join(outputDir, `${basename}.wav`)

    // Get duration for progress
    let totalDuration = 0
    try {
      const { stdout } = await execAsync(
        `"${this.ffmpegPath}" -i "${inputPath}" -f null - 2>&1`,
      )
      const durMatch = stdout.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/)
      if (durMatch) {
        totalDuration =
          parseInt(durMatch[1]) * 3600 +
          parseInt(durMatch[2]) * 60 +
          parseInt(durMatch[3]) +
          parseInt(durMatch[4]) / 100
      }
    } catch {
      // ffmpeg exits with code 1 on -f null, but still outputs duration
    }

    return new Promise((resolve, reject) => {
      // Probe for duration more reliably
      const probeArgs = [
        '-i', `"${inputPath}"`,
        '-ar', '16000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        '-progress', 'pipe:1',
        '-nostats',
        '-y',
        `"${outputPath}"`,
      ]

      const ffmpeg = exec(
        `"${this.ffmpegPath}" ${probeArgs.join(' ')}`,
        { maxBuffer: 10 * 1024 * 1024 },
        (err) => {
          if (err && !err.message?.includes('FFmpeg')) {
            reject(err)
          } else {
            resolve(outputPath)
          }
        },
      )

      if (onProgress && totalDuration > 0) {
        ffmpeg.stderr?.on('data', (data: string) => {
          const timeMatch = data.match(/time=(\d+):(\d+):(\d+)\.(\d+)/)
          if (timeMatch) {
            const seconds =
              parseInt(timeMatch[1]) * 3600 +
              parseInt(timeMatch[2]) * 60 +
              parseInt(timeMatch[3]) +
              parseInt(timeMatch[4]) / 100
            const pct = Math.min(Math.round((seconds / totalDuration) * 100), 99)
            onProgress(pct)
          }
        })
      } else if (onProgress) {
        // Fallback: emit progress updates based on duration estimate
        let elapsed = 0
        const interval = setInterval(() => {
          elapsed += 500
          const pct = totalDuration > 0
            ? Math.min(Math.round((elapsed / 1000 / totalDuration) * 100), 99)
            : Math.min(elapsed / 100, 99)
          if (pct < 100) onProgress(pct)
        }, 500)
        ffmpeg.on('close', () => clearInterval(interval))
      }
    })
  }

  scanDirectory(dirPath: string): string[] {
    const files: string[] = []
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus',
                       '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.wmv', '.m4v']
    const mediaDir = path.resolve(process.cwd(), '..', 'data', 'media')
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true })
    }

    const walkDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else if (audioExts.includes(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath)
        }
      }
    }

    walkDir(dirPath)
    return files
  }
}
