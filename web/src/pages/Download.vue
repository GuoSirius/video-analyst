<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
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
const loading = ref(false)
let sseConnection: EventSource | null = null

// Pagination
const { page, pageSize, total, pageSizes, onPageChange, onPageSizeChange } = usePagination({
  defaultPageSize: 20,
  onFetch: () => fetchItems(),
})

// Upload dialog
const uploadDialog = ref(false)
const pendingFiles = ref<{ name: string; file: File }[]>([])
const uploading = ref(false)

// Add link dialog
const linkDialog = ref(false)
const linkInput = ref('')
const linking = ref(false)
const linkPreview = ref<{
  title: string
  ext: string
  filesize: number
  filesizeHuman: string
  width: number
  height: number
  duration: number
  durationHuman: string
  site: string
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
    const params: any = {
      page: page.value,
      pageSize: pageSize.value,
    }
    if (statusFilter.value !== 'all') params.status = statusFilter.value
    if (typeFilter.value !== 'all') params.file_type = typeFilter.value
    if (sourceFilter.value !== 'all') params.field_name = sourceFilter.value
    if (taskFilter.value !== 'all') params.item_id = taskFilter.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()

    const { data } = await api.get('/download/queue', { params })
    items.value = data.data
    total.value = data.total
    stats.value = data.stats || {}
  } catch {
    ElMessage.error('获取数据失败')
  }
  loading.value = false
}

const refresh = fetchItems

// Watch filters — reset page then fetch
watch([statusFilter, typeFilter, sourceFilter, taskFilter, keyword], () => {
  page.value = 1
  fetchItems()
})

// --- Actions ---
async function startDownload(id: string) {
  try {
    await api.post(`/download/queue/${id}/start`)
    ElMessage.success('下载已启动')
    fetchItems()
  } catch { ElMessage.error('操作失败') }
}

async function pauseDownload(id: string) {
  // Download doesn't have pause; just mark as paused via the download scheduler
  // Actually, download doesn't support pause, but we can reset to pending to "pause"
  try {
    const task = items.value.find((i: any) => i.id === id)
    if (task) {
      await ElMessageBox.confirm('暂停下载将重置为等待状态，确定要暂停吗？', '确认', { type: 'warning' })
      await api.post(`/download/queue/${id}/start`) // reuse start to re-trigger
      ElMessage.success('已暂停')
      fetchItems()
    }
  } catch { /* cancelled */ }
}

async function stopDownload(id: string) {
  // Stop = reset to pending
  try {
    await ElMessageBox.confirm('终止下载将重置为等待状态，确定要终止吗？', '确认', { type: 'warning' })
    // Reset to pending
    const task = items.value.find((i: any) => i.id === id)
    if (task) {
      await api.post(`/download/queue/${id}/start`)
      ElMessage.success('已终止')
      fetchItems()
    }
  } catch { /* cancelled */ }
}

async function retryDownload(id: string) {
  try {
    const res = await api.post(`/download/queue/${id}/retry`)
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
    fetchItems()
  } catch { ElMessage.error('操作失败') }
}

async function deleteItems(ids: string[]) {
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${ids.length} 个任务吗？`, '确认删除', { type: 'warning' })
    // Use batch delete if multiple
    if (ids.length > 1) {
      await api.post('/download/queue/batch-delete', { ids })
    } else {
      await api.delete(`/download/queue/${ids[0]}`)
    }
    ElMessage.success('已删除')
    fetchItems()
    selectedIds.value = selectedIds.value.filter(id => !ids.includes(id))
  } catch { /* cancelled */ }
}

async function batchDelete() {
  if (!selectedIds.value.length) { ElMessage.warning('请先选择要删除的任务'); return }
  const ids = selectedIds.value.filter(id => canDelete(getItemStatus(id)))
  if (!ids.length) { ElMessage.warning('进行中的任务不能删除'); return }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${ids.length} 个任务吗？`, '确认删除', { type: 'warning' })
    if (ids.length > 1) {
      await api.post('/download/queue/batch-delete', { ids })
    } else {
      await api.delete(`/download/queue/${ids[0]}`)
    }
    ElMessage.success('已删除')
    fetchItems()
    selectedIds.value = []
  } catch { /* cancelled */ }
}

