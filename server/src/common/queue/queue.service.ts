import { Injectable } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { v4 as uuid } from 'uuid'
import { Subject, Observable } from 'rxjs'

export interface Task {
  id: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  payload: any
  result?: any
  error?: string
  progress: number
  retries: number
  max_retries: number
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

  getPendingTasks(type?: string): Task[] {
    const sql = type
      ? "SELECT * FROM tasks WHERE status IN ('pending', 'failed') AND retries < max_retries AND type = ? ORDER BY created_at ASC"
      : "SELECT * FROM tasks WHERE status IN ('pending', 'failed') AND retries < max_retries ORDER BY created_at ASC"
    const rows = (type
      ? this.db.db.prepare(sql).all(type)
      : this.db.db.prepare(sql).all()) as any[]
    return rows.map(r => this.rowToTask(r))
  }

  getRunningTasks(): Task[] {
    const rows = this.db.db.prepare("SELECT * FROM tasks WHERE status = 'running'").all() as any[]
    return rows.map(r => this.rowToTask(r))
  }

  updateTaskStatus(id: string, status: Task['status']) {
    this.db.db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
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
    this.db.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  retryTask(id: string) {
    this.db.db.prepare(`
      UPDATE tasks SET status = 'pending', progress = 0, error = NULL, retries = 0, updated_at = datetime('now')
      WHERE id = ? AND status IN ('failed', 'completed', 'cancelled')
    `).run(id)
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
