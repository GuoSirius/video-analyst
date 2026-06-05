import api from '../client'

export const downloadAPI = {
  getQueue: (params?: {
    status?: string
    file_type?: string
    field_name?: string
    item_id?: string
    keyword?: string
    page?: number
    pageSize?: number
  }) => api.get('/download/queue', { params }),
  getFiles: () => api.get('/download/files'),
  getStats: () => api.get('/download/stats'),
  getFilters: () => api.get('/download/filters'),
  uploadFiles: (fd: FormData) => api.post('/download/upload', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  // Single operations
  startDownload: (id: string) => api.post(`/download/queue/${id}/start`),
  stopDownload: (id: string) => api.post(`/download/queue/${id}/stop`),
  retryDownload: (id: string) => api.post(`/download/queue/${id}/retry`),
  deleteTask: (id: string) => api.delete(`/download/queue/${id}`),
  startTranscode: (id: string) => api.post(`/download/queue/${id}/transcode`),
  processAll: () => api.post('/download/queue/process'),

  // Batch operations
  batchStart: (ids: string[]) => api.post('/download/queue/batch-start', { ids }),
  batchStop: (ids: string[]) => api.post('/download/queue/batch-stop', { ids }),
  batchRetry: (ids: string[]) => api.post('/download/queue/batch-retry', { ids }),
  batchDelete: (ids: string[]) => api.post('/download/queue/batch-delete', { ids }),
  batchAutoPipeline: (ids: string[]) => api.post('/download/queue/batch-auto-pipeline', { ids }),

  // Link operations
  testLink: (url: string, downloadMethod?: string) => api.post('/download/test', { url, downloadMethod }),
  createDownload: (urls: Array<{ url: string; fieldName?: string; downloadMethod?: string }>, extra?: { item_id?: string; filenamePrefix?: string }) =>
    api.post('/download/create', { urls, ...extra }),
}