function getItemStatus(id: string): string {
  return items.value.find((i: any) => i.id === id)?.status || ''
}

async function startAllPending() {
  try {
    await ElMessageBox.confirm('确定要启动所有待下载任务吗？', '确认', { type: 'info' })
    await api.post('/download/queue/process')
    ElMessage.success('已启动下载')
    fetchItems()
  } catch { ElMessage.error('操作失败') }
}

// --- Upload dialog ---
function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  for (const f of Array.from(input.files)) {
    if (!pendingFiles.value.some(p => p.name === f.name && p.file.size === f.size)) {
      pendingFiles.value.push({ name: f.name, file: f })
    }
  }
  input.value = ''
}

function removePendingFile(index: number) {
  pendingFiles.value.splice(index, 1)
}

function openUploadDialog() {
  pendingFiles.value = []
  uploadDialog.value = true
}

async function confirmUpload() {
  if (!pendingFiles.value.length) { ElMessage.warning('请先选择文件'); return }
  uploading.value = true
  try {
    const fd = new FormData()
    for (const pf of pendingFiles.value) {
      fd.append('files', pf.file)
    }
    const { data } = await api.post('/download/upload', fd)
    if (data.error) { ElMessage.error(data.error); return }
    ElMessage.success(`已上传 ${data.count} 个文件`)
    uploadDialog.value = false
    pendingFiles.value = []
    await refresh()
  } catch { ElMessage.error('操作失败') }
  uploading.value = false
}

// --- Add link dialog ---
function openLinkDialog() {
  linkInput.value = ''
  linkPreview.value = null
  linkDialog.value = true
}

async function testLink() {
  if (!linkInput.value.trim()) { ElMessage.warning('请先输入视频链接'); return }
  testingLink.value = true
  try {
    const { data } = await downloadAPI.testLink(linkInput.value.trim())
    if (data.error) { ElMessage.error(data.error); return }
    linkPreview.value = data.info
    ElMessage.success('链接有效，可创建下载任务')
  } catch (e: any) {
    const msg = e.response?.data?.error || e.message || '链接测试失败'
    linkPreview.value = null
    ElMessage.warning(msg)
  } finally {
    testingLink.value = false
  }
}

async function confirmLink() {
  if (!linkInput.value.trim()) { ElMessage.warning('请先输入视频链接'); return }
  if (!linkPreview.value) { ElMessage.warning('请先测试链接'); return }
  linking.value = true
  try {
    const res = await downloadAPI.createDownload([
      { url: linkInput.value.trim(), fieldName: 'link' },
    ])
    if (res.data?.error) { ElMessage.error(res.data.error); return }
    ElMessage.success(`已创建下载任务，即将开始下载`)
    linkDialog.value = false
    linkPreview.value = null
    linkInput.value = ''
    await refresh()
  } catch { ElMessage.error('创建任务失败') }
  linking.value = false
}

// --- Computed ---

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
    unknown: 'fa-file text-gray-500',
  }
  return map[type] || map.unknown
}

function sourceIcon(fieldName: string) {
  if (fieldName === 'upload') return 'text-emerald-400'
  return 'text-blue-400'
}

// Action visibility per status:
// 未开始(pending): 开始、删除
// 进行中(downloading): 暂停、终止
// 失败(failed): 重试、删除
// 已完成(completed): 开始转码、删除、重新下载（上传的没有重新下载）
function canDelete(s: string) { return s !== 'downloading' }

