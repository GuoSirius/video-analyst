<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { crawlerAPI } from '../api'
import { ElMessage } from 'element-plus'

const url = ref('')
const itemSelector = ref('')
const nextPageSelector = ref('')
const maxPages = ref(1)
const rules = ref([
  { name: 'title', selector: 'h1, .title, [class*="title"]', attr: '' },
  { name: 'media_url', selector: 'video, audio, source, a[href$=".mp4"]', attr: 'src' },
])
const loading = ref(false)
const activeTab = ref('config')
const tasks = ref<any[]>([])
const items = ref<any[]>([])
const selectedTaskId = ref('')

const presetRules: Record<string, { name: string; selector: string; attr: string }[]> = {
  basic: [
    { name: 'title', selector: 'h1, .title', attr: '' },
    { name: 'media_url', selector: 'video, audio, source', attr: 'src' },
  ],
  list: [
    { name: 'title', selector: 'h2 a, .title a, h3 a', attr: '' },
    { name: 'media_url', selector: 'a[href*="video"], a[href*="mp4"]', attr: 'href' },
    { name: 'date', selector: '.date, time', attr: '' },
    { name: 'author', selector: '.author, .byline', attr: '' },
  ],
}

function applyPreset(name: string) { if (presetRules[name]) rules.value = [...presetRules[name]] }
function addRule() { rules.value.push({ name: '', selector: '', attr: '' }) }
function removeRule(i: number) { if (rules.value.length > 1) rules.value.splice(i, 1) }

async function refreshData() {
  const [t, i] = await Promise.all([crawlerAPI.getTasks(), crawlerAPI.getItems()])
  tasks.value = t.data; items.value = i.data
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
    await refreshData(); activeTab.value = 'tasks'
  } catch { ElMessage.error('创建失败') }
  loading.value = false
}

async function cancelTask(id: string) { await crawlerAPI.cancelTask(id); refreshData() }
onMounted(refreshData)
</script>

