import { Controller, Post, Get, Body, Res } from '@nestjs/common'
import { Response } from 'express'
import { ExportService, ExportOptions } from './export.service'

@Controller('api/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('columns')
  getColumns() {
    return this.exportService.getAvailableColumns()
  }

  @Post('excel')
  async exportExcel(@Body() options: ExportOptions, @Res() res: Response) {
    const filePath = await this.exportService.exportToExcel(options)
    res.download(filePath)
  }
}
