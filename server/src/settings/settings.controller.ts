import { Controller, Get, Post, Body } from '@nestjs/common'

@Controller('api/settings')
export class SettingsController {
  constructor() {}

  /** @deprecated 流水线控制已改为任务级别，此接口仅返回固定值兼容前端 */
  @Get('pipeline')
  getPipeline() {
    return { autoMode: false }
  }

  /** @deprecated 流水线控制已改为任务级别 */
  @Post('pipeline')
  setPipeline(@Body() _body: { autoMode: boolean }) {
    return { autoMode: false }
  }
}
