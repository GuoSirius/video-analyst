<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick, reactive } from 'vue'
import api from '../api/client'
import { usePagination } from '../composables/usePagination'
import { ElMessage, ElMessageBox } from 'element-plus'
import { downloadAPI } from '../api/modules/download'

// --- State ---
const items = ref<any[]>([])
const statusFilter = ref('all')
const typeFilter = ref('all')
const sourceFilter = ref('all')
const taskFilter = ref('all')
const keyword = ref('')
const selectedIds = ref<string[]>([])
const selectedItemsMeta = reactive<Record<string, any>>({})
const tableRef = ref<any>(null)
let syncingSelection = false
const loading = ref(false)
let sseConnection: EventSource | null = null

// Pagination
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => fetchItems(),
})

// Upload dialog
const uploadDialog = ref(false)
const stagedFiles = ref<Array<{ id: string; name: string; file: File; size: number; type: string; status: 'ready' | 'uploading' | 'success' | 'error'; error?: string }>>([])
const uploadFilterName = ref('')
const uploadFilterType = ref('all')
const uploadFilterStatus = ref('all')
const uploading = ref(false)
const uploadResults = ref<Array<{ filename: string; ok: boolean; error?: string }>>([])
const uploadDone = ref(false)

// Add link dialog
const linkDialog = ref(false)
const linkInput = ref('')
const linkDownloadMethod = ref<'auto' | 'yt-dlp' | 'file'>('auto')
const linking = ref(false)
const linkPreview = ref<{
  title: string; ext: string; filesize: number; filesizeHuman: string
  width: number; height: number; duration: number; durationHuman: string; site: string
} | null>(null)
const testingLink = ref(false)

// Filter options
const filterTypes = ref<string[]>([])
const filterSources = ref<string[]>([])
const filterTasks = ref<{ item_id: string; label: string }[]>([])

// --- Data ---
const stats = ref<any>({})

async function fetchFilters() {
  try {
    const { data } = await api.get('/download/filters')
    filterTypes.value = data.types || []
    filterSources.value = data.sources || []
    filterTasks.value = data.tasks || []
  } catch { /* ignore */ }
}

async function fetchItems() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (statusFilter.value !== 'all') params.status = statusFilter.value
    if (typeFilter.value !== 'all') params.file_type = typeFilter.value
    if (sourceFilter.value !== 'all') params.field_name = sourceFilter.value
    if (taskFilter.value !== 'all') params.item_id = taskFilter.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()

    const { data } = await api.get('/download/queue', { params })
    items.value = data.data
    total.value = data.total
    stats.value = data.stats || {}
    await nextTick()
    syncTableSelection()
  } catch {
    ElMessage.error('获取数据失败')
  }
  loading.value = false
}

const refresh = fetchItems

// Watch filters
watch([statusFilter, typeFilter, sourceFilter, taskFilter, keyword], () => {
  page.value = 1
  fetchItems()
})

// ── Cross-page selection ──
function findSelected(id: string) { return items.value.find((x: any) => x.id === id) || selectedItemsMeta[id] }

function handleSelectionChange(rows: any[]) {
  if (syncingSelection) return
  const visibleIds = new Set(items.value.map((i: any) => i.id))
  const newSelected = new Map(rows.map((r: any) => [r.id, r]))
  for (const id of visibleIds) {
    if (!newSelected.has(id)) {
      selectedIds.value = selectedIds.value.filter(x => x !== id)
      delete selectedItemsMeta[id]
    }
  }
  for (const [id, row] of newSelected) {
    if (!selectedIds.value.includes(id)) {
      selectedIds.value.push(id)
    }
    selectedItemsMeta[id] = { id, status: row.status, file_type: row.file_type, field_name: row.field_name }
  }
}

function syncTableSelection() {
  if (!tableRef.value) return
  syncingSelection = true
  items.value.forEach((row: any) => {
    if (selectedIds.value.includes(row.id)) {
      tableRef.value.toggleRowSelection(row, true)
    }
  })
  syncingSelection = false
}

