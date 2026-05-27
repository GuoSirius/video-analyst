import api from '../client'

export const settingsAPI = {
  getPipeline: () => api.get('/settings/pipeline'),
  setPipeline: (autoMode: boolean) => api.post('/settings/pipeline', { autoMode }),
}
