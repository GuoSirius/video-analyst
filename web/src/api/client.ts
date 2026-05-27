import axios from 'axios'

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'

const api = axios.create({
  baseURL: BASE,
  timeout: 120000,
})

export default api