async function clearAllSelections() {
  try {
    await ElMessageBox.confirm(`确定要清空全部 ${selectedIds.value.length} 个选择吗？`, '清空选择', { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消' })
    for (const id of selectedIds.value) delete selectedItemsMeta[id]
    selectedIds.value = []
    tableRef.value?.clearSelection()
  } catch { /* cancelled */ }
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = 'all'
  typeFilter.value = 'all'
  sourceFilter.value = 'all'
  taskFilter.value = 'all'
  page.value = 1
  fetchItems()
}

// ── Computed batches ──
const pendingIds = computed(() => selectedIds.value.filter(id => findSelected(id)?.status === 'pending'))
const downloadingIds = computed(() => selectedIds.value.filter(id => findSelected(id)?.status === 'downloading'))
const failedIds = computed(() => selectedIds.value.filter(id => findSelected(id)?.status === 'failed'))
const completedIds = computed(() => selectedIds.value.filter(id => findSelected(id)?.status === 'completed'))
const deletableIds = computed(() => selectedIds.value.filter(id => findSelected(id)?.status !== 'downloading'))
const pipelineIds = computed(() => selectedIds.value.filter(id => findSelected(id)?.status === 'completed'))

// ── Single actions ──
async function startDownload(id: string) {
  try {
    await downloadAPI.startDownload(id)
    ElMessage.success('下载已启动')
    fetchItems()
  } catch { ElMessage.error('操作失败') }
}

async function stopDownload(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此下载吗？任务将重置为等待状态。', '确认终止', { type: 'warning' })
    const res = await downloadAPI.stopDownload(id)
    if (res.data?.error) { ElMessage.error(res.data.error); return }
    ElMessage.success('已终止下载')
    fetchItems()
  } catch { /* cancelled */ }
}

async function retryDownload(id: string) {
  try {
    const res = await downloadAPI.retryDownload(id)
    if (res.data?.error) { ElMessage.error(res.data.error); return }
    ElMessage.success('重新下载已启动')
    fetchItems()
  } catch (e: any) {
    if (e.response?.data?.error) ElMessage.error(e.response.data.error)
    else ElMessage.error('操作失败')
  }
}

async function startTranscode(id: string) {
  try {
    const res = await api.post(`/download/queue/${id}/transcode`)
    if (res.data?.error) { ElMessage.error(res.data.error); return }
    ElMessage.success('已送入转码处理')
  } catch { ElMessage.error('操作失败') }
}

async function deleteSingle(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除该下载任务吗？已下载的文件也会被删除。', '确认删除', { type: 'warning' })
    await downloadAPI.deleteTask(id)
    ElMessage.success('已删除')
    selectedIds.value = selectedIds.value.filter(sid => sid !== id)
    delete selectedItemsMeta[id]
    fetchItems()
  } catch { /* cancelled */ }
}

// ── Batch actions ──
async function batchStart() {
  const ids = pendingIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有等待下载的任务'); return }
  try {
    await ElMessageBox.confirm(`确定要启动选中的 ${ids.length} 个下载任务吗？`, '批量下载确认', { type: 'info', confirmButtonText: '确定', cancelButtonText: '取消' })
    await downloadAPI.batchStart(ids)
    ElMessage.success(`已启动 ${ids.length} 个下载任务`)
    fetchItems()
  } catch { /* cancelled */ }
}

async function batchStop() {
  const ids = downloadingIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有下载中的任务'); return }
  try {
    await ElMessageBox.confirm(`确定要终止选中的 ${ids.length} 个下载任务吗？`, '批量终止确认', { type: 'warning', confirmButtonText: '确定终止', cancelButtonText: '取消' })
    const res = await downloadAPI.batchStop(ids)
    ElMessage.success(`已终止 ${res.data?.count || ids.length} 个下载任务`)
    fetchItems()
  } catch { /* cancelled */ }
}

async function batchRetry() {
  const ids = failedIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有下载失败的任务'); return }
  try {
    await ElMessageBox.confirm(`确定要重试选中的 ${ids.length} 个下载任务吗？`, '批量重试确认', { type: 'info', confirmButtonText: '确定重试', cancelButtonText: '取消' })
    const res = await downloadAPI.batchRetry(ids)
    ElMessage.success(`已重试 ${res.data?.count || ids.length} 个下载任务`)
    fetchItems()
  } catch { /* cancelled */ }
}

async function batchRedownload() {
  const ids = completedIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有已下载的任务'); return }
  try {
    await ElMessageBox.confirm(`确定要重新下载选中的 ${ids.length} 个资源吗？旧的下载文件将被覆盖。`, '批量重新下载确认', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' })
    const res = await downloadAPI.batchRetry(ids)
    ElMessage.success(`已重新下载 ${res.data?.count || ids.length} 个资源`)
    fetchItems()
  } catch { /* cancelled */ }
}

async function batchDelete() {
  const ids = deletableIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有可删除的任务（下载中的任务不能删除）'); return }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${ids.length} 个下载任务吗？已下载的文件也将被删除。`, '批量删除确认', { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' })
    await downloadAPI.batchDelete(ids)
    ElMessage.success(`已删除 ${ids.length} 个下载任务`)
    for (const id of ids) { delete selectedItemsMeta[id] }
    selectedIds.value = selectedIds.value.filter(id => !ids.includes(id))
    fetchItems()
  } catch { /* cancelled */ }
}

async function batchAutoPipeline() {
  const ids = pipelineIds.value
  if (!ids.length) { ElMessage.warning('所选项目中没有已完成的下载任务'); return }
  try {
    await ElMessageBox.confirm(
      `将对选中的 ${ids.length} 个已完成下载的资源一键自动执行后续流水线：\n\n① FFmpeg转码(16kHz WAV) → ② Whisper语音识别 → ③ AI分析总结\n\n各环节按顺序自动执行。`,
      '一键自动执行后续流程',
      { type: 'info', confirmButtonText: '开始执行', cancelButtonText: '取消' },
    )
    const res = await downloadAPI.batchAutoPipeline(ids)
    const results = res.data?.results || []
    const okCount = results.filter((r: any) => r.ok).length
    const failCount = results.filter((r: any) => !r.ok).length
    if (failCount) { ElMessage.warning(`成功 ${okCount} 个，${failCount} 个失败`) }
    else { ElMessage.success(`已启动 ${okCount} 个资源的完整流水线`) }
  } catch { /* cancelled */ }
}

