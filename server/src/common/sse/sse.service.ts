import { Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { QueueService, TaskEvent } from '../queue/queue.service'

@Injectable()
export class SseService {
  constructor(private readonly queue: QueueService) {}

  getTaskStream(taskId?: string): Observable<MessageEvent> {
    return this.queue.events$.pipe(
      filter(e => !taskId || e.taskId === taskId),
      map(e => {
        const data = JSON.stringify(e)
        return { data } as MessageEvent
      }),
    )
  }
}
