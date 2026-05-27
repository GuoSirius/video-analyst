import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common'
import { PromptService } from './prompt.service'

@Controller('api/prompts')
export class PromptController {
  constructor(private readonly prompt: PromptService) {}

  @Get()
  getAll() { return this.prompt.getAll() }

  @Post()
  save(@Body() body: any) { return this.prompt.save(body) }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.prompt.delete(id) }
}
