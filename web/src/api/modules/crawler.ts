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
  updateTask: (id: string, payload: any) => api.put(`/crawler/tasks/${id}`, payload),
}
