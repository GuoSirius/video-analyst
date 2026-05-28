<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { crawlerAPI } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'

// --- Task list state ---
const tasks = ref<any[]>([])
const statusFilter = ref('all')
const loading = ref(false)

// --- Dialog state ---
const dialogVisible = ref(false)
const dialogTitle = ref('新建任务')
const editingTaskId = ref<string | null>(null)
const formName = ref('')
const formUrl = ref('')
const formItemSelector = ref('')
const formNextPageSelector = ref('')
const formMaxPages = ref(1)
const formRules = ref([
  { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '' },
  { name: 'media_url', selector: 'video,audio,source,a[href$=".mp4"]', attr: 'src' },
])
const formDetailLinkSelector = ref('')
const formDetailRules = ref<{ name: string; selector: string; attr: string }[]>([])

const presetRules: Record<string, { name: string; selector: string; attr: string }[]> = {
  basic: [
    { name: 'title', selector: 'h1,.title', attr: '' },
    { name: 'media_url', selector: 'video,audio,source', attr: 'src' },
  ],
  list: [
    { name: 'title', selector: 'h2 a,.title a,h3 a', attr: '' },
    { name: 'media_url', selector: 'a[href*="video"],a[href*="mp4"]', attr: 'href' },
    { name: 'date', selector: '.date,time', attr: '' },
    { name: 'author', selector: '.author,.byline', attr: '' },
  ],
}

// --- Computed ---
const filteredTasks = computed(() => {
  if (statusFilter.value === 'all') return tasks.value
  return tasks.value.filter((t: any) => t.status === statusFilter.value)
})

const itemCounts = ref<Record<string, number>>({})

// --- Actions ---
async function refresh() {
  const { data } = await crawlerAPI.getTasks()
  tasks.value = data
  // Load item counts
  const { data: items } = await crawlerAPI.getItems()
  const counts: Record<string, number> = {}
  items.forEach((i: any) => {
    counts[i.task_id] = (counts[i.task_id] || 0) + 1
  })
  itemCounts.value = counts
}

function openCreateDialog() {
  dialogTitle.value = '新建任务'
  editingTaskId.value = null
  formName.value = ''
  formUrl.value = ''
  formItemSelector.value = ''
  formNextPageSelector.value = ''
  formMaxPages.value = 1
  formRules.value = [
    { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '' },
    { name: 'media_url', selector: 'video,audio,source,a[href$=".mp4"]', attr: 'src' },
  ]
  formDetailLinkSelector.value = ''
  formDetailRules.value = []
  dialogVisible.value = true
}

function openEditDialog(task: any) {
  const p = task.payload
  dialogTitle.value = '编辑任务'
  editingTaskId.value = task.id
  formName.value = p.name || ''
  formUrl.value = p.url || ''
  formItemSelector.value = p.itemSelector || ''
  formNextPageSelector.value = p.nextPageSelector || ''
  formMaxPages.value = p.maxPages ?? 1
  formRules.value = p.rules?.length ? [...p.rules] : [
    { name: 'title', selector: 'h1,.title,[class*="title"]', attr: '' },
    { name: 'media_url', selector: 'video,audio,source,a[href$=".mp4"]', attr: 'src' },
  ]
  formDetailLinkSelector.value = p.detailLinkSelector || ''
  formDetailRules.value = p.detailRules?.length ? [...p.detailRules] : []
  dialogVisible.value = true
}

function addRule(target: 'list' | 'detail') {
  if (target === 'list') {
    formRules.value.push({ name: '', selector: '', attr: '' })
  } else {
    formDetailRules.value.push({ name: '', selector: '', attr: '' })
  }
}

function removeRule(target: 'list' | 'detail', i: number) {
  if (target === 'list' && formRules.value.length > 1) {
    formRules.value.splice(i, 1)
  } else if (target === 'detail') {
    formDetailRules.value.splice(i, 1)
  }
}

function applyPreset(n: string) {
  if (presetRules[n]) formRules.value = [...presetRules[n]]
}

async function submitForm() {
  if (!formUrl.value) { ElMessage.warning('请输入页面地址'); return }
  const payload = {
    name: formName.value || formUrl.value.slice(0, 60),
    url: formUrl.value,
    rules: formRules.value.filter(r => r.name && r.selector),
    itemSelector: formItemSelector.value || undefined,
    nextPageSelector: formNextPageSelector.value || undefined,
    maxPages: formMaxPages.value,
    detailLinkSelector: formDetailLinkSelector.value || undefined,
    detailRules: formDetailRules.value.filter(r => r.name && r.selector).length
      ? formDetailRules.value.filter(r => r.name && r.selector) : undefined,
  }
  loading.value = true
  try {
    if (editingTaskId.value) {
      await crawlerAPI.updateTask(editingTaskId.value, payload)
      ElMessage.success('任务已更新')
    } else {
      await crawlerAPI.start(payload)
      ElMessage.success('采集任务已创建')
    }
    dialogVisible.value = false
    await refresh()
  } catch { ElMessage.error('操作失败') }
  loading.value = false
}

