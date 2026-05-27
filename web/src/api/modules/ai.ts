import api from '../client'

export const aiAPI = {
  getProviders: () => api.get('/ai/providers'),
  createProvider: (p: any) => api.post('/ai/providers', p),
  updateProvider: (id: string, p: any) => api.put(`/ai/providers/${id}`, p),
  deleteProvider: (id: string) => api.delete(`/ai/providers/${id}`),
  getProviderKey: (id: string) => api.get(`/ai/providers/${id}/key`),
  setPriority: (ids: string[]) => api.post('/ai/priority', { ids }),
  analyze: (body: any) => api.post('/ai/analyze', body),
  getTasks: () => api.get('/ai/tasks'),
  getResults: () => api.get('/ai/results'),
  cancelTask: (id: string) => api.delete(`/ai/tasks/${id}`),
}
