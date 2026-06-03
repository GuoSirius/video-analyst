<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { crawlerAPI, whisperAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePagination } from '../composables/usePagination'

const route = useRoute()

// --- State ---
const tasks = ref<any[]>([])
const items = ref<any[]>([])
const selectedTaskId = ref((route.query.taskId as string) || '')
const statusFilter = ref('all')
let sseConnection: EventSource | null = null
const selectedIds = ref<string[]>([])
const detailItem = ref<any>(null)
const detailVisible = ref(false)
const detailViewMode = ref<'table' | 'json'>('table')

// --- Task actions ---
async function startTask(id: string) {
  try { await crawlerAPI.startTask(id); ElMessage.success('任务已开始'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function pauseTask(id: string) {
  try { await crawlerAPI.pauseTask(id); ElMessage.success('任务已暂停'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此任务吗？', '确认', { type: 'warning' })
    await crawlerAPI.stopTask(id); ElMessage.success('任务已终止'); refresh()
  } catch { /* cancelled */ }
}
async function retryTask(id: string) {
  try { await crawlerAPI.retryTask(id); ElMessage.success('已重新加入队列'); refresh() }
  catch { ElMessage.error('操作失败') }
}
async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('重新执行将清除已有的采集数据并从头开始。', '确认', { type: 'warning' })
    await crawlerAPI.reRunTask(id); ElMessage.success('任务已重新执行'); refresh()
  } catch { /* cancelled */ }
}
async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此任务及所有采集数据吗？', '确认删除', { type: 'warning' })
    await crawlerAPI.deleteTask(id); ElMessage.success('任务已删除'); refresh()
  } catch { /* cancelled */ }
}

// --- Data ---
async function refresh() {
  const [tRes, iRes] = await Promise.all([
    crawlerAPI.getTasks(),
    crawlerAPI.getItems(),
  ])
  tasks.value = tRes.data
  items.value = iRes.data
}

async function refreshItemsOnly() {
  const { data } = await crawlerAPI.getItems()
  items.value = data
}

async function continuePipeline() {
  if (!selectedIds.value.length) { ElMessage.warning('请先勾选要处理的项'); return }
  try {
    const { data } = await whisperAPI.transcribe({ itemIds: selectedIds.value })
    if (data.error) { ElMessage.error(data.error); return }
    ElMessage.success(`已送入流水线: ${data.tasks?.length || 0} 个任务`)
    refresh()
  } catch { ElMessage.error('启动失败') }
}

function showDetail(row: any) {
  let extra: Record<string, any> = {}
  try { extra = typeof row.extra_data === 'string' ? JSON.parse(row.extra_data) : (row.extra_data || {}) }
  catch { extra = {} }
  detailItem.value = { ...row, extra }
  detailViewMode.value = 'table'
  detailVisible.value = true
}

function expectedFields(item: any): string[] {
  const task = tasks.value.find((t: any) => t.id === item.task_id)
  if (!task?.payload?.rules) return []
  return task.payload.rules
    .filter((r: any) => r.name)
    .map((r: any) => r.name)
    .filter((n: string) => !['title', 'media_url', 'video_url', 'audio_url', 'url'].includes(n))
}

function extraFields(item: any): [string, any][] {
  if (!item.extra_data) return []
  try {
    const data = typeof item.extra_data === 'string' ? JSON.parse(item.extra_data) : item.extra_data
    return Object.entries(data || {}).filter(([k]) => !['title', 'media_url', 'video_url', 'audio_url', 'url'].includes(k))
  } catch { return [] }
}

function formatValue(v: any): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

function isEmpty(v: any): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')
}

async function deleteItem(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此采集项吗？', '确认删除', { type: 'warning' })
    await crawlerAPI.deleteItem(id)
    ElMessage.success('已删除')
    refresh()
  } catch { /* cancelled */ }
}

async function retryItem(id: string) {
  try {
    await ElMessageBox.confirm('将重新执行该项所属的采集任务，已有数据会被清除。确定继续？', '确认', { type: 'warning' })
    await crawlerAPI.retryItem(id)
    ElMessage.success('任务已重新运行')
    refresh()
  } catch { /* cancelled */ }
}

