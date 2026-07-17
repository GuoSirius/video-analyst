import api from '../client'

export const crawlerAPI = {
  start: (payload: any) => api.post('/crawler/crawl', payload),
  getTasks: (keyword?: string) => api.get('/crawler/tasks', keyword ? { params: { keyword } } : {}),
  getTasksWithPagination: (params?: { status?: string; keyword?: string; page?: number; pageSize?: number }) => api.get('/crawler/tasks/paginated', { params }),
  getSources: () => api.get('/crawler/sources'),
  getItems: (params?: {
    taskId?: string
    status?: string
    mediaSource?: string
    keyword?: string
    page?: number
    pageSize?: number
  }) => api.get('/crawler/items', { params }),
  deleteItem: (id: string) => api.delete(`/crawler/items/${id}`),
  retryItem: (id: string) => api.post(`/crawler/items/${id}/retry`),
  recrawlItem: (id: string) => api.post(`/crawler/items/${id}/recrawl`),
  getItemCounts: () => api.get('/crawler/items/counts'),
  clearItems: (id: string) => api.post(`/crawler/tasks/${id}/clear-items`),
  startTask: (id: string) => api.post(`/crawler/tasks/${id}/start`),
  pauseTask: (id: string) => api.post(`/crawler/tasks/${id}/pause`),
  stopTask: (id: string) => api.post(`/crawler/tasks/${id}/stop`),
  retryTask: (id: string) => api.post(`/crawler/tasks/${id}/retry`),
  reRunTask: (id: string) => api.post(`/crawler/tasks/${id}/rerun`),
  deleteTask: (id: string) => api.delete(`/crawler/tasks/${id}`),
  batchDeleteTasks: (ids: string[]) => api.post('/crawler/tasks/batch-delete', { ids }),
  batchStartTasks: (ids: string[]) => api.post('/crawler/tasks/batch-start', { ids }),
  batchRetryTasks: (ids: string[]) => api.post('/crawler/tasks/batch-retry', { ids }),
  batchRerunTasks: (ids: string[]) => api.post('/crawler/tasks/batch-rerun', { ids }),
  batchClearItems: (ids: string[]) => api.post('/crawler/tasks/batch-clear-items', { ids }),
  batchDeleteItems: (ids: string[]) => api.post('/crawler/items/batch-delete', { ids }),
  batchCrawlItems: (ids: string[]) => api.post('/crawler/items/batch-crawl', { ids }),
  batchRecrawlItems: (ids: string[]) => api.post('/crawler/items/batch-recrawl', { ids }),
  updateTask: (id: string, payload: any) => api.put(`/crawler/tasks/${id}`, payload),
  // Export（仅爬虫采集结果）
  getExportFields: (taskIds: string[]) => api.get('/crawler/export/fields', { params: { taskIds: taskIds.join(',') } }),
  exportData: (params: {
    taskIds: string[]
    format: 'json' | 'yaml' | 'csv' | 'excel'
    fields: { key: string; alias: string }[]
    multiFile?: boolean
  }) => api.post('/crawler/export', params, { responseType: 'blob' }),
  exportItems: (params: {
    itemIds: string[]
    format: 'json' | 'yaml' | 'csv' | 'excel'
    fields: { key: string; alias: string }[]
    multiFile?: boolean
  }) => api.post('/crawler/export-items', params, { responseType: 'blob' }),
}
