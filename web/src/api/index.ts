import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
})

// Crawler
export const crawlerAPI = {
  start: (payload: any) => api.post('/crawler/crawl', payload),
  getTasks: () => api.get('/crawler/tasks'),
  getItems: (taskId?: string) => api.get('/crawler/items', { params: { taskId } }),
  cancelTask: (id: string) => api.delete(`/crawler/tasks/${id}`),
}

// Transcoder
export const transcoderAPI = {
  checkFfmpeg: () => api.get('/transcoder/ffmpeg-check'),
  upload: (formData: FormData) => api.post('/transcoder/upload', formData),
  startConvert: (body: any) => api.post('/transcoder/convert', body),
  getTasks: () => api.get('/transcoder/tasks'),
  cancelTask: (id: string) => api.delete(`/transcoder/tasks/${id}`),
}

// Whisper
export const whisperAPI = {
  loadModel: (modelPath: string) => api.post('/whisper/load-model', { modelPath }),
  transcribe: (body: any) => api.post('/whisper/transcribe', body),
  getTasks: () => api.get('/whisper/tasks'),
  getResults: (itemId?: string) => api.get('/whisper/results', { params: { itemId } }),
  cancelTask: (id: string) => api.delete(`/whisper/tasks/${id}`),
}

// AI
export const aiAPI = {
  getProviders: () => api.get('/ai/providers'),
  analyze: (body: any) => api.post('/ai/analyze', body),
  getTasks: () => api.get('/ai/tasks'),
  getResults: () => api.get('/ai/results'),
  cancelTask: (id: string) => api.delete(`/ai/tasks/${id}`),
}

// Export
export const exportAPI = {
  getColumns: () => api.get('/export/columns'),
  exportExcel: (body: any) => api.post('/export/excel', body, { responseType: 'blob' }),
}

export default api
