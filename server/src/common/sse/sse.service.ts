import { Injectable } from '@nestjs/common'
import { Observable } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { QueueService } from '../queue/queue.service'

@Injectable()
export class SseService {
  constructor(private readonly queue: QueueService) {}

  getTaskStream(taskId?: string): Observable<MessageEvent> {
    return this.queue.events$.pipe(
      filter(e => !taskId || e.taskId === taskId),
      map(e => {
        // NestJS @Sse() expects { data: string } objects
        // Frontend EventSource.onmessage receives e.data as the string
        const data = JSON.stringify(e)
        return { data } as MessageEvent
      }),
    )
  }
}