async function retrySingleItem(id: string) {
  try {
    await ElMessageBox.confirm('将重新抓取该项数据（仅该项，不影响其他）。确定继续？', '确认', { type: 'info' })
    const res = await crawlerAPI.recrawlItem(id)
    if (res.data?.error) { ElMessage.error(res.data.error) }
    else { ElMessage.success('已重新抓取'); refreshItemsOnly() }
  } catch { ElMessage.error('操作失败') }
}

async function recrawlSingleItem(id: string) {
  try {
    await ElMessageBox.confirm('将重新抓取该项数据。确定继续？', '确认', { type: 'info' })
    const res = await crawlerAPI.recrawlItem(id)
    if (res.data?.error) { ElMessage.error(res.data.error) }
    else { ElMessage.success('已重新抓取'); refreshItemsOnly() }
  } catch { ElMessage.error('操作失败') }
}

function copyJson() {
  if (!detailItem.value) return
  const obj: Record<string, any> = {
    title: detailItem.value.title,
    media_url: detailItem.value.media_url,
    media_type: detailItem.value.media_type,
    media_source: detailItem.value.media_source,
    source_url: detailItem.value.source_url,
    ...detailItem.value.extra,
  }
  navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
  ElMessage.success('已复制到剪贴板')
}

// --- Computed ---
const filteredItems = computed(() => {
  let result = items.value
  if (selectedTaskId.value) result = result.filter((i: any) => i.task_id === selectedTaskId.value)
  if (statusFilter.value !== 'all') result = result.filter((i: any) => i.status === statusFilter.value)
  return result
})

// --- Pagination ---
const { page: itemPage, pageSize: itemPageSize, total: itemTotal, pageSizes: itemPageSizes, pagedData: pagedItems, onPageChange: onItemPageChange, onPageSizeChange: onItemPageSizeChange } = usePagination({
  data: () => filteredItems.value,
  defaultPageSize: 20,
  resetOn: [selectedTaskId, statusFilter],
})

const taskNameMap = computed(() => {
  const m: Record<string, string> = {}
  tasks.value.forEach((t: any) => {
    m[t.id] = t.payload?.name || t.payload?.url || t.id.slice(0, 8)
  })
  return m
})

const currentTask = computed(() => {
  if (!selectedTaskId.value) return null
  return tasks.value.find((t: any) => t.id === selectedTaskId.value)
})

const itemCounts = computed(() => {
  const m: Record<string, number> = {}
  items.value.forEach((i: any) => { m[i.task_id] = (m[i.task_id] || 0) + 1 })
  return m
})

function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '未开始', running: '进行中', completed: '已完成',
    failed: '执行失败', cancelled: '用户终止', paused: '已暂停',
  }
  return map[s] || s
}

function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canPause(s: string) { return s === 'running' }
function canStop(s: string) { return s === 'running' || s === 'paused' }
function canRetry(s: string) { return s === 'failed' }
function canReRun(s: string) { return s === 'completed' || s === 'cancelled' }
function canDelete(s: string) { return s === 'pending' || s === 'completed' || s === 'failed' || s === 'cancelled' }

function itemStatusLabel(s: string) {
  const map: Record<string, string> = {
    crawled: '已采集', pending: '待处理', processing: '处理中',
    downloaded: '已下载', transcoded: '已转码', error: '错误',
  }
  return map[s] || s || '未知'
}

