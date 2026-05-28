<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { crawlerAPI, whisperAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

// --- State ---
const tasks = ref<any[]>([])
const items = ref<any[]>([])
const selectedTaskId = ref('')
const statusFilter = ref('all')
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
    await ElMessageBox.confirm('重新运行将清除已有的采集数据并从头开始。', '确认', { type: 'warning' })
    await crawlerAPI.reRunTask(id); ElMessage.success('任务已重新运行'); refresh()
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
    await ElMessageBox.confirm('将重新运行该项所属的采集任务，已有数据会被清除。确定继续？', '确认', { type: 'warning' })
    await crawlerAPI.retryItem(id)
    ElMessage.success('任务已重新运行')
    refresh()
  } catch { /* cancelled */ }
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
    pending: '等待中', running: '进行中', completed: '已完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
  }
  return map[s] || s
}

function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canPause(s: string) { return s === 'running' }
function canStop(s: string) { return s === 'running' || s === 'paused' }
function canRetry(s: string) { return s === 'failed' }
function canReRun(s: string) { return s === 'completed' || s === 'failed' || s === 'cancelled' }
function canDelete(s: string) { return s !== 'running' }

watch(selectedTaskId, () => { selectedIds.value = [] })
onMounted(refresh)
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
          <el-button v-if="canReRun(currentTask.status)" size="small" plain @click="reRunTask(currentTask.id)">重新运行</el-button>
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
        :data="filteredItems"
        size="small"
        max-height="500"
        @selection-change="(rows: any) => selectedIds = rows.map((r: any) => r.id)"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column label="所属任务" width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ taskNameMap[row.task_id] || row.task_id?.slice(0, 8) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="160" />
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
              'text-yellow-400': row.status === 'pending',
              'text-emerald-400': row.status === 'downloaded' || row.status === 'transcoded',
              'text-red-400': row.status === 'error',
              'text-gray-500': !row.status,
            }">{{ row.status || 'pending' }}</span>
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
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1">
              <el-button size="small" type="primary" plain @click="showDetail(row)">查看</el-button>
              <el-button size="small" type="danger" plain @click="deleteItem(row.id)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-table text-3xl mb-3 block opacity-30"></i>
        {{ selectedTaskId ? '该任务暂无采集结果' : '暂无采集数据，请先在任务列表中创建并运行采集任务' }}
      </div>
    </div>

    <!-- Detail Dialog -->
    <el-dialog v-model="detailVisible" title="采集结果详情" width="700px" destroy-on-close>
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