async function startTask(id: string) {
  try {
    await crawlerAPI.startTask(id)
    ElMessage.success('任务已开始')
    refresh()
  } catch { ElMessage.error('操作失败') }
}

async function pauseTask(id: string) {
  try {
    await crawlerAPI.pauseTask(id)
    ElMessage.success('任务已暂停')
    refresh()
  } catch { ElMessage.error('操作失败') }
}

async function stopTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要终止此任务吗？已采集的数据会保留。', '确认', { type: 'warning' })
    await crawlerAPI.stopTask(id)
    ElMessage.success('任务已终止')
    refresh()
  } catch { /* cancelled */ }
}

async function retryTask(id: string) {
  try {
    await crawlerAPI.retryTask(id)
    ElMessage.success('已重新加入队列')
    refresh()
  } catch { ElMessage.error('操作失败') }
}

async function reRunTask(id: string) {
  try {
    await ElMessageBox.confirm('重新运行将清除已有的采集数据并从头开始，确定继续？', '确认', { type: 'warning' })
    await crawlerAPI.reRunTask(id)
    ElMessage.success('任务已重新运行')
    refresh()
  } catch { /* cancelled */ }
}

async function deleteTask(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除此任务吗？相关的采集数据也会被删除。', '确认删除', { type: 'warning' })
    await crawlerAPI.deleteTask(id)
    ElMessage.success('任务已删除')
    refresh()
  } catch { /* cancelled */ }
}

// --- Status helpers ---
function statusLabel(s: string) {
  const map: Record<string, string> = {
    pending: '等待中', running: '进行中', completed: '已完成',
    failed: '失败', cancelled: '已取消', paused: '已暂停',
  }
  return map[s] || s
}

function statusClass(s: string) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    running: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
    failed: 'bg-red-500/15 text-red-300 border-red-500/25',
    cancelled: 'bg-gray-500/15 text-gray-400 border-gray-500/25',
    paused: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
    pending: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  }
  return map[s] || ''
}

// Check if a task action is available
function canStart(s: string) { return s === 'pending' || s === 'paused' }
function canPause(s: string) { return s === 'running' }
function canStop(s: string) { return s === 'running' || s === 'paused' }
function canRetry(s: string) { return s === 'failed' }
function canReRun(s: string) { return s === 'completed' || s === 'failed' || s === 'cancelled' }
function canEdit(s: string) { return s !== 'running' }
function canDelete(s: string) { return s !== 'running' }