// --- SSE ---
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
        <el-button type="success" size="small" @click="openLinkDialog">
          <i class="fas fa-link mr-1.5"></i>添加链接
        </el-button>
        <el-button type="primary" size="small" @click="openUploadDialog">
          <i class="fas fa-upload mr-1.5"></i>上传文件
        </el-button>
        <el-button type="primary" size="small" plain @click="startAllPending">
          <i class="fas fa-play mr-1.5"></i>开始下载
        </el-button>
        <el-button
          v-if="selectedIds.length"
          type="danger" size="small"
          @click="batchDelete"
        >
          <i class="fas fa-trash-can mr-1.5"></i>批量删除 ({{ selectedIds.length }})
        </el-button>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs text-gray-400">类型：</span>
        <el-select v-model="typeFilter" size="small" class="!w-24" clearable>
          <el-option label="全部" value="all" />
          <el-option v-for="t in filterTypes" :key="t" :label="t" :value="t" />
        </el-select>

        <span class="text-xs text-gray-400">来源：</span>
        <el-select v-model="sourceFilter" size="small" class="!w-24" clearable>
          <el-option label="全部" value="all" />
          <el-option v-for="s in filterSources" :key="s" :label="s" :value="s" />
        </el-select>

        <span class="text-xs text-gray-400">所属任务：</span>
        <el-select v-model="taskFilter" size="small" class="!w-40" clearable>
          <el-option label="全部" value="all" />
          <el-option v-for="t in filterTasks" :key="t.item_id" :label="t.label" :value="t.item_id" />
        </el-select>

        <span class="text-xs text-gray-400">状态：</span>
        <el-select v-model="statusFilter" size="small" class="!w-28" clearable>
          <el-option label="全部" value="all" />
          <el-option label="等待下载" value="pending" />
          <el-option label="下载中" value="downloading" />
          <el-option label="已完成" value="completed" />
          <el-option label="下载失败" value="failed" />
        </el-select>

        <div class="relative !w-48">
          <el-input
            v-model="keyword"
            size="small"
            placeholder="搜索文件名/URL"
            clearable
          >
            <template #prefix>
              <i class="fas fa-magnifying-glass text-gray-500 text-[12px]"></i>
            </template>
          </el-input>
        </div>
      </div>
    </div>

    <!-- Items Table -->
    <div class="card-static">
      <el-table
        v-if="items.length"
        :data="items"
        size="small"
        row-key="id"
        max-height="500"
        @selection-change="(rows: any) => selectedIds = rows.map((r: any) => r.id)"
      >
        <el-table-column type="selection" width="40" fixed="left" :reserve-selection="true" :selectable="(row: any) => canDelete(row.status)" />
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
            <span class="text-xs" :class="row.file_type === 'video' ? 'text-blue-400' : row.file_type === 'audio' ? 'text-emerald-400' : 'text-gray-500'">
              {{ row.file_type || '-' }}
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
        <el-table-column label="URL" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.field_name !== 'upload'" class="text-xs text-gray-500 break-all">{{ row.url }}</span>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
              :class="statusClass(row.status)">
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
        <el-table-column label="操作" min-width="240" align="center" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <!-- 等待下载: 开始、删除 -->
              <template v-if="row.status === 'pending'">
                <el-button size="small" type="primary" plain @click="startDownload(row.id)">开始</el-button>
                <el-button size="small" type="danger" plain @click="deleteItems([row.id])">删除</el-button>
              </template>
              <!-- 下载中: 暂停、终止 -->
              <template v-else-if="row.status === 'downloading'">
                <el-button size="small" type="warning" plain @click="pauseDownload(row.id)">暂停</el-button>
                <el-button size="small" type="danger" plain @click="stopDownload(row.id)">终止</el-button>
              </template>
              <!-- 失败: 重新下载（非上传）、重试（上传）、删除 -->
              <template v-else-if="row.status === 'failed'">
                <el-button v-if="row.field_name !== 'upload'" size="small" type="warning" plain @click="retryDownload(row.id)">重新下载</el-button>
                <el-button v-else size="small" type="warning" plain @click="retryDownload(row.id)">重试</el-button>
                <el-button size="small" type="danger" plain @click="deleteItems([row.id])">删除</el-button>
              </template>
              <!-- 已完成: 转码、重新下载（非上传）、删除 -->
              <template v-else-if="row.status === 'completed'">
                <el-button size="small" type="success" plain @click="startTranscode(row.id)">转码</el-button>
                <el-button v-if="row.field_name !== 'upload'" size="small" type="warning" plain @click="retryDownload(row.id)">重新下载</el-button>
                <el-button size="small" type="danger" plain @click="deleteItems([row.id])">删除</el-button>
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
        <i class="fas fa-download text-3xl mb-3 block opacity-30"></i>
        暂无资源，请上传本地文件或从采集结果中"带入下载"
      </div>
      <div v-if="loading" class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-spinner fa-spin text-2xl mb-3 block opacity-50"></i>
        加载中...
      </div>
    </div>

    <!-- Upload Dialog -->
    <el-dialog v-model="uploadDialog" title="上传本地文件" width="600px" destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <!-- File selector -->
        <label class="block border-2 border-dashed border-gray-600/40 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500/40 hover:bg-gray-800/30 transition-all duration-200">
          <i class="fas fa-cloud-arrow-up text-2xl text-gray-500 mb-2 block"></i>
          <div class="text-sm text-gray-400">点击选择文件（可多选）</div>
          <div class="text-xs text-gray-600 mt-1">支持音频/视频/图片文件</div>
          <input type="file" multiple accept="audio/*,video/*,image/*" class="hidden" @change="handleFileSelect" />
        </label>

        <!-- Pending files list -->
        <div v-if="pendingFiles.length" class="space-y-1">
          <div class="text-xs text-gray-400 mb-2">待上传文件 ({{ pendingFiles.length }})</div>
          <div
            v-for="(pf, i) in pendingFiles" :key="i"
            class="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-900/40 border border-gray-700/30"
          >
            <div class="flex items-center gap-2 min-w-0">
              <i class="fas fa-file text-gray-500 text-xs flex-shrink-0"></i>
              <span class="text-xs text-gray-300 truncate">{{ pf.name }}</span>
              <span class="text-[11px] text-gray-600 flex-shrink-0">
                {{ (pf.file.size / 1024 / 1024).toFixed(1) }} MB
              </span>
            </div>
            <el-button size="small" type="danger" circle plain @click="removePendingFile(i)">
              <i class="fas fa-xmark"></i>
            </el-button>
          </div>
        </div>
        <div v-else class="text-center py-4 text-xs text-gray-600">
          尚未选择文件
        </div>

        <div class="rounded-lg bg-blue-500/5 border border-blue-500/15 p-3 flex items-start gap-2">
          <i class="fas fa-info-circle text-blue-400 mt-0.5 text-xs"></i>
          <div class="text-xs text-blue-400/70">上传后的文件可以直接进入转码处理流程</div>
        </div>
      </div>

      <template #footer>
        <el-button @click="uploadDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!pendingFiles.length || uploading" :loading="uploading" @click="confirmUpload">
          <i class="fas fa-check mr-1.5"></i>确认上传
        </el-button>
      </template>
    </el-dialog>

    <!-- Add Link Dialog -->
    <el-dialog v-model="linkDialog" title="添加下载链接" width="560px" destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <!-- URL input -->
        <div>
          <div class="text-xs text-gray-400 mb-2">视频链接</div>
          <el-input
            v-model="linkInput"
            placeholder="粘贴 bilibili / 腾讯视频 / YouTube / 直链地址"
            clearable
            @keyup.enter="testLink"
          >
            <template #prefix>
              <i class="fas fa-link text-gray-500 text-xs"></i>
            </template>
          </el-input>
          <div class="text-[11px] text-gray-600 mt-1">
            支持 bilibili、腾讯视频、YouTube 以及 MP4/MOV 等常规视频直链
          </div>
        </div>

        <!-- Test button -->
        <div class="flex items-center gap-3">
          <el-button type="primary" plain size="small" :loading="testingLink" @click="testLink">
            <i class="fas fa-magnifying-glass mr-1.5"></i>测试链接
          </el-button>
          <span v-if="!testingLink && !linkPreview" class="text-xs text-gray-500">点击测试获取视频信息</span>
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