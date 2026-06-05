import { ref, computed, watch, type Ref } from 'vue'

export interface PaginationOptions {
  /**
   * Default page size (default: 20).
   */
  defaultPageSize?: number
  /**
   * Server-side mode: callback when page or pageSize changes.
   * When provided, `total` is a writable ref the caller sets from API responses.
   */
  onFetch?: () => void | Promise<void>
  /**
   * Client-side mode: reactive data array to paginate in memory.
   * When provided, `total` is auto-synced to data.length and `pagedData` returns the current page slice.
   */
  data?: Ref<any[]> | (() => any[])
  /**
   * Ref(s) to watch — page resets to 1 when any of them change.
   */
  resetOn?: Ref<any>[]
}

const PRESETS = [10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 8000, 10000]

export function usePagination(options: PaginationOptions = {}) {
  const page = ref(1)
  const pageSize = ref(options.defaultPageSize ?? 20)
  const total = ref(0)

  // Client-side mode: keep total in sync with data length
  if (options.data) {
    watch(
      () => {
        const d = typeof options.data === 'function'
          ? (options.data as () => any[])()
          : (options.data as Ref<any[]>).value
        return d.length
      },
      (len) => { total.value = len },
      { immediate: true },
    )
  }

  /** Page-size options: total first (if > 0), then presets, deduplicated */
  const pageSizes = computed(() => {
    const t = total.value
    if (t === 0) return [...PRESETS]
    return [t, ...PRESETS.filter(p => p !== t)]
  })

  /** Client-side only: current page slice */
  const pagedData = computed(() => {
    if (!options.data) return []
    const d = typeof options.data === 'function'
      ? (options.data as () => any[])()
      : (options.data as Ref<any[]>).value
    const start = (page.value - 1) * pageSize.value
    return d.slice(start, start + pageSize.value)
  })

  function onPageChange(p: number) {
    page.value = p
    options.onFetch?.()
  }

  function onPageSizeChange(s: number) {
    pageSize.value = s
    page.value = 1
    options.onFetch?.()
  }

  /** Manually trigger a fetch (e.g. after external filter change) */
  function fetch() {
    options.onFetch?.()
  }

  // Reset page to 1 when watched sources change
  if (options.resetOn?.length) {
    watch(options.resetOn, () => { page.value = 1 }, { deep: false })
  }

  return {
    page,
    pageSize,
    total,
    pageSizes,
    pagedData,
    onPageChange,
    onPageSizeChange,
    fetch,
  }
}
