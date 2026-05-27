import api from '../client'

export const crawlerAPI = {
  start: (payload: any) => api.post('/crawler/crawl', payload),
  getTasks: () => api.get('/crawler/tasks'),
  getItems: (taskId?: string) => api.get('/crawler/items', { params: { taskId } }),
  cancelTask: (id: string) => api.delete(`/crawler/tasks/${id}`),
}
