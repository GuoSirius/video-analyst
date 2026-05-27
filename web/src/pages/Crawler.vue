<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { crawlerAPI } from '../api'
import { ElMessage } from 'element-plus'

const url = ref('')
const itemSelector = ref('')
const nextPageSelector = ref('')
const maxPages = ref(1)
const rules = ref([
  { name: 'title', selector: 'h1, .title, [class*="title"]', attr: '', desc: '标题' },
  { name: 'media_url', selector: 'video, audio, source, a[href$=".mp4"], a[href$=".mp3"]', attr: 'src', desc: '媒体链接' },
])
const loading = ref(false)
const activeTab = ref('config')
const tasks = ref<any[]>([])
const items = ref<any[]>([])
const selectedTaskId = ref('')

const presetRules: Record<string, { name: string; selector: string; attr: string; desc: string }[]> = {
  basic: [
    { name: 'title', selector: 'h1, .title', attr: '', desc: '标题' },
    { name: 'media_url', selector: 'video, audio, source', attr: 'src', desc: '媒体链接' },
  ],
  list: [
    { name: 'title', selector: 'h2 a, .title a, h3 a', attr: '', desc: '标题' },
    { name: 'media_url', selector: 'a[href*="video"], a[href*="mp4"]', attr: 'href', desc: '媒体链接' },
    { name: 'date', selector: '.date, time', attr: '', desc: '日期' },
    { name: 'author', selector: '.author, .byline', attr: '', desc: '作者' },
  ],
}

function applyPreset(name: string) {
  const preset = presetRules[name]
  if (preset) rules.value = [...preset]
}

function addRule() { rules.value.push({ name: '', selector: '', attr: '', desc: '' }) }
function removeRule(i: number) { if (rules.value.length > 1) rules.value.splice(i, 1) }

async function refreshTasks() {
  const [tRes, iRes] = await Promise.all([crawlerAPI.getTasks(), crawlerAPI.getItems()])
  tasks.value = tRes.data; items.value = iRes.data
}

async function startCrawl() {
  if (!url.value) { ElMessage.warning('请输入目标 URL'); return }
  loading.value = true
  try {
    await crawlerAPI.start({
      url: url.value,
      rules: rules.value.filter(r => r.name && r.selector),
      itemSelector: itemSelector.value || undefined,
      nextPageSelector: nextPageSelector.value || undefined,
      maxPages: maxPages.value,
    })
    ElMessage.success('采集任务已创建')
    await refreshTasks()
    activeTab.value = 'tasks'
  } catch { ElMessage.error('创建失败') }
  loading.value = false
}

async function cancelTask(id: string) { await crawlerAPI.cancelTask(id); refreshTasks() }

const filteredItems = computed(() => {
  if (!selectedTaskId.value) return items.value
  return items.value.filter((i: any) => i.task_id === selectedTaskId.value)
})

onMounted(refreshTasks)
</script>