// ── Upload dialog ──

// Generate unique ID for staged files
let fileIdCounter = 0

function handleUploadFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  for (const f of Array.from(input.files)) {
    if (!stagedFiles.value.some(s => s.name === f.name && s.size === f.size)) {
      const ext = f.name.split('.').pop()?.toLowerCase() || ''
      stagedFiles.value.push({
        id: `file_${++fileIdCounter}`,
        name: f.name,
        file: f,
        size: f.size,
        type: getFileTypeLabel(ext),
        status: 'ready',
      })
    }
  }
  input.value = ''
}

function getFileTypeLabel(ext: string): string {
  const map: Record<string, string> = {
    mp4: '视频', webm: '视频', avi: '视频', mov: '视频', mkv: '视频', flv: '视频', wmv: '视频', m4v: '视频',
    mp3: '音频', wav: '音频', ogg: '音频', aac: '音频', flac: '音频', m4a: '音频', wma: '音频',
    jpg: '图片', jpeg: '图片', png: '图片', gif: '图片', webp: '图片', bmp: '图片', svg: '图片',
    pdf: '文档', doc: '文档', docx: '文档', xls: '文档', xlsx: '文档', csv: '文档',
    json: '数据', yaml: '数据', yml: '数据', txt: '文本', md: '文本',
  }
  return map[ext] || '其他'
}

function removeStagedFile(id: string) {
  stagedFiles.value = stagedFiles.value.filter(f => f.id !== id)
}

const filteredStagedFiles = computed(() => {
  return stagedFiles.value.filter(f => {
    if (uploadFilterName.value && !f.name.toLowerCase().includes(uploadFilterName.value.toLowerCase())) return false
    if (uploadFilterType.value !== 'all' && f.type !== uploadFilterType.value) return false
    if (uploadFilterStatus.value !== 'all' && f.status !== uploadFilterStatus.value) return false
    return true
  })
})

const stagedTypeOptions = computed(() => {
  const types = new Set(stagedFiles.value.map(f => f.type))
  return Array.from(types)
})

function openUploadDialog() {
  stagedFiles.value = []
  uploadResults.value = []
  uploadDone.value = false
  uploadFilterName.value = ''
  uploadFilterType.value = 'all'
  uploadFilterStatus.value = 'all'
  uploadDialog.value = true
}

async function startUpload() {
  const readyFiles = stagedFiles.value.filter(f => f.status === 'ready' || f.status === 'error')
  if (!readyFiles.length) { ElMessage.warning('没有待上传的文件'); return }

  // Mark all ready/error files as uploading
  for (const f of readyFiles) f.status = 'uploading'

  uploading.value = true
  try {
    const fd = new FormData()
    for (const f of readyFiles) {
      fd.append('files', f.file)
    }
    const { data } = await api.post('/download/upload', fd)

    if (data.results) {
      // Map results back to staged files
      for (const r of data.results) {
        const staged = stagedFiles.value.find(f => f.name === r.filename && f.status === 'uploading')
        if (staged) {
          staged.status = r.ok ? 'success' : 'error'
          staged.error = r.error
        }
      }
    }

    uploadDone.value = true
    const okCount = stagedFiles.value.filter(f => f.status === 'success').length
    const failCount = stagedFiles.value.filter(f => f.status === 'error').length

    if (failCount > 0) {
      ElMessage.warning(`${okCount} 个上传成功，${failCount} 个失败 — 可以重试失败项或忽略并带入成功项`)
    } else {
      ElMessage.success(`${okCount} 个文件全部上传成功，已自动带入列表`)
      uploadDialog.value = false
      await refresh()
    }
  } catch {
    ElMessage.error('上传失败')
    for (const f of readyFiles) f.status = 'error'
  }
  uploading.value = false
}

async function retryFailedUploads() {
  const failedFiles = stagedFiles.value.filter(f => f.status === 'error')
  if (!failedFiles.length) { ElMessage.warning('没有失败的文件需要重试'); return }

  for (const f of failedFiles) f.status = 'uploading'
  uploading.value = true
  try {
    const fd = new FormData()
    for (const f of failedFiles) {
      fd.append('files', f.file)
    }
    const { data } = await api.post('/download/upload', fd)

    if (data.results) {
      for (const r of data.results) {
        const staged = stagedFiles.value.find(f => f.name === r.filename && f.status === 'uploading')
        if (staged) {
          staged.status = r.ok ? 'success' : 'error'
          staged.error = r.error
        }
      }
    }

    const okCount = stagedFiles.value.filter(f => f.status === 'success').length
    const failCount = stagedFiles.value.filter(f => f.status === 'error').length
    if (failCount > 0) {
      ElMessage.warning(`${okCount} 个成功，${failCount} 个仍失败`)
    } else {
      ElMessage.success('全部上传成功，已自动带入列表')
      uploadDialog.value = false
      await refresh()
    }
  } catch {
    ElMessage.error('重试失败')
  }
  uploading.value = false
}

