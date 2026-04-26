import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

// 获取 ffmpeg 路径
function getFfmpegPath(): string {
  // 生产环境下，ffmpeg 应该打包在资源目录中
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ffmpeg.exe')
  }
  // 开发环境下，假设 ffmpeg 在系统 PATH 中
  return 'ffmpeg'
}

// 检查 ffmpeg 是否可用
export async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync(getFfmpegPath(), ['-version'])
    return true
  } catch (error) {
    console.error('ffmpeg not found:', error)
    return false
  }
}

// 从视频文件中提取音频
export async function extractAudio(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const ffmpegPath = getFfmpegPath()

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-vn', // 禁用视频
      '-acodec', 'libmp3lame', // 音频编码器为 MP3
      '-ab', '192k', // 比特率
      '-ar', '44100', // 采样率
      '-y', // 覆盖输出文件
      outputPath
    ]

    const proc = execFile(ffmpegPath, args, (error, _stdout, _stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve(outputPath)
      }
    })

    // 解析 ffmpeg 进度（可选）
    if (onProgress && proc.stderr) {
      let totalDuration = 0
      proc.stderr.on('data', (data: Buffer) => {
        const output = data.toString()
        // 解析持续时间
        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/)
        if (durationMatch) {
          const [, hours, minutes, seconds] = durationMatch
          totalDuration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)
        }

        // 解析当前时间
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/)
        if (timeMatch && totalDuration > 0) {
          const [, hours, minutes, seconds] = timeMatch
          const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)
          const progress = Math.round((currentTime / totalDuration) * 100)
          onProgress(Math.min(progress, 100))
        }
      })
    }
  })
}

// 使用 ffmpeg whisper 模块进行本地语音转文字（需要 ffmpeg 8.0+）
export async function transcribeWithLocalWhisper(
  audioPath: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  const ffmpegPath = getFfmpegPath()

  return new Promise((resolve, reject) => {
    const args = [
      '-i', audioPath,
      '-af', 'whisper=model=base', // 使用 whisper 过滤器
      '-y',
      outputPath
    ]

    const proc = execFile(ffmpegPath, args, (error, _stdout, _stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve(outputPath)
      }
    })

    // 进度解析（可选）
    if (onProgress && proc.stderr) {
      // 类似 extractAudio 的进度解析
    }
  })
}
