import { Controller, Get, Query } from '@nestjs/common'
import { QueueService } from './queue.service'

@Controller('api/tasks')
export class TasksController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  getTasks(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    let tasks = type
      ? this.queue.getTasksByType(type)
      : this.queue.getAllTasks()

    // Filter by status
    if (status && status !== 'all') {
      tasks = tasks.filter(t => t.status === status)
    }

    // Filter by source (for transcode tasks)
    if (source && source !== 'all') {
      tasks = tasks.filter(t => (t.payload?.source || 'upload') === source)
    }

    // Filter by keyword (match file name / URL)
    if (keyword) {
      const kw = keyword.toLowerCase()
      tasks = tasks.filter(t => {
        const fileName = t.payload?.fileName || t.payload?.file || t.payload?.filePath || t.payload?.url || ''
        return fileName.toLowerCase().includes(kw)
      })
    }

    // Pagination
    const p = Math.max(1, parseInt(page || '1', 10) || 1)
    const ps = Math.min(500, Math.max(1, parseInt(pageSize || '20', 10) || 20))
    const total = tasks.length
    const start = (p - 1) * ps
    const items = tasks.slice(start, start + ps)

    return { items, total, page: p, pageSize: ps }
  }
}
