import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { v4 as uuid } from 'uuid'
import { Subject, Observable } from 'rxjs'

export interface Task {
  id: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  payload: any
  result?: any
  error?: string
  progress: number
  retries: number
  max_retries: number
  started_at?: string
  created_at: string
  updated_at: string
}

export interface TaskEvent {
  taskId: string
  type: string
  status: string
  progress: number
  result?: any
  error?: string
  started_at?: string
  updated_at?: string
}

@Injectable()
export class QueueService {
  private eventSubject = new Subject<TaskEvent>()

  constructor(private readonly db: DatabaseService) {}

  get events$(): Observable<TaskEvent> {
    return this.eventSubject.asObservable()
  }

  createTask(type: string, payload: any, maxRetries = 3): Task {
    const id = uuid()
    const stmt = this.db.db.prepare(`
      INSERT INTO tasks (id, type, payload, max_retries) VALUES (?, ?, ?, ?)
    `)
    stmt.run(id, type, JSON.stringify(payload), maxRetries)
    return this.getTask(id)!
  }

  getTask(id: string): Task | undefined {
    const row = this.db.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any
    if (!row) return undefined
    return this.rowToTask(row)
  }

  getTasksByType(type: string): Task[] {
    const rows = this.db.db.prepare('SELECT * FROM tasks WHERE type = ? ORDER BY created_at DESC').all(type) as any[]
    return rows.map(r => this.rowToTask(r))
  }

  getAllTasks(): Task[] {
    const rows = this.db.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as any[]
    return rows.map(r => this.rowToTask(r))
  }

  updateTaskStatus(id: string, status: Task['status']) {
    if (status === 'running') {
      this.db.db.prepare(
        "UPDATE tasks SET status = ?, started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?"
      ).run(status, id)
    } else {
      this.db.db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
    }
    this.emitEvent(id)
  }

  updateTaskProgress(id: string, progress: number) {
    this.db.db.prepare("UPDATE tasks SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(progress, id)
    this.emitEvent(id)
  }

  updateTaskResult(id: string, result: any) {
    this.db.db.prepare("UPDATE tasks SET result = ?, status = 'completed', progress = 100, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(result), id)
    this.emitEvent(id)
  }

  updateTaskError(id: string, error: string) {
    const task = this.getTask(id)
    if (!task) return
    const newRetries = task.retries + 1
    const newStatus = newRetries >= task.max_retries ? 'failed' : 'pending'
    this.db.db.prepare("UPDATE tasks SET error = ?, retries = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(error, newRetries, newStatus, id)
    this.emitEvent(id)
  }

  cancelTask(id: string) {
    this.db.db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(id)
    this.emitEvent(id)
  }

  deleteTask(id: string) {
    // Only allow deleting tasks in terminal or not-started states
    const task = this.getTask(id)
    if (!task) return
    if (task.status === 'running' || task.status === 'paused') {
      throw new Error(`Cannot delete task in "${task.status}" status`)
    }
    // Emit event before deletion so subscribers are notified
    this.db.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    this.eventSubject.next({
      taskId: task.id,
      type: task.type,
      status: 'deleted' as any,
      progress: task.progress,
      result: task.result,
      error: task.error,
    })
  }

  batchDeleteTasks(ids: string[]) {
    const results: { id: string; ok: boolean; error?: string }[] = []
    const deleteStmt = this.db.db.prepare('DELETE FROM tasks WHERE id = ?')
    for (const id of ids) {
      const task = this.getTask(id)
      if (!task) { results.push({ id, ok: false, error: 'Task not found' }); continue }
      if (task.status === 'running' || task.status === 'paused') {
        results.push({ id, ok: false, error: `Cannot delete task in "${task.status}" status` }); continue
      }
      deleteStmt.run(id)
      this.eventSubject.next({
        taskId: task.id,
        type: task.type,
        status: 'deleted' as any,
        progress: task.progress,
        result: task.result,
        error: task.error,
      })
      results.push({ id, ok: true })
    }
    return results
  }

  retryTask(id: string) {
    this.db.db.prepare(`
      UPDATE tasks SET status = 'pending', progress = 0, error = NULL, retries = 0, started_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND status IN ('failed', 'completed', 'cancelled')
    `).run(id)
    this.emitEvent(id)
  }

  pauseTask(id: string) {
    this.db.db.prepare("UPDATE tasks SET status = 'paused', updated_at = datetime('now') WHERE id = ? AND status = 'running'").run(id)
    this.emitEvent(id)
  }

  reRunTask(id: string) {
    this.db.db.prepare('DELETE FROM crawl_items WHERE task_id = ?').run(id)
    this.db.db.prepare(`
      UPDATE tasks SET status = 'pending', progress = 0, error = NULL, retries = 0, result = NULL, started_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND status IN ('failed', 'completed', 'cancelled', 'paused')
    `).run(id)
    this.emitEvent(id)
  }

  updateTaskPayload(id: string, payload: any) {
    this.db.db.prepare("UPDATE tasks SET payload = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(payload), id)
    this.emitEvent(id)
  }

  private emitEvent(taskId: string) {
    const task = this.getTask(taskId)
    if (task) {
      this.eventSubject.next({
        taskId: task.id,
        type: task.type,
        status: task.status,
        progress: task.progress,
        result: task.result,
        error: task.error,
        started_at: task.started_at,
        updated_at: task.updated_at,
      })
    }
  }

  private rowToTask(row: any): Task {
    return {
      ...row,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : undefined,
    }
  }
}
