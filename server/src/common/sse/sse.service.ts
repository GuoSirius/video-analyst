import { Injectable } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import { QueueService, TaskEvent } from '../queue/queue.service'

@Injectable()
export class SseService {
  private genericEvents$ = new Subject<any>()

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

  /** Emit a generic event (for downloads, etc.) */
  emitEvent(type: string, data: any) {
    this.genericEvents$.next({ type, ...data })
  }

  /** Get stream for generic events (download events) */
  getGenericStream(): Observable<MessageEvent> {
    return this.genericEvents$.pipe(
      map(e => ({ data: JSON.stringify(e) } as MessageEvent)),
    )
  }
}
