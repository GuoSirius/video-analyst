import api from '../client'

export const crawlerAPI = {
  start: (payload: any) => api.post('/crawler/crawl', payload),
  getTasks: () => api.get('/crawler/tasks'),
  getItems: (taskId?: string, status?: string) =>
    api.get('/crawler/items', { params: { taskId, status } }),
  deleteItem: (id: string) => api.delete(`/crawler/items/${id}`),
  retryItem: (id: string) => api.post(`/crawler/items/${id}/retry`),
  startTask: (id: string) => api.post(`/crawler/tasks/${id}/start`),
  pauseTask: (id: string) => api.post(`/crawler/tasks/${id}/pause`),
  stopTask: (id: string) => api.post(`/crawler/tasks/${id}/stop`),
  retryTask: (id: string) => api.post(`/crawler/tasks/${id}/retry`),
  reRunTask: (id: string) => api.post(`/crawler/tasks/${id}/rerun`),
  deleteTask: (id: string) => api.delete(`/crawler/tasks/${id}`),
  updateTask: (id: string, payload: any) => api.put(`/crawler/tasks/${id}`, payload),
}
