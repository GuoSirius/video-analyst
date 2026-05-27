import { ref, onMounted, onUnmounted } from 'vue'

export function useSSE(endpoint: string) {
  const data = ref<any>(null)
  const connected = ref(false)
  let eventSource: EventSource | null = null

  function connect() {
    eventSource = new EventSource(`/api/${endpoint}/events`)
    eventSource.onopen = () => {
      connected.value = true
    }
    eventSource.onmessage = (e) => {
      try {
        data.value = JSON.parse(e.data)
      } catch {
        data.value = e.data
      }
    }
    eventSource.onerror = () => {
      connected.value = false
    }
  }

  function disconnect() {
    eventSource?.close()
    connected.value = false
  }

  onMounted(connect)
  onUnmounted(disconnect)

  return { data, connected, reconnect: () => { disconnect(); connect() } }
}