<template>
  <div class="page-container">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-lg font-bold text-gray-100 mb-1">爬虫采集</h2>
        <p class="text-sm text-gray-500">抓取网页内容，提取标题、媒体链接等结构化数据</p>
      </div>
    </div>

    <div class="flex gap-1 mb-6">
      <button
        v-for="tab in [
          { key: 'config', label: '采集配置', icon: 'gear' },
          { key: 'tasks', label: `任务列表 (${tasks.length})`, icon: 'list' },
          { key: 'items', label: `采集结果 (${items.length})`, icon: 'table' },
        ]"
        :key="tab.key"
        @click="activeTab = tab.key"
        class="px-4 py-2 text-sm rounded-lg transition-all duration-200 flex items-center gap-2"
        :class="activeTab === tab.key ? 'bg-gray-800 text-gray-100 font-medium border border-gray-600/50' : 'text-gray-500 hover:text-gray-300'"
      >
        <i :class="'fas fa-' + tab.icon + ' text-xs'"></i> {{ tab.label }}
      </button>
    </div>

    <!-- Config -->
    <div v-show="activeTab === 'config'" class="space-y-5">
      <div class="card-static">
        <div class="flex items-center gap-2 mb-4">
          <i class="fas fa-globe text-blue-400 text-sm"></i>
          <h3 class="text-sm font-semibold text-gray-200">目标页面</h3>
        </div>
        <div class="space-y-4">
          <div>
            <label class="label">页面 URL</label>
            <input v-model="url" class="input" placeholder="https://example.com/articles" />
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="label">列表项选择器</label>
              <input v-model="itemSelector" class="input" placeholder="例如: .article-item" />
              <p class="text-[11px] text-gray-600 mt-1">留空则提取整页内容</p>
            </div>
            <div>
              <label class="label">下一页选择器</label>
              <input v-model="nextPageSelector" class="input" placeholder="例如: .pagination .next" />
              <p class="text-[11px] text-gray-600 mt-1">留空则不翻页</p>
            </div>
            <div>
              <label class="label">最大翻页数</label>
              <el-input-number v-model="maxPages" :min="1" :max="100" size="small" class="!w-full" />
            </div>
          </div>
        </div>
      </div>

      <div class="card-static">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i class="fas fa-magnifying-glass text-amber-400 text-sm"></i>
            <h3 class="text-sm font-semibold text-gray-200">提取规则</h3>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-600 mr-1">预设:</span>
            <button class="btn btn-ghost btn-sm text-[11px]" @click="applyPreset('basic')">基础</button>
            <button class="btn btn-ghost btn-sm text-[11px]" @click="applyPreset('list')">列表页</button>
            <button class="btn btn-ghost btn-sm text-[11px]" @click="addRule"><i class="fas fa-plus mr-1"></i>自定义</button>
          </div>
        </div>

        <div class="space-y-2">
          <div
            v-for="(rule, i) in rules" :key="i"
            class="flex items-center gap-3 p-3 rounded-lg bg-gray-900/40 border border-gray-700/40 hover:border-gray-600/50 transition-colors"
          >
            <span class="text-[11px] text-gray-600 w-5 text-center flex-shrink-0">{{ i + 1 }}</span>
            <input v-model="rule.name" class="input !w-28 flex-shrink-0 !text-xs !py-2" placeholder="字段名" />
            <input v-model="rule.selector" class="input flex-1 !text-xs !py-2" placeholder="CSS 选择器" />
            <input v-model="rule.attr" class="input !w-24 flex-shrink-0 !text-xs !py-2" placeholder="属性 (可选)" />
            <button v-if="rules.length > 1" class="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0" @click="removeRule(i)">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
        </div>
        <p class="text-[11px] text-gray-600 mt-3"><code class="text-gray-500">attr</code> 留空提取文本，填写则提取属性值（如 src、href）</p>
      </div>

      <div class="flex gap-3">
        <button class="btn btn-primary" :disabled="!url || loading" @click="startCrawl">
          <i class="fas fa-play"></i> {{ loading ? '启动中...' : '开始采集' }}
        </button>
        <button class="btn btn-ghost" @click="url = ''; rules = [{ name: 'title', selector: 'h1', attr: '', desc: '标题' }, { name: 'media_url', selector: 'video, audio, source', attr: 'src', desc: '媒体链接' }]">
          <i class="fas fa-arrows-rotate"></i> 重置
        </button>
      </div>
    </div>

    <!-- Tasks -->
    <div v-show="activeTab === 'tasks'" class="card-static">
      <el-table v-if="tasks.length" :data="tasks" style="width: 100%" size="small" row-key="id">
        <el-table-column label="任务" min-width="200">
          <template #default="{ row }">
            <div class="text-xs text-gray-300 font-mono">{{ row.id.slice(0, 12) }}...</div>
            <div class="text-[11px] text-gray-600">{{ row.created_at }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span :class="'badge text-[11px] ' + (row.status === 'completed' ? 'badge-completed' : row.status === 'running' ? 'badge-running' : row.status === 'failed' ? 'badge-failed' : 'badge-pending')">
              <i v-if="row.status === 'completed'" class="fas fa-circle-check text-[10px]"></i>
              <i v-else-if="row.status === 'running'" class="fas fa-spinner text-[10px] animate-spin"></i>
              <i v-else-if="row.status === 'failed'" class="fas fa-circle-xmark text-[10px]"></i>
              <i v-else class="fas fa-circle text-[10px]"></i>
              {{ row.status === 'completed' ? '完成' : row.status === 'running' ? '进行中' : row.status === 'failed' ? '失败' : '等待' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="150">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :stroke-width="6" :status="row.status === 'failed' ? 'exception' : row.status === 'completed' ? 'success' : undefined" />
          </template>
        </el-table-column>
        <el-table-column prop="retries" label="重试" width="60" align="center" />
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }">
            <button v-if="row.status === 'running' || row.status === 'pending'" class="text-xs text-red-400 hover:text-red-300" @click="cancelTask(row.id)">
              <i class="fas fa-stop"></i> 取消
            </button>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-bug text-3xl mb-3 block opacity-40"></i>
        暂无采集任务，配置后开始
      </div>
    </div>

    <!-- Items -->
    <div v-show="activeTab === 'items'" class="card-static">
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm text-gray-400">共 {{ items.length }} 条结果</span>
        <select v-model="selectedTaskId" class="input !w-auto !py-1.5 !text-xs">
          <option value="">全部任务</option>
          <option v-for="t in tasks" :key="t.id" :value="t.id">{{ t.id.slice(0, 8) }}...</option>
        </select>
      </div>
      <el-table v-if="filteredItems.length" :data="filteredItems" style="width: 100%" size="small" row-key="id" max-height="500">
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
        <el-table-column prop="media_url" label="媒体链接" show-overflow-tooltip min-width="250" />
        <el-table-column label="类型" width="80">
          <template #default="{ row }"><span class="text-xs text-gray-400">{{ row.media_type || '-' }}</span></template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            <span v-if="row.media_source && row.media_source !== 'direct'" class="badge text-[10px] bg-gray-500/10 text-gray-400 border border-gray-500/20">{{ row.media_source }}</span>
            <span v-else class="text-xs text-gray-600">直链</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <span :class="'badge text-[10px] ' + (row.status === 'completed' ? 'badge-completed' : 'badge-pending')">{{ row.status === 'completed' ? '就绪' : '待处理' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-table text-3xl mb-3 block opacity-40"></i>
        暂无采集数据
      </div>
    </div>
  </div>
</template>
