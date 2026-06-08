import { Global, Module } from '@nestjs/common'
import { QueueService } from './queue.service'
import { TasksController } from './tasks.controller'

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
  controllers: [TasksController],
})
export class QueueModule {}