async function ignoreFailedAndImport() {
  const successCount = stagedFiles.value.filter(f => f.status === 'success').length
  if (successCount === 0) {
    ElMessage.warning('没有成功上传的文件可以带入')
    return
  }
  ElMessage.success(`已将 ${successCount} 个成功上传的文件带入列表`)
  uploadDialog.value = false
  await refresh()
}

// ── Add link dialog ──
function openLinkDialog() {
  linkInput.value = ''
  linkDownloadMethod.value = 'auto'
  linkPreview.value = null
  linkDialog.value = true
}

async function testLink() {
  if (!linkInput.value.trim()) { ElMessage.warning('请先输入链接'); return }
  testingLink.value = true
  try {
    const dlMethod = linkDownloadMethod.value === 'auto' ? undefined : linkDownloadMethod.value
    const { data } = await downloadAPI.testLink(linkInput.value.trim(), dlMethod)
    if (data.error) { ElMessage.error(data.error); return }
    linkPreview.value = data.info
    ElMessage.success('链接有效')
  } catch (e: any) {
    const msg = e.response?.data?.error || e.message || '链接测试失败'
    linkPreview.value = null
    ElMessage.warning(msg)
  } finally {
    testingLink.value = false
  }
}

async function confirmLink() {
  if (!linkInput.value.trim()) { ElMessage.warning('请先输入链接'); return }
  if (!linkPreview.value) { ElMessage.warning('请先测试链接'); return }
  linking.value = true
  try {
    const dlMethod = linkDownloadMethod.value === 'auto' ? undefined : linkDownloadMethod.value
    const res = await downloadAPI.createDownload([
      { url: linkInput.value.trim(), fieldName: 'link', downloadMethod: dlMethod },
    ])
    if (res.data?.error) { ElMessage.error(res.data.error); return }
    ElMessage.success('已创建下载任务')
    linkDialog.value = false
    linkPreview.value = null
    linkInput.value = ''
    await refresh()
  } catch { ElMessage.error('创建任务失败') }
  linking.value = false
}

// ── Display helpers ──
function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '等待下载', downloading: '下载中', completed: '已完成', failed: '下载失败',
  }
  return map[s] || s || '未知'
}

function statusClass(s: string) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    downloading: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    failed: 'bg-red-500/15 text-red-300 border-red-500/25',
    pending: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  }
  return map[s] || ''
}

function fileTypeIcon(type: string) {
  const map: Record<string, string> = {
    video: 'fa-file-video text-blue-400',
    audio: 'fa-file-audio text-emerald-400',
    image: 'fa-file-image text-purple-400',
    document: 'fa-file-lines text-amber-400',
    unknown: 'fa-file text-gray-500',
  }
  return map[type] || map.unknown
}

function iconForExt(ext: string) {
  const map: Record<string, string> = {
    video: 'fa-file-video text-blue-400',
    audio: 'fa-file-audio text-emerald-400',
    image: 'fa-file-image text-purple-400',
    document: 'fa-file-lines text-amber-400',
  }
  return map[ext] || 'fa-file text-gray-500'
}

function sourceIcon(fieldName: string) {
  if (fieldName === 'upload') return 'text-emerald-400'
  return 'text-blue-400'
}

function downloadMethodLabel(task: any): string {
  if (task.field_name === 'upload') return '上传'
  if (task.download_method === 'yt-dlp') return 'yt-dlp'
  if (task.download_method === 'file') return '直链'
  return '自动'
}

function isRowSelectable(_row: any) { return true }

// ── SSE ──
const SSE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'}/crawler/events`

function setupSSE() {
  if (sseConnection) sseConnection.close()
  sseConnection = new EventSource(SSE_URL)
  sseConnection.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.type === 'download') {
        const idx = items.value.findIndex((i: any) => i.id === evt.taskId)
        if (idx !== -1) {
          items.value[idx].status = evt.status
          items.value[idx].progress = evt.progress
          items.value[idx].error = evt.error
          items.value[idx].file_path = evt.filePath
          // Update meta for cross-page selection
          if (evt.taskId in selectedItemsMeta) {
            selectedItemsMeta[evt.taskId].status = evt.status
          }
        }
        // If reimported, refresh stats
        if (evt.status === 'reimported' || evt.status === 'completed' || evt.status === 'failed') {
          fetchFilters() // refresh task filter options
        }
      }
    } catch { /* ignore */ }
  }
  sseConnection.onerror = () => {
    sseConnection?.close()
    setTimeout(setupSSE, 3000)
  }
}

function teardownSSE() {
  sseConnection?.close()
  sseConnection = null
}

onMounted(() => {
  fetchFilters()
  refresh()
  setupSSE()
})

onUnmounted(teardownSSE)
</script>

