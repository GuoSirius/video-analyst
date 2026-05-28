import api from '../client'

export const transcoderAPI = {
  checkFfmpeg: () => api.get('/transcoder/ffmpeg-check'),
  upload: (formData: FormData) => api.post('/transcoder/upload', formData),
  startConvert: (body: any) => api.post('/transcoder/convert', body),
  getTasks: () => api.get('/transcoder/tasks'),
  startTask: (id: string) => api.post(`/transcoder/tasks/${id}/start`),
  pauseTask: (id: string) => api.post(`/transcoder/tasks/${id}/pause`),
  stopTask: (id: string) => api.post(`/transcoder/tasks/${id}/stop`),
  retryTask: (id: string) => api.post(`/transcoder/tasks/${id}/retry`),
  reRunTask: (id: string) => api.post(`/transcoder/tasks/${id}/rerun`),
  deleteTask: (id: string) => api.delete(`/transcoder/tasks/${id}`),
}