/** When title is empty, pick the best display field from extra_data */
function pickDisplayField(item: any): string {
  try {
    const extra = item.extra_data
    if (!extra) return ''
    const data = typeof extra === 'string' ? JSON.parse(extra) : extra
    if (!data || typeof data !== 'object') return ''
    const entries = Object.entries(data) as [string, any][]
    if (!entries.length) return ''
    // Prefer fields that look like titles: longer text, not URLs, not numbers
    const urlPattern = /^https?:\/\//
    const textFields = entries.filter(([_, v]) =>
      typeof v === 'string' && v.length > 1 && !urlPattern.test(v)
    )
    if (textFields.length) {
      // Sort by length descending — longest text is likely the title
      textFields.sort((a, b) => (b[1] as string).length - (a[1] as string).length)
      const val = textFields[0][1] as string
      return val.length > 80 ? val.slice(0, 80) + '…' : val
    }
    // Fallback: use any non-empty value that's not a URL
    const anyField = entries.find(([_, v]) => typeof v === 'string' && v && !urlPattern.test(v))
    return anyField ? (anyField[1] as string).slice(0, 80) : ''
  } catch {
    return ''
  }
}

watch(selectedTaskId, () => { selectedIds.value = [] })

// SSE real-time updates — must use full backend URL (EventSource doesn't go through axios)
const SSE_URL = `${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api'}/crawler/events`

