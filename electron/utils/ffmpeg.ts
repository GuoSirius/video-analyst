import { execFile, spawn } from 'child_process'

// 使用 shell 执行命令（可以正确获取 PATH）
async function execShell(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let shell: string
    let shellFlag: string
    
    if (process.platform === 'win32') {
      // Windows 下使用 PowerShell，可以正确获取用户 PATH
      shell = 'powershell'
      shellFlag = '-Command'
    } else {
      shell = '/bin/sh'
      shellFlag = '-c'
    }
    
    execFile(shell, [shellFlag, command], { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '' })
      }
    })
  })
}

// 检查 ffmpeg 是否可用
export async function checkFfmpeg(): Promise<boolean> {
  try {
    console.log('[FFmpeg] Checking ffmpeg availability...')
    
    if (process.platform === 'win32') {
      const result = await execShell('ffmpeg -version')
      console.log('[FFmpeg] Result:', result.stdout.substring(0, 100))
    } else {
      await execShell('which ffmpeg && ffmpeg -version')
    }
    return true
  } catch (error) {
    console.error('[FFmpeg] Not found:', error)
    return false
  }
}

// 从视频文件中提取音频
export async function extractAudio(
  inputPath: string,
  outputPath: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 使用 PowerShell 执行以正确获取用户 PATH
    const shell = process.platform === 'win32' ? 'powershell' : '/bin/sh'
    const shellFlag = process.platform === 'win32' ? '-Command' : '-c'
    
    const ffmpegCmd = `ffmpeg -i "${inputPath}" -vn -acodec libmp3lame -ab 192k -ar 44100 -y "${outputPath}"`

    const proc = spawn(shell, [shellFlag, ffmpegCmd], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderrData = ''
    proc.stderr?.on('data', (data: Buffer) => {
      stderrData += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(outputPath)
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderrData}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })

    // 解析进度
    if (onProgress) {
      let totalDuration = 0
      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/)
        if (durationMatch && totalDuration === 0) {
          const [, hours, minutes, seconds] = durationMatch
          totalDuration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)
        }
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
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' ? 'powershell' : '/bin/sh'
    const shellFlag = process.platform === 'win32' ? '-Command' : '-c'
    
    // ffmpeg whisper 需要明确指定音频流，使用 -map 0:a 选择第一个音频流
    const ffmpegCmd = `ffmpeg -i "${audioPath}" -map 0:a -af "whisper=model=base" -f srt -`

    console.log('[Whisper] Running command:', ffmpegCmd)

    const proc = spawn(shell, [shellFlag, ffmpegCmd], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let srtData = ''
    proc.stdout?.on('data', (data: Buffer) => {
      srtData += data.toString()
    })

    let stderrData = ''
    proc.stderr?.on('data', (data: Buffer) => {
      stderrData += data.toString()
    })

    proc.on('close', async (code) => {
      console.log('[Whisper] Exit code:', code)
      console.log('[Whisper] SRT data length:', srtData.length)
      
      if (srtData && srtData.length > 0) {
        // 将 SRT 格式转换为纯文本
        const text = convertSrtToText(srtData)
        // 使用 fs 写入文件
        const fs = await import('fs/promises')
        await fs.writeFile(outputPath, text, 'utf-8')
        resolve(outputPath)
      } else {
        reject(new Error(`ffmpeg whisper failed (exit code ${code}). Make sure you have downloaded whisper models.\n\nError: ${stderrData.substring(0, 500)}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })

    // 进度解析
    if (onProgress) {
      let totalDuration = 0
      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/)
        if (durationMatch && totalDuration === 0) {
          const [, hours, minutes, seconds] = durationMatch
          totalDuration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)
        }
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

// SRT 字幕格式转纯文本
function convertSrtToText(srt: string): string {
  const lines = srt.split('\n')
  const textLines: string[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    // 跳过序号和时间码
    if (!trimmed || /^\d+$/.test(trimmed) || /^\d{2}:\d{2}:\d{2}/.test(trimmed)) {
      continue
    }
    textLines.push(trimmed)
  }
  
  return textLines.join('\n')
}

// 转录音频文件，返回转录文字（用于云端 API 模式）
export async function transcribeAudio(
  audioPath: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' ? 'powershell' : '/bin/sh'
    const shellFlag = process.platform === 'win32' ? '-Command' : '-c'
    
    // 使用 whisper 滤镜转录音频
    const ffmpegCmd = `ffmpeg -i "${audioPath}" -map 0:a -af "whisper=model=base" -f srt -`

    console.log('[Whisper] Running transcription:', ffmpegCmd)

    const proc = spawn(shell, [shellFlag, ffmpegCmd], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let srtData = ''
    proc.stdout?.on('data', (data: Buffer) => {
      srtData += data.toString()
    })

    let stderrData = ''
    proc.stderr?.on('data', (data: Buffer) => {
      stderrData += data.toString()
    })

    proc.on('close', (code) => {
      console.log('[Whisper] Transcription exit code:', code)
      
      if (srtData && srtData.length > 0) {
        // 将 SRT 格式转换为纯文本
        const text = convertSrtToText(srtData)
        resolve(text)
      } else {
        reject(new Error(`转录失败 (exit code ${code})。请确保已下载 whisper 模型。\n\n${stderrData.substring(0, 500)}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })

    // 进度解析
    if (onProgress) {
      let totalDuration = 0
      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString()
        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/)
        if (durationMatch && totalDuration === 0) {
          const [, hours, minutes, seconds] = durationMatch
          totalDuration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)
        }
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
