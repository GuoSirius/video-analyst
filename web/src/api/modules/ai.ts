import api from '../client'

export const aiAPI = {
  getProviders: () => api.get('/ai/providers'),
  createProvider: (p: any) => api.post('/ai/providers', p),
  updateProvider: (id: string, p: any) => api.put(`/ai/providers/${id}`, p),
  deleteProvider: (id: string) => api.delete(`/ai/providers/${id}`),
  getProviderKey: (id: string) => api.get(`/ai/providers/${id}/key`),
  setPriority: (ids: string[]) => api.post('/ai/priority', { ids }),
  fetchModels: (params: { base_url: string; api_key: string }) => api.post('/ai/fetch-models', params),
  analyze: (body: any) => api.post('/ai/analyze', body),
  getTasks: () => api.get('/ai/tasks'),
  getResults: () => api.get('/ai/results'),
  startTask: (id: string) => api.post(`/ai/tasks/${id}/start`),
  pauseTask: (id: string) => api.post(`/ai/tasks/${id}/pause`),
  stopTask: (id: string) => api.post(`/ai/tasks/${id}/stop`),
  retryTask: (id: string) => api.post(`/ai/tasks/${id}/retry`),
  reRunTask: (id: string) => api.post(`/ai/tasks/${id}/rerun`),
  deleteTask: (id: string) => api.delete(`/ai/tasks/${id}`),
}
