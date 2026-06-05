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
  startDownload: (id: string) => api.post(`/download/queue/${id}/start`),
  processAll: () => api.post('/download/queue/process'),
  batchDelete: (ids: string[]) => api.post('/download/queue/batch-delete', { ids }),
  deleteTask: (id: string) => api.delete(`/download/queue/${id}`),
  startTranscode: (id: string) => api.post(`/download/queue/${id}/transcode`),
  retryDownload: (id: string) => api.post(`/download/queue/${id}/retry`),

  // 新增 API
  testLink: (url: string) => api.post('/download/test', { url }),
  createDownload: (urls: Array<{ url: string; fieldName?: string }>, extra?: { item_id?: string; filenamePrefix?: string }) =>
    api.post('/download/create', { urls, ...extra }),
}