onMounted(refresh)
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-5">
      <div>
        <h2 class="text-lg font-bold mb-1">爬虫任务</h2>
        <p class="text-[13px] text-gray-500">管理采集任务配置，查看任务执行状态</p>
      </div>
      <el-button type="primary" size="small" @click="openCreateDialog">
        <i class="fas fa-plus mr-1.5"></i>新建任务
      </el-button>
    </div>

    <!-- Filters -->
    <div class="flex items-center justify-between mb-4 card-static">
      <div class="flex gap-2">
        <el-button
          v-for="f in [
            { k: 'all', l: '全部' },
            { k: 'running', l: '进行中' },
            { k: 'completed', l: '已完成' },
            { k: 'failed', l: '失败' },
            { k: 'paused', l: '已暂停' },
          ]"
          :key="f.k" size="small"
          :type="statusFilter === f.k ? 'primary' : 'default'"
          :plain="statusFilter !== f.k"
          @click="statusFilter = f.k"
        >{{ f.l }}</el-button>
      </div>
      <span class="text-xs text-gray-500">共 {{ filteredTasks.length }} 个任务</span>
    </div>

    <!-- Task Table -->
    <div class="card-static">
      <el-table v-if="filteredTasks.length" :data="filteredTasks" size="small" row-key="id">
        <el-table-column label="任务名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-300">{{ row.payload?.name || row.payload?.url || row.id.slice(0, 12) + '...' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="页面地址" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.payload?.url }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
              :class="statusClass(row.status)">
              {{ statusLabel(row.status) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140">
          <template #default="{ row }">
            <el-progress
              :percentage="row.progress"
              :stroke-width="6"
              :status="row.status === 'failed' ? 'exception' : row.status === 'completed' ? 'success' : undefined"
            />
          </template>
        </el-table-column>
        <el-table-column label="采集数" width="80" align="center">
          <template #default="{ row }">
            <span class="text-xs text-gray-400">{{ itemCounts[row.id] || 0 }} 条</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="{ row }">
            <span class="text-xs text-gray-500">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="280" align="center">
          <template #default="{ row }">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <el-button v-if="canStart(row.status)" size="small" type="primary" plain @click="startTask(row.id)">
                {{ row.status === 'paused' ? '继续' : '开始' }}
              </el-button>
              <el-button v-if="canPause(row.status)" size="small" type="warning" plain @click="pauseTask(row.id)">
                暂停
              </el-button>
              <el-button v-if="canStop(row.status)" size="small" type="danger" plain @click="stopTask(row.id)">
                终止
              </el-button>
              <el-button v-if="canRetry(row.status)" size="small" type="warning" plain @click="retryTask(row.id)">
                重试
              </el-button>
              <el-button v-if="canReRun(row.status)" size="small" plain @click="reRunTask(row.id)">
                重新运行
              </el-button>
              <el-button v-if="canEdit(row.status)" size="small" plain @click="openEditDialog(row)">
                编辑
              </el-button>
              <el-button v-if="canDelete(row.status)" size="small" type="danger" plain @click="deleteTask(row.id)">
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-12 text-gray-500 text-sm">
        <i class="fas fa-bug text-3xl mb-3 block opacity-30"></i>暂无任务
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="800px" destroy-on-close>
      <div class="space-y-5">
        <!-- Basic config -->
        <div>
          <h4 class="text-sm font-semibold mb-3 flex items-center gap-2">
            <i class="fas fa-globe text-blue-400"></i>基本配置
          </h4>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-xs text-gray-400 mb-1.5">任务名称（可选）</div>
              <el-input v-model="formName" placeholder="留空则使用 URL 前60字符" size="small" />
            </div>
            <div>
              <div class="text-xs text-gray-400 mb-1.5">页面地址</div>
              <el-input v-model="formUrl" placeholder="https://example.com/articles" size="small" />
            </div>
          </div>
          <div class="grid grid-cols-3 gap-4 mt-4">
            <div>
              <div class="text-xs text-gray-400 mb-1.5">列表项选择器</div>
              <el-input v-model="formItemSelector" placeholder=".article-item" size="small" />
              <div class="text-[11px] text-gray-600 mt-1">留空提取整页</div>
            </div>
            <div>
              <div class="text-xs text-gray-400 mb-1.5">下一页选择器</div>
              <el-input v-model="formNextPageSelector" placeholder=".pagination .next" size="small" />
              <div class="text-[11px] text-gray-600 mt-1">留空不翻页</div>
            </div>
            <div>
              <div class="text-xs text-gray-400 mb-1.5">最大页数 (0=全部)</div>
              <el-input-number v-model="formMaxPages" :min="0" :max="9999" :step="1" :precision="0" size="small" class="!w-full" />
            </div>
          </div>
        </div>

        <!-- List page rules -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <i class="fas fa-list text-amber-400"></i>列表页提取规则
            </h4>
            <div class="flex gap-2">
              <el-button size="small" @click="applyPreset('basic')">基础模板</el-button>
              <el-button size="small" @click="applyPreset('list')">列表模板</el-button>
              <el-button size="small" @click="addRule('list')"><i class="fas fa-plus mr-1"></i>添加</el-button>
            </div>
          </div>
          <div class="space-y-2">
            <div v-for="(rule, i) in formRules" :key="i"
              class="flex items-center gap-3 p-2.5 rounded-lg bg-gray-900/40 border border-gray-700/30">
              <span class="text-[11px] text-gray-600 w-5 text-center">{{ i + 1 }}</span>
              <el-input v-model="rule.name" placeholder="字段名" size="small" class="!w-32" />
              <el-input v-model="rule.selector" placeholder="CSS 选择器" size="small" class="flex-1" />
              <el-input v-model="rule.attr" placeholder="属性(可选)" size="small" class="!w-32" />
              <el-button v-if="formRules.length > 1" size="small" type="danger" circle plain @click="removeRule('list', i)">
                <i class="fas fa-xmark"></i>
              </el-button>
            </div>
          </div>
          <div class="text-[11px] text-gray-600 mt-2">attr 留空=提取文本, 填写=提取属性值 (如 src/href)</div>
        </div>

        <!-- Detail page rules -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-semibold flex items-center gap-2">
              <i class="fas fa-file-lines text-emerald-400"></i>详情页提取规则（可选）
            </h4>
            <el-button size="small" @click="addRule('detail')"><i class="fas fa-plus mr-1"></i>添加</el-button>
          </div>
          <div class="mb-3">
            <div class="text-xs text-gray-400 mb-1.5">详情页链接选择器（从列表项中提取详情页URL）</div>
            <el-input v-model="formDetailLinkSelector" placeholder="a.title, h2 a" size="small" class="!w-64" />
          </div>
          <div class="space-y-2" v-if="formDetailRules.length">
            <div v-for="(rule, i) in formDetailRules" :key="i"
              class="flex items-center gap-3 p-2.5 rounded-lg bg-gray-900/40 border border-gray-700/30">
              <span class="text-[11px] text-gray-600 w-5 text-center">{{ i + 1 }}</span>
              <el-input v-model="rule.name" placeholder="字段名" size="small" class="!w-32" />
              <el-input v-model="rule.selector" placeholder="CSS 选择器" size="small" class="flex-1" />
              <el-input v-model="rule.attr" placeholder="属性(可选)" size="small" class="!w-32" />
              <el-button size="small" type="danger" circle plain @click="removeRule('detail', i)">
                <i class="fas fa-xmark"></i>
              </el-button>
            </div>
          </div>
          <div class="text-[11px] text-gray-600 mt-1">详情页规则为空则不抓取详情页</div>
        </div>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!formUrl || loading" :loading="loading" @click="submitForm">
          {{ editingTaskId ? '保存修改' : '创建任务' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