<template>
  <div class="p-6 max-w-[1200px]">
    <h2 class="text-lg font-bold mb-1">爬虫采集</h2>
    <p class="text-sm text-gray-500 mb-5">抓取网页内容，提取标题、媒体链接等结构化数据</p>

    <!-- Tabs -->
    <div class="flex gap-2 mb-5">
      <button v-for="tab in [
        { key: 'config', label: '采集配置', icon: 'fa-gear' },
        { key: 'tasks', label: '任务列表', icon: 'fa-list' },
        { key: 'items', label: '采集结果', icon: 'fa-table' },
      ]" :key="tab.key" @click="activeTab = tab.key"
        class="px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2"
        :class="activeTab === tab.key ? 'bg-gray-800 text-gray-100 border border-gray-600' : 'text-gray-400 hover:text-gray-200'"
      >
        <i :class="'fas ' + tab.icon + ' text-xs'"></i> {{ tab.label }}
        <span v-if="tab.key === 'tasks'" class="text-xs text-gray-500 ml-1">({{ tasks.length }})</span>
        <span v-if="tab.key === 'items'" class="text-xs text-gray-500 ml-1">({{ items.length }})</span>
      </button>
    </div>

    <!-- CONFIG -->
    <div v-show="activeTab === 'config'" class="space-y-5">
      <div class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2">
          <i class="fas fa-globe text-blue-400"></i> 目标页面
        </h3>
        <div class="mb-4">
          <label class="text-xs text-gray-400 mb-1.5 block">页面 URL</label>
          <input v-model="url" class="w-full px-3 py-2.5 bg-gray-900/70 border border-gray-600/50 rounded-lg text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30" placeholder="https://example.com/articles" />
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="text-xs text-gray-400 mb-1.5 block">列表项选择器</label>
            <input v-model="itemSelector" class="w-full px-3 py-2.5 bg-gray-900/70 border border-gray-600/50 rounded-lg text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500/50" placeholder=".article-item" />
            <p class="text-[11px] text-gray-600 mt-1">留空提取整页</p>
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1.5 block">下一页选择器</label>
            <input v-model="nextPageSelector" class="w-full px-3 py-2.5 bg-gray-900/70 border border-gray-600/50 rounded-lg text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500/50" placeholder=".pagination .next" />
            <p class="text-[11px] text-gray-600 mt-1">留空不翻页</p>
          </div>
          <div>
            <label class="text-xs text-gray-400 mb-1.5 block">最大页数</label>
            <el-input-number v-model="maxPages" :min="1" :max="100" size="small" />
          </div>
        </div>
      </div>

      <div class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold flex items-center gap-2">
            <i class="fas fa-magnifying-glass text-amber-400"></i> 提取规则
          </h3>
          <div class="flex items-center gap-2">
            <button class="px-2.5 py-1 text-xs rounded-md bg-gray-700/50 text-gray-300 hover:bg-gray-700 border border-gray-600/50" @click="applyPreset('basic')">基础</button>
            <button class="px-2.5 py-1 text-xs rounded-md bg-gray-700/50 text-gray-300 hover:bg-gray-700 border border-gray-600/50" @click="applyPreset('list')">列表页</button>
            <button class="px-2.5 py-1 text-xs rounded-md bg-gray-700/50 text-gray-300 hover:bg-gray-700 border border-gray-600/50" @click="addRule"><i class="fas fa-plus mr-1"></i>添加</button>
          </div>
        </div>

        <div class="space-y-2">
          <div v-for="(rule, i) in rules" :key="i"
            class="flex items-center gap-3 p-2.5 rounded-lg bg-gray-900/40 border border-gray-700/30">
            <span class="text-xs text-gray-600 w-5 text-center">{{ i + 1 }}</span>
            <input v-model="rule.name" class="w-28 px-3 py-2 bg-gray-900/70 border border-gray-600/50 rounded-lg text-xs text-gray-100 outline-none focus:border-blue-500/50" placeholder="字段名" />
            <input v-model="rule.selector" class="flex-1 px-3 py-2 bg-gray-900/70 border border-gray-600/50 rounded-lg text-xs text-gray-100 outline-none focus:border-blue-500/50" placeholder="CSS 选择器" />
            <input v-model="rule.attr" class="w-28 px-3 py-2 bg-gray-900/70 border border-gray-600/50 rounded-lg text-xs text-gray-100 outline-none focus:border-blue-500/50" placeholder="属性(可选)" />
            <button v-if="rules.length > 1" class="text-gray-600 hover:text-red-400 w-6" @click="removeRule(i)">
              <i class="fas fa-xmark text-xs"></i>
            </button>
          </div>
        </div>
        <p class="text-[11px] text-gray-600 mt-2">attr 留空=提取文本, 填写=提取属性值(src/href等)</p>
      </div>

      <div class="flex gap-3">
        <button class="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50 flex items-center gap-2" :disabled="!url || loading" @click="startCrawl">
          <i class="fas fa-play text-xs"></i> {{ loading ? '启动中...' : '开始采集' }}
        </button>
        <button class="px-5 py-2.5 bg-gray-700/50 text-gray-300 rounded-lg text-sm hover:bg-gray-700 border border-gray-600/50 flex items-center gap-2" @click="url = ''; rules = [{ name: 'title', selector: 'h1', attr: '' }, { name: 'media_url', selector: 'video, audio, source', attr: 'src' }]">
          <i class="fas fa-arrows-rotate text-xs"></i> 重置
        </button>
      </div>
    </div>

    <!-- TASKS -->
    <div v-show="activeTab === 'tasks'" class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
      <el-table v-if="tasks.length" :data="tasks" size="small">
        <el-table-column label="任务 ID" min-width="160">
          <template #default="{ row }"><span class="text-xs font-mono text-gray-400">{{ row.id.slice(0, 12) }}...</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              :class="row.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' :
                row.status === 'running' ? 'bg-blue-500/15 text-blue-300 border border-blue-500/25' :
                row.status === 'failed' ? 'bg-red-500/15 text-red-300 border border-red-500/25' :
                'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25'">
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
            <button v-if="row.status === 'running' || row.status === 'pending'"
              class="text-xs text-red-400 hover:text-red-300" @click="cancelTask(row.id)">取消</button>
            <span v-else class="text-xs text-gray-600">-</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-bug text-3xl mb-3 block opacity-30"></i> 暂无采集任务
      </div>
    </div>

    <!-- ITEMS -->
    <div v-show="activeTab === 'items'" class="bg-gray-800/60 rounded-xl border border-gray-700/50 p-5">
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm text-gray-400">共 {{ items.length }} 条</span>
        <el-select v-model="selectedTaskId" placeholder="全部任务" size="small" style="width:180px" clearable>
          <el-option v-for="t in tasks" :key="t.id" :label="t.id.slice(0,12)+'...'" :value="t.id" />
        </el-select>
      </div>
      <el-table v-if="items.length" :data="selectedTaskId ? items.filter((i:any) => i.task_id === selectedTaskId) : items" size="small" max-height="400">
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
        <el-table-column prop="media_url" label="媒体链接" show-overflow-tooltip min-width="250" />
        <el-table-column label="类型" width="80">
          <template #default="{ row }"><span class="text-xs text-gray-400">{{ row.media_type || '-' }}</span></template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }"><span class="text-xs text-gray-400">{{ row.media_source || '-' }}</span></template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-16 text-gray-500 text-sm">
        <i class="fas fa-table text-3xl mb-3 block opacity-30"></i> 暂无数据
      </div>
    </div>
  </div>
</template>
