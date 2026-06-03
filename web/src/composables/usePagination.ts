import { ref, computed, watch, type Ref } from 'vue'

export interface PaginationOptions {
  /** Reactive array of all filtered data */
  data: Ref<any[]> | (() => any[])
  /** Default page size */
  defaultPageSize?: number
  /** Watch sources that should reset page to 1 */
  resetOn?: Ref<any>[]
}

export function usePagination(options: PaginationOptions) {
  const page = ref(1)
  const pageSize = ref(options.defaultPageSize ?? 20)

  const total = computed(() => {
    const d = typeof options.data === 'function' ? options.data() : options.data.value
    return d.length
  })

  // Page-size options: total (查看全部) always first, then presets (dedup)
  const pageSizes = computed(() => {
    const presets = [10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 8000, 10000]
    if (total.value === 0) return presets
    // Total first, remove duplicate from presets if it matches
    return [total.value, ...presets.filter(p => p !== total.value)]
  })

  const pagedData = computed(() => {
    const d = typeof options.data === 'function' ? options.data() : options.data.value
    const start = (page.value - 1) * pageSize.value
    return d.slice(start, start + pageSize.value)
  })

  function onPageChange(p: number) { page.value = p }
  function onPageSizeChange(s: number) { pageSize.value = s; page.value = 1 }

  // Reset to page 1 when watched sources change
  if (options.resetOn?.length) {
    watch(options.resetOn, () => { page.value = 1 })
  }

  return {
    page,
    pageSize,
    total,
    pageSizes,
    pagedData,
    onPageChange,
    onPageSizeChange,
  }
}