function setupSSE() {
  if (sseConnection) sseConnection.close()
  sseConnection = new EventSource(SSE_URL)
  sseConnection.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data)
      if (evt.type === 'crawl') {
        const idx = tasks.value.findIndex((t: any) => t.id === evt.taskId)
        if (idx !== -1) {
          if (evt.status === 'deleted') {
            tasks.value.splice(idx, 1)
          } else {
            Object.assign(tasks.value[idx], {
              status: evt.status,
              progress: evt.progress,
              result: evt.result,
              error: evt.error,
              started_at: evt.started_at || tasks.value[idx].started_at,
              updated_at: evt.updated_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
            })
            // Refresh items when task produces/stops with data
            if (['completed', 'failed', 'cancelled', 'paused'].includes(evt.status)) {
              refreshItemsOnly()
            }
            // Also refresh task list to update item counts
            if (['completed', 'failed', 'cancelled', 'paused'].includes(evt.status)) {
              crawlerAPI.getTasks().then(({ data }) => { tasks.value = data })
            }
          }
        } else if (evt.status !== 'deleted') {
          refresh()
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
  refresh()
  setupSSE()
})
onUnmounted(teardownSSE)
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">采集结果</h2>
        <p class="text-[13px] text-gray-500">查看和管理所有采集到的结构化数据</p>
      </div>
      <div class="flex items-center gap-2">
        <el-button
          v-if="selectedIds.length"
          type="success" size="small"
          @click="continuePipeline"
        >
          <i class="fas fa-forward-step mr-1.5"></i>继续流水线 → 识别+AI分析
        </el-button>
      </div>
    </div>

    <!-- Task info bar -->
    <div v-if="currentTask" class="card-static mb-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <span class="text-sm font-semibold text-gray-200">
            {{ currentTask.payload?.name || currentTask.payload?.url || currentTask.id.slice(0, 12) }}
          </span>
          <span class="badge" :class="{
            'badge-completed': currentTask.status === 'completed',
            'badge-running': currentTask.status === 'running',
            'badge-failed': currentTask.status === 'failed',
            'badge-paused': currentTask.status === 'paused',
            'badge-pending': currentTask.status === 'pending',
            'badge-cancelled': currentTask.status === 'cancelled',
          }">{{ statusLabel(currentTask.status) }}</span>
          <el-progress :percentage="currentTask.progress" :stroke-width="5" class="!w-32"
            :status="currentTask.status === 'failed' ? 'exception' : currentTask.status === 'completed' ? 'success' : undefined" />
        </div>
        <div class="flex items-center gap-1">
          <el-button v-if="canStart(currentTask.status)" size="small" type="primary" plain @click="startTask(currentTask.id)">
            {{ currentTask.status === 'paused' ? '继续' : '开始' }}
          </el-button>
          <el-button v-if="canPause(currentTask.status)" size="small" type="warning" plain @click="pauseTask(currentTask.id)">暂停</el-button>
          <el-button v-if="canStop(currentTask.status)" size="small" type="danger" plain @click="stopTask(currentTask.id)">终止</el-button>
          <el-button v-if="canRetry(currentTask.status)" size="small" type="warning" plain @click="retryTask(currentTask.id)">重试</el-button>
          <el-button v-if="canReRun(currentTask.status)" size="small" plain @click="reRunTask(currentTask.id)">重新执行</el-button>
          <el-button v-if="canDelete(currentTask.status)" size="small" type="danger" plain @click="deleteTask(currentTask.id)">删除</el-button>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex items-center gap-3">
        <el-select v-model="selectedTaskId" placeholder="全部任务" size="small" class="!w-64" clearable>
          <el-option
            v-for="t in tasks" :key="t.id"
            :label="`${t.payload?.name || t.payload?.url || t.id.slice(0, 8)} (${itemCounts[t.id] || 0}条)`"
            :value="t.id"
          />
        </el-select>
        <div class="flex gap-1">
          <el-button
            v-for="f in [
              { k: 'all', l: '全部状态' },
              { k: 'crawled', l: '已采集' },
              { k: 'pending', l: '待处理' },
              { k: 'downloaded', l: '已下载' },
              { k: 'transcoded', l: '已转码' },
              { k: 'error', l: '错误' },
            ]"
            :key="f.k" size="small"
            :type="statusFilter === f.k ? 'primary' : 'default'"
            :plain="statusFilter !== f.k"
            @click="statusFilter = f.k"
          >{{ f.l }}</el-button>
        </div>
      </div>
      <span class="text-xs text-gray-500">共 {{ filteredItems.length }} 条</span>
    </div>

    <!-- Items Table -->
    <div class="card-static">
      <el-table
        v-if="filteredItems.length"
        :data="pagedItems"
        size="small"
        max-height="500"
        @selection-change="(rows: any) => selectedIds = rows.map((r: any) => r.id)"
      >
        <el-table-column type="selection" width="40" fixed="left" :reserve-selection="true" />
        <el-table-column type="index" label="序号" width="55" align="center" fixed="left" />
        <el-table-column label="所属任务" width="130" show-overflow-tooltip fixed="left">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ taskNameMap[row.task_id] || row.task_id?.slice(0, 8) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="标题" show-overflow-tooltip min-width="160" fixed="left">
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ row.title || pickDisplayField(row) || '(无标题)' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <span class="text-xs" :class="row.media_type === 'video' ? 'text-blue-400' : row.media_type === 'audio' ? 'text-emerald-400' : 'text-gray-500'">
              {{ row.media_type || '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            <span class="text-xs text-gray-400">{{ row.media_source || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <span class="text-xs" :class="{
              'text-emerald-400': row.status === 'crawled' || row.status === 'downloaded' || row.status === 'transcoded',
              'text-yellow-400': row.status === 'pending',
              'text-blue-400': row.status === 'processing',
              'text-red-400': row.status === 'error',
              'text-gray-500': !row.status,
            }">{{ itemStatusLabel(row.status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="数据字段" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ extraFields(row).map(([k]) => k).join(' / ') || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="采集时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1">
              <el-button size="small" type="primary" plain @click="showDetail(row)">查看</el-button>
              <el-button v-if="row.status === 'error'" size="small" type="warning" plain @click="retrySingleItem(row.id)">重试</el-button>
              <el-button v-if="row.status === 'crawled'" size="small" plain @click="recrawlSingleItem(row.id)">重采</el-button>
              <el-button size="small" type="danger" plain @click="deleteItem(row.id)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="filteredItems.length > itemPageSize" class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="itemPage"
          v-model:page-size="itemPageSize"
          :page-sizes="itemPageSizes"
          :total="itemTotal"
          layout="total, sizes, prev, pager, next"
          size="small"
          background
          @size-change="onItemPageSizeChange"
          @current-change="onItemPageChange"
        />
      </div>
      <div v-if="!filteredItems.length" class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-table text-3xl mb-3 block opacity-30"></i>
        {{ selectedTaskId ? '该任务暂无采集结果' : '暂无采集数据，请先在任务列表中创建并运行采集任务' }}
      </div>
    </div>

    <!-- Detail Dialog -->
    <el-dialog v-model="detailVisible" title="采集结果详情" width="700px" destroy-on-close :close-on-click-modal="false">
      <div v-if="detailItem" class="space-y-4">
        <!-- Toolbar -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <el-button size="small" :type="detailViewMode === 'table' ? 'primary' : 'default'" plain @click="detailViewMode = 'table'">
              <i class="fas fa-table mr-1"></i>字段视图
            </el-button>
            <el-button size="small" :type="detailViewMode === 'json' ? 'primary' : 'default'" plain @click="detailViewMode = 'json'">
              <i class="fas fa-code mr-1"></i>JSON
            </el-button>
          </div>
          <el-button size="small" plain @click="copyJson">
            <i class="fas fa-copy mr-1"></i>复制
          </el-button>
        </div>

        <!-- Table View -->
        <div v-if="detailViewMode === 'table'">
          <!-- Basic info -->
          <div class="text-[11px] text-gray-500 mb-2 font-medium uppercase tracking-wider">基本信息</div>
          <div class="rounded-lg bg-gray-900/60 border border-gray-700/40 overflow-hidden mb-4">
            <table class="w-full text-xs">
              <tbody>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">title</td>
                  <td class="px-4 py-2.5 text-gray-200">{{ detailItem.title || '(空)' }}</td>
                </tr>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">media_url</td>
                  <td class="px-4 py-2.5 text-gray-200 break-all">{{ detailItem.media_url || '(空)' }}</td>
                </tr>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">media_type</td>
                  <td class="px-4 py-2.5 text-gray-200">{{ detailItem.media_type || '(空)' }}</td>
                </tr>
                <tr class="border-b border-gray-700/30">
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">media_source</td>
                  <td class="px-4 py-2.5 text-gray-200">{{ detailItem.media_source || '(空)' }}</td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 text-gray-400 w-28 font-mono align-top">source_url</td>
                  <td class="px-4 py-2.5 text-gray-300 break-all text-[11px]">{{ detailItem.source_url || '(空)' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Extracted data -->
          <div class="text-[11px] text-gray-500 mb-2 font-medium uppercase tracking-wider">
            提取数据
            <span class="text-gray-600 normal-case ml-1">
              (规则字段: {{ expectedFields(detailItem).join(', ') || '无' }})
            </span>
          </div>
          <div v-if="Object.keys(detailItem.extra).length" class="rounded-lg bg-gray-900/60 border border-gray-700/40 overflow-hidden">
            <table class="w-full text-xs">
              <tbody>
                <tr v-for="(val, key) in detailItem.extra" :key="key" class="border-b border-gray-700/30 last:border-0">
                  <td class="px-4 py-2.5 text-gray-400 w-32 font-mono align-top">{{ key }}</td>
                  <td class="px-4 py-2.5 align-top">
                    <span v-if="isEmpty(val)" class="text-gray-600 italic">(空)</span>
                    <span v-else class="text-gray-200 whitespace-pre-wrap break-all">{{ formatValue(val) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="text-xs text-gray-500 text-center py-6 bg-gray-900/30 rounded-lg border border-gray-700/20">
            <i class="fas fa-circle-exclamation mr-1 text-gray-600"></i>无额外提取数据 — 请检查采集规则配置
          </div>
        </div>

        <!-- JSON View -->
        <pre v-else class="text-xs text-gray-300 bg-gray-900/80 border border-gray-700/40 rounded-lg p-5 overflow-x-auto max-h-[500px] overflow-y-auto font-mono leading-relaxed">{{ (() => {
          const obj: Record<string, any> = {
            title: detailItem.title,
            media_url: detailItem.media_url,
            media_type: detailItem.media_type,
            media_source: detailItem.media_source,
            source_url: detailItem.source_url,
            ...detailItem.extra,
          }
          return JSON.stringify(obj, null, 2)
        })() }}</pre>

        <div class="text-[11px] text-gray-600 flex items-center justify-between">
          <span>采集时间: {{ detailItem.created_at }}</span>
          <span class="font-mono text-gray-700">ID: {{ detailItem.id }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>
