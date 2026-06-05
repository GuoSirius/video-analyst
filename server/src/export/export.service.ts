import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../common/database/database.service'
import * as ExcelJS from 'exceljs'
import * as path from 'path'
import * as fs from 'fs'

export interface ExportOptions {
  columns: string[]
  itemIds?: string[]
  includeTranscriptions?: boolean
  includeAIResults?: boolean
}

@Injectable()
export class ExportService {
  constructor(private readonly db: DatabaseService) {}

  async exportToExcel(options: ExportOptions): Promise<string> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Results')

    const { columns, itemIds } = options
    sheet.columns = columns.map(col => ({ header: col, key: col, width: 20 }))

    // Build query
    let sql = `
      SELECT
        ci.id, ci.title, ci.source_url, ci.media_url, ci.media_source, ci.extra_data,
        t.content as transcription, t.language, t.duration,
        ar.result as ai_result, ar.model as ai_model, ar.prompt as ai_prompt
      FROM crawl_items ci
      LEFT JOIN transcriptions t ON t.item_id = ci.id
      LEFT JOIN ai_results ar ON ar.transcription_id = t.id
    `

    const params: string[] = []
    if (itemIds?.length) {
      sql += ` WHERE ci.id IN (${itemIds.map(() => '?').join(',')})`
      params.push(...itemIds)
    }
    sql += ' ORDER BY ci.created_at DESC'

    const rows = this.db.db.prepare(sql).all(...params) as any[]

    for (const row of rows) {
      const rowData: Record<string, any> = {}
      for (const col of columns) {
        rowData[col] = row[col] ?? ''
      }
      sheet.addRow(rowData)
    }

    const exportDir = path.resolve(process.cwd(), '..', 'data', 'exports')
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true })
    }

    const filename = `export_${Date.now()}.xlsx`
    const filePath = path.join(exportDir, filename)
    await workbook.xlsx.writeFile(filePath)

    return filePath
  }

  async getAvailableColumns(): Promise<string[]> {
    return [
      'id',
      'title',
      'source_url',
      'media_url',
      'media_source',
      'transcription',
      'language',
      'duration',
      'ai_result',
      'ai_model',
      'ai_prompt',
    ]
  }
}
