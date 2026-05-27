import { Controller, Get, Post, Body } from '@nestjs/common'
import { PipelineService } from '../common/pipeline/pipeline.service'

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get('pipeline')
  getPipeline() {
    return this.pipeline.getStatus()
  }

  @Post('pipeline')
  setPipeline(@Body() body: { autoMode: boolean }) {
    this.pipeline.setAutoMode(body.autoMode)
    return this.pipeline.getStatus()
  }
}
