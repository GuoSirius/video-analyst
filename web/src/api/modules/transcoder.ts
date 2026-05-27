import api from '../client'

export const transcoderAPI = {
  checkFfmpeg: () => api.get('/transcoder/ffmpeg-check'),
  upload: (formData: FormData) => api.post('/transcoder/upload', formData),
  startConvert: (body: any) => api.post('/transcoder/convert', body),
  getTasks: () => api.get('/transcoder/tasks'),
  cancelTask: (id: string) => api.delete(`/transcoder/tasks/${id}`),
}
