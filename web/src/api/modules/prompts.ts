import api from '../client'

export const promptsAPI = {
  getAll: () => api.get('/prompts'),
  save: (p: any) => api.post('/prompts', p),
  remove: (id: string) => api.delete(`/prompts/${id}`),
}