<template>
  <div class="px-7 py-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">资源管理</h2>
        <p class="text-[13px] text-gray-500">管理本地文件上传和外部资源下载</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500">
          <span class="text-emerald-400">{{ stats.completed || 0 }}</span> 已完成 /
          <span class="text-blue-400">{{ stats.downloading || 0 }}</span> 下载中 /
          <span class="text-purple-400">{{ stats.pending || 0 }}</span> 等待 /
          <span class="text-red-400">{{ stats.failed || 0 }}</span> 失败
        </span>

        <!-- Batch action buttons -->
        <el-button v-if="pipelineIds.length" type="success" size="small" plain @click="batchAutoPipeline">
          <i class="fas fa-forward-step mr-1.5"></i>一键自动执行 ({{ pipelineIds.length }})
        </el-button>
        <el-button v-if="pendingIds.length" type="primary" size="small" plain @click="batchStart">
          <i class="fas fa-play mr-1.5"></i>批量下载 ({{ pendingIds.length }})
        </el-button>
        <el-button v-if="downloadingIds.length" type="warning" size="small" plain @click="batchStop">
          <i class="fas fa-stop mr-1.5"></i>批量终止 ({{ downloadingIds.length }})
        </el-button>
        <el-button v-if="failedIds.length" type="warning" size="small" plain @click="batchRetry">
          <i class="fas fa-rotate-right mr-1.5"></i>批量重试 ({{ failedIds.length }})
        </el-button>
        <el-button v-if="completedIds.length" size="small" plain @click="batchRedownload">
          <i class="fas fa-repeat mr-1.5"></i>批量重新下载 ({{ completedIds.length }})
        </el-button>

        <el-dropdown v-if="deletableIds.length || selectedIds.length" trigger="click">
          <el-button size="small" plain>
            更多 <i class="fas fa-chevron-down ml-1 text-[10px]"></i>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-if="deletableIds.length" @click="batchDelete">
                <i class="fas fa-trash-can mr-1.5 text-red-400"></i><span class="text-red-400">批量删除 ({{ deletableIds.length }})</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button type="success" size="small" @click="openLinkDialog">
          <i class="fas fa-link mr-1.5"></i>添加链接
        </el-button>
        <el-button type="primary" size="small" @click="openUploadDialog">
          <i class="fas fa-upload mr-1.5"></i>上传文件
        </el-button>
        <el-button type="primary" size="small" plain @click="downloadAPI.processAll().then(refresh)">
          <i class="fas fa-play mr-1.5"></i>全部开始
        </el-button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">搜索：</span>
          <el-input v-model="keyword" size="small" placeholder="搜索文件名/URL/错误信息" clearable @keyup.enter="page=1;fetchItems()" @clear="page=1;fetchItems()" class="!w-52">
            <template #prefix>
              <i class="fas fa-magnifying-glass text-gray-500 text-[12px]"></i>
            </template>
          </el-input>
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">类型：</span>
          <el-select v-model="typeFilter" size="small" class="!w-24" @change="page=1;fetchItems()">
            <el-option label="全部" value="all" />
            <el-option v-for="t in filterTypes" :key="t" :label="t === 'video' ? '视频' : t === 'audio' ? '音频' : t === 'image' ? '图片' : t === 'document' ? '文档' : t" :value="t" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">来源：</span>
          <el-select v-model="sourceFilter" size="small" class="!w-24" @change="page=1;fetchItems()">
            <el-option label="全部" value="all" />
            <el-option v-for="s in filterSources" :key="s" :label="s === 'upload' ? '上传' : s === 'link' ? '链接' : s" :value="s" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">所属任务：</span>
          <el-select v-model="taskFilter" size="small" class="!w-40" @change="page=1;fetchItems()">
            <el-option label="全部" value="all" />
            <el-option v-for="t in filterTasks" :key="t.item_id" :label="t.label" :value="t.item_id" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="text-xs text-gray-400 flex-shrink-0">状态：</span>
          <el-select v-model="statusFilter" size="small" class="!w-28" @change="page=1;fetchItems()">
            <el-option label="全部" value="all" />
            <el-option label="等待下载" value="pending" />
            <el-option label="下载中" value="downloading" />
            <el-option label="已完成" value="completed" />
            <el-option label="下载失败" value="failed" />
          </el-select>
        </span>
        <span class="inline-flex items-center gap-1">
          <el-button size="small" plain @click="page=1;fetchItems()"><i class="fas fa-search mr-1"></i>搜索</el-button>
          <el-button size="small" plain @click="resetFilters"><i class="fas fa-undo mr-1"></i>重置</el-button>
          <el-button size="small" plain @click="fetchItems()"><i class="fas fa-sync-alt mr-1"></i>刷新</el-button>
          <el-button v-if="selectedIds.length" size="small" plain type="warning" @click="clearAllSelections"><i class="fas fa-times-circle mr-1"></i>清空选择 ({{ selectedIds.length }})</el-button>
        </span>
      </div>
    </div>

    <!-- Items Table -->
    <div class="card-static">
      <el-table
        v-if="items.length"
        ref="tableRef"
        :data="items"
        size="small"
        row-key="id"
        max-height="500"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="40" fixed="left" :reserve-selection="true" :selectable="isRowSelectable" />
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="文件名" min-width="180" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <i class="fas text-[11px]" :class="fileTypeIcon(row.file_type)"></i>
              <span class="text-xs text-gray-300">{{ row.filename || row.url?.split('/').pop() }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="70">
          <template #default="{ row }">
            <span class="text-xs" :class="row.file_type === 'video' ? 'text-blue-400' : row.file_type === 'audio' ? 'text-emerald-400' : row.file_type === 'image' ? 'text-purple-400' : row.file_type === 'document' ? 'text-amber-400' : 'text-gray-500'">
              {{ row.file_type === 'video' ? '视频' : row.file_type === 'audio' ? '音频' : row.file_type === 'image' ? '图片' : row.file_type === 'document' ? '文档' : row.file_type || '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="80">
          <template #default="{ row }">
            <span class="text-xs" :class="sourceIcon(row.field_name)">
              {{ row.field_name === 'upload' ? '上传' : '下载' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="下载方式" width="80">
          <template #default="{ row }">
            <span class="text-xs" :class="{
              'text-green-400': downloadMethodLabel(row) === '上传',
              'text-orange-400': downloadMethodLabel(row) === 'yt-dlp',
              'text-blue-400': downloadMethodLabel(row) === '直链',
              'text-gray-500': downloadMethodLabel(row) === '自动',
            }">{{ downloadMethodLabel(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="URL" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.field_name !== 'upload'" class="text-xs text-gray-500 break-all">{{ row.url }}</span>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border" :class="statusClass(row.status)">
              {{ statusLabel(row.status) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="120">
          <template #default="{ row }">
            <el-progress
              v-if="row.status === 'downloading'"
              :percentage="row.progress || 0"
              :stroke-width="4"
            />
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="错误信息" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.error" class="text-xs text-red-400">{{ row.error }}</span>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="145">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="260" align="center" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <!-- 等待下载: 开始下载、删除 -->
              <template v-if="row.status === 'pending'">
                <el-button size="small" type="primary" plain @click="startDownload(row.id)">开始下载</el-button>
                <el-button size="small" type="danger" plain @click="deleteSingle(row.id)">删除</el-button>
              </template>
              <!-- 下载中: 终止 -->
              <template v-else-if="row.status === 'downloading'">
                <el-button size="small" type="danger" plain @click="stopDownload(row.id)">终止</el-button>
              </template>
              <!-- 下载失败: 重试、删除 -->
              <template v-else-if="row.status === 'failed'">
                <el-button size="small" type="warning" plain @click="retryDownload(row.id)">重试</el-button>
                <el-button size="small" type="danger" plain @click="deleteSingle(row.id)">删除</el-button>
              </template>
              <!-- 已完成: 转码、重新下载、删除 -->
              <template v-else-if="row.status === 'completed'">
                <el-button size="small" type="success" plain @click="startTranscode(row.id)">转码</el-button>
                <el-button v-if="row.field_name !== 'upload'" size="small" type="warning" plain @click="retryDownload(row.id)">重新下载</el-button>
                <el-button size="small" type="danger" plain @click="deleteSingle(row.id)">删除</el-button>
              </template>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="total > pageSize" class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="pageSizes"
          :total="total"
          layout="total, sizes, prev, pager, next"
          size="small"
          background
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>
      <div v-if="!items.length && !loading" class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-download text-3xl mb-3 inline-block opacity-30"></i>
        暂无资源，请上传本地文件或从采集结果中"带入下载"
      </div>
      <div v-if="loading" class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-spinner fa-spin text-2xl mb-3 inline-block opacity-50"></i>
        加载中...
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- Upload Dialog -->
    <!-- ════════════════════════════════════════════════════════ -->
    <el-dialog v-model="uploadDialog" title="上传文件" width="800px" destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <!-- Top bar: file selector + upload button -->
        <div class="flex items-center gap-3">
          <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-500/10 border border-blue-500/25 cursor-pointer hover:bg-blue-500/20 transition-all text-xs">
            <i class="fas fa-folder-open text-blue-400"></i>
            选择文件
            <input type="file" multiple accept="audio/*,video/*,image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.json,.yaml,.yml,.txt,.md" class="hidden" @change="handleUploadFileSelect" />
          </label>
          <el-button type="primary" size="small" :disabled="!stagedFiles.filter(f => f.status !== 'success').length || uploading" :loading="uploading" @click="startUpload">
            <i class="fas fa-upload mr-1.5"></i>开始上传
          </el-button>
          <span v-if="stagedFiles.length" class="text-xs text-gray-500 ml-auto">
            {{ stagedFiles.filter(f => f.status === 'success').length }}/{{ stagedFiles.length }} 已上传
          </span>
          <span v-else class="text-xs text-gray-600 ml-auto">支持视频/音频/图片/文档</span>
        </div>

        <!-- File table -->
        <div v-if="stagedFiles.length">
          <!-- Table filters -->
          <div class="flex items-center gap-2">
            <el-input v-model="uploadFilterName" size="small" placeholder="搜索文件名" clearable class="!w-44">
              <template #prefix>
                <i class="fas fa-magnifying-glass text-gray-500 text-[11px]"></i>
              </template>
            </el-input>
            <el-select v-model="uploadFilterType" size="small" class="!w-24">
              <el-option label="全部类型" value="all" />
              <el-option v-for="t in stagedTypeOptions" :key="t" :label="t" :value="t" />
            </el-select>
            <el-select v-model="uploadFilterStatus" size="small" class="!w-24">
              <el-option label="全部状态" value="all" />
              <el-option label="待上传" value="ready" />
              <el-option label="上传中" value="uploading" />
              <el-option label="已成功" value="success" />
              <el-option label="上传失败" value="error" />
            </el-select>
          </div>

          <!-- Staged files table -->
          <div class="border border-gray-700/30 rounded-lg overflow-hidden">
            <el-table :data="filteredStagedFiles" size="small" max-height="350" row-key="id">
              <el-table-column label="文件名" min-width="180" show-overflow-tooltip>
                <template #default="{ row: f }">
                  <div class="flex items-center gap-1.5">
                    <i class="fas text-[11px]" :class="iconForExt(f.type)"></i>
                    <span class="text-xs text-gray-300">{{ f.name }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="类型" width="60">
                <template #default="{ row: f }">
                  <span class="text-xs text-gray-400">{{ f.type }}</span>
                </template>
              </el-table-column>
              <el-table-column label="大小" width="90">
                <template #default="{ row: f }">
                  <span class="text-xs text-gray-400">{{ f.size > 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : (f.size / 1024).toFixed(0) + ' KB' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="85">
                <template #default="{ row: f }">
                  <span class="text-xs" :class="{
                    'text-gray-500': f.status === 'ready',
                    'text-blue-400': f.status === 'uploading',
                    'text-emerald-400': f.status === 'success',
                    'text-red-400': f.status === 'error',
                  }">
                    <i v-if="f.status === 'ready'" class="fas fa-circle text-[6px] mr-1 align-middle"></i>
                    <i v-else-if="f.status === 'uploading'" class="fas fa-spinner fa-spin text-[10px] mr-1"></i>
                    <i v-else-if="f.status === 'success'" class="fas fa-circle-check text-[10px] mr-1"></i>
                    <i v-else-if="f.status === 'error'" class="fas fa-circle-exclamation text-[10px] mr-1"></i>
                    {{ f.status === 'ready' ? '待上传' : f.status === 'uploading' ? '上传中' : f.status === 'success' ? '成功' : '失败' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="错误" min-width="100" show-overflow-tooltip>
                <template #default="{ row: f }">
                  <span v-if="f.error" class="text-[11px] text-red-400">{{ f.error }}</span>
                  <span v-else class="text-xs text-gray-600">-</span>
                </template>
              </el-table-column>
              <el-table-column label="" width="45" align="center">
                <template #default="{ row: f }">
                  <el-button v-if="f.status !== 'uploading'" size="small" type="danger" circle plain @click="removeStagedFile(f.id)">
                    <i class="fas fa-xmark text-[11px]"></i>
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- Post-upload actions -->
          <div v-if="uploadDone && stagedFiles.some(f => f.status === 'error')" class="flex items-center gap-2">
            <div class="flex items-center gap-1 text-xs text-red-400">
              <i class="fas fa-triangle-exclamation"></i>
              {{ stagedFiles.filter(f => f.status === 'error').length }} 个文件上传失败
            </div>
            <el-button size="small" type="warning" plain @click="retryFailedUploads" :loading="uploading">
              <i class="fas fa-rotate-right mr-1"></i>重试失败项
            </el-button>
            <el-button v-if="stagedFiles.some(f => f.status === 'success')" size="small" type="primary" plain @click="ignoreFailedAndImport">
              <i class="fas fa-check mr-1"></i>忽略失败项，带入成功项
            </el-button>
          </div>

          <!-- All done -->
          <div v-if="uploadDone && !stagedFiles.some(f => f.status === 'error') && stagedFiles.some(f => f.status === 'success')" class="flex items-center gap-1 text-xs text-emerald-400">
            <i class="fas fa-circle-check"></i>
            全部上传成功，已自动带入列表
          </div>
        </div>

        <div v-else class="text-center py-10 text-xs text-gray-600 border border-dashed border-gray-700/40 rounded-lg">
          <i class="fas fa-cloud-arrow-up text-2xl mb-2 inline-block opacity-30"></i>
          <div>点击"选择文件"按钮添加要上传的文件</div>
          <div class="text-[11px] mt-1">支持视频、音频、图片、文档（PDF/Word/Excel/文本/数据）等格式</div>
        </div>
      </div>
    </el-dialog>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- Add Link Dialog -->
    <!-- ════════════════════════════════════════════════════════ -->
    <el-dialog v-model="linkDialog" title="添加下载链接" width="600px" destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <!-- URL input -->
        <div>
          <div class="text-xs text-gray-400 mb-2">视频/文件链接</div>
          <el-input
            v-model="linkInput"
            placeholder="粘贴链接地址…"
            clearable
            @keyup.enter="testLink"
          >
            <template #prefix>
              <i class="fas fa-link text-gray-500 text-xs"></i>
            </template>
          </el-input>
        </div>

        <!-- Download method -->
        <div>
          <div class="text-xs text-gray-400 mb-2">下载方式</div>
          <el-radio-group v-model="linkDownloadMethod" size="small">
            <el-radio-button value="auto">自动检测</el-radio-button>
            <el-radio-button value="yt-dlp">yt-dlp</el-radio-button>
            <el-radio-button value="file">HTTP 直链</el-radio-button>
          </el-radio-group>
          <div class="text-[11px] text-gray-600 mt-1.5">
            <template v-if="linkDownloadMethod === 'auto'">自动识别链接类型，站点视频使用 yt-dlp，文件直链使用 HTTP 下载</template>
            <template v-else-if="linkDownloadMethod === 'yt-dlp'">适用 YouTube / bilibili / 抖音 / 优酷 / 爱奇艺 / Vimeo / Twitch 等站点视频</template>
            <template v-else>适用 MP4 / M3U8 / PDF / 图片 等可直接访问的文件链接</template>
          </div>
        </div>

        <!-- Test button -->
        <div class="flex items-center gap-3">
          <el-button type="primary" plain size="small" :loading="testingLink" @click="testLink">
            <i class="fas fa-magnifying-glass mr-1.5"></i>测试链接
          </el-button>
          <span v-if="!testingLink && !linkPreview" class="text-xs text-gray-500">点击测试获取文件信息</span>
        </div>

        <!-- Preview -->
        <div v-if="linkPreview" class="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-4 space-y-2">
          <div class="text-xs font-bold text-emerald-400 flex items-center gap-2">
            <i class="fas fa-circle-check"></i> 链接有效
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div class="text-gray-500">标题</div>
            <div class="text-gray-300 truncate">{{ linkPreview.title }}</div>
            <div class="text-gray-500">站点</div>
            <div class="text-gray-300">
              <span v-if="linkPreview.site === 'bilibili'" class="text-pink-400">bilibili</span>
              <span v-else-if="linkPreview.site === 'tencent'" class="text-blue-400">腾讯视频</span>
              <span v-else-if="linkPreview.site === 'youtube'" class="text-red-400">YouTube</span>
              <span v-else-if="linkPreview.site === 'douyin'" class="text-gray-200">抖音</span>
              <span v-else-if="linkPreview.site === 'youku'" class="text-blue-300">优酷</span>
              <span v-else-if="linkPreview.site === 'iqiyi'" class="text-green-400">爱奇艺</span>
              <span v-else-if="linkPreview.site === 'vimeo'" class="text-cyan-400">Vimeo</span>
              <span v-else-if="linkPreview.site === 'twitch'" class="text-purple-400">Twitch</span>
              <span v-else-if="linkPreview.site === 'twitter'" class="text-sky-400">Twitter/X</span>
              <span v-else-if="linkPreview.site === 'instagram'" class="text-pink-300">Instagram</span>
              <span v-else-if="linkPreview.site === 'tiktok'" class="text-gray-200">TikTok</span>
              <span v-else-if="linkPreview.site === 'direct'" class="text-emerald-400">直链</span>
              <span v-else class="text-gray-500">{{ linkPreview.site }}</span>
            </div>
            <div class="text-gray-500">格式</div>
            <div class="text-gray-300">{{ linkPreview.ext || 'mp4' }}</div>
            <div class="text-gray-500">大小</div>
            <div class="text-gray-300">{{ linkPreview.filesizeHuman || '-' }}</div>
            <div v-if="linkPreview.durationHuman" class="text-gray-500">时长</div>
            <div v-if="linkPreview.durationHuman" class="text-gray-300">{{ linkPreview.durationHuman }}</div>
            <div v-if="linkPreview.width" class="text-gray-500">分辨率</div>
            <div v-if="linkPreview.width" class="text-gray-300">{{ linkPreview.width }}×{{ linkPreview.height }}</div>
          </div>
        </div>

        <!-- Supported sites info -->
        <div class="rounded-lg bg-gray-900/40 border border-gray-700/30 p-3">
          <div class="text-[11px] text-gray-500 font-semibold mb-1.5">支持的链接类型</div>
          <div class="text-[11px] text-gray-600 space-y-0.5">
            <div><span class="text-gray-400">站点视频：</span>YouTube · bilibili · 腾讯视频 · 抖音 · 优酷 · 爱奇艺 · Vimeo · Twitch · Twitter/X · Instagram · TikTok</div>
            <div><span class="text-gray-400">直链文件：</span>MP4 · MOV · MKV · M3U8 · MP3 · WAV · PDF · 图片 等</div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="linkDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!linkPreview" :loading="linking" @click="confirmLink">
          <i class="fas fa-download mr-1.5"></i>创建下载任务
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
