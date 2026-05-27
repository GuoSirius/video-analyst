import api from '../client'

export const exportAPI = {
  getColumns: () => api.get('/export/columns'),
  exportExcel: (body: any) => api.post('/export/excel', body, { responseType: 'blob' }),
}
