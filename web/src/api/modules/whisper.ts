import api from '../client'

export const whisperAPI = {
  getStatus: () => api.get('/whisper/status'),
  transcribe: (body: any) => api.post('/whisper/transcribe', body),
  getTasks: () => api.get('/whisper/tasks'),
  getResults: (itemId?: string) => api.get('/whisper/results', { params: { itemId } }),
  getModels: () => api.get('/whisper/models'),
  setModel: (model: string) => api.post('/whisper/models', { model }),
  cancelTask: (id: string) => api.delete(`/whisper/tasks/${id}`),
}
