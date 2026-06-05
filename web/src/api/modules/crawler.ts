import api from '../client'

export const crawlerAPI = {
  start: (payload: any) => api.post('/crawler/crawl', payload),
  getTasks: (keyword?: string) => api.get('/crawler/tasks', keyword ? { params: { keyword } } : {}),
  getTasksWithPagination: (params?: { status?: string; keyword?: string }) => api.get('/crawler/tasks/paginated', { params }),
  getItems: (params?: {
    taskId?: string
    status?: string
    mediaType?: string
    mediaSource?: string
    keyword?: string
    page?: number
    pageSize?: number
  }) => api.get('/crawler/items', { params }),
  deleteItem: (id: string) => api.delete(`/crawler/items/${id}`),
  retryItem: (id: string) => api.post(`/crawler/items/${id}/retry`),
  recrawlItem: (id: string) => api.post(`/crawler/items/${id}/recrawl`),
  cancelItem: (id: string) => api.post(`/crawler/items/${id}/cancel`),
  importToDownloadQueue: (id: string, retry = false) =>
    api.post(`/crawler/items/${id}/import-download`, retry ? { retry: true } : {}),
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
  batchAutoPipeline: (ids: string[]) => api.post('/crawler/tasks/batch-auto-pipeline', { ids }),
  batchDeleteItems: (ids: string[]) => api.post('/crawler/items/batch-delete', { ids }),
  batchCrawlItems: (ids: string[]) => api.post('/crawler/items/batch-crawl', { ids }),
  batchRecrawlItems: (ids: string[]) => api.post('/crawler/items/batch-recrawl', { ids }),
  batchImportDownload: (ids: string[], retry = false) =>
    api.post('/crawler/items/batch-import-download', { ids, retry }),
  batchItemsAutoPipeline: (ids: string[]) => api.post('/crawler/items/batch-auto-pipeline', { ids }),
  updateTask: (id: string, payload: any) => api.put(`/crawler/tasks/${id}`, payload),
  // Export
  getExportFields: (taskIds: string[]) => api.get('/crawler/export/fields', { params: { taskIds: taskIds.join(',') } }),
  exportData: (params: {
    taskIds: string[]
    format: 'json' | 'yaml' | 'csv' | 'excel'
    fields: { key: string; alias: string }[]
    includeTranscriptions?: boolean
    includeAIResults?: boolean
    multiFile?: boolean
  }) => api.post('/crawler/export', params, { responseType: 'blob' }),
  exportItems: (params: {
    itemIds: string[]
    format: 'json' | 'yaml' | 'csv' | 'excel'
    fields: { key: string; alias: string }[]
    includeTranscriptions?: boolean
    includeAIResults?: boolean
  }) => api.post('/crawler/export-items', params, { responseType: 'blob' }),
}
