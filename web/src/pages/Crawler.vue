<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { crawlerAPI, whisperAPI } from '../api'
import { ElMessage } from 'element-plus'

const taskName = ref('')
const url = ref('')
const itemSelector = ref('')
const nextPageSelector = ref('')
const maxPages = ref(0)
const rules = ref([
  { name:'title',selector:'h1,.title,[class*="title"]',attr:'' },
  { name:'media_url',selector:'video,audio,source,a[href$=".mp4"]',attr:'src' },
])
const loading = ref(false)
const activeTab = ref('config')
const tasks = ref<any[]>([])
const items = ref<any[]>([])
const selectedTaskId = ref('')
const taskFilter = ref('all')

const presetRules: Record<string,{name:string;selector:string;attr:string}[]> = {
  basic: [{name:'title',selector:'h1,.title',attr:''},{name:'media_url',selector:'video,audio,source',attr:'src'}],
  list: [{name:'title',selector:'h2 a,.title a,h3 a',attr:''},{name:'media_url',selector:'a[href*="video"],a[href*="mp4"]',attr:'href'},{name:'date',selector:'.date,time',attr:''},{name:'author',selector:'.author,.byline',attr:''}],
}

function applyPreset(n:string){if(presetRules[n])rules.value=[...presetRules[n]]}
function addRule(){rules.value.push({name:'',selector:'',attr:''})}
function removeRule(i:number){if(rules.value.length>1)rules.value.splice(i,1)}

async function refresh(){const[t,i]=await Promise.all([crawlerAPI.getTasks(),crawlerAPI.getItems()]);tasks.value=t.data;items.value=i.data}

async function startCrawl(){
  if(!url.value){ElMessage.warning('请输入目标 URL');return}
  loading.value=true
  try{
    await crawlerAPI.start({
      name: taskName.value || url.value.slice(0,60),
      url:url.value,
      rules:rules.value.filter(r=>r.name&&r.selector),
      itemSelector:itemSelector.value||undefined,
      nextPageSelector:nextPageSelector.value||undefined,
      maxPages:maxPages.value,
    })
    ElMessage.success('采集任务已创建')
    await refresh()
    activeTab.value='tasks'
    // 不重置 URL，方便连续创建
  }catch{ElMessage.error('创建失败')}
  loading.value=false
}

async function cancelTask(id:string){await crawlerAPI.cancelTask(id);refresh()}
async function retryTask(id:string){await crawlerAPI.retryTask(id);ElMessage.success('已重新加入队列');refresh()}

const selectedIds = ref<string[]>([])
async function continuePipeline() {
  if (!selectedIds.value.length) { ElMessage.warning('请先勾选要处理的项'); return }
  try {
    const { data } = await whisperAPI.transcribe({ itemIds: selectedIds.value })
    if (data.error) { ElMessage.error(data.error); return }
    ElMessage.success(`已送入流水线: ${data.tasks?.length || 0} 个任务, 后续自动完成`)
    refresh()
  } catch { ElMessage.error('启动失败') }
}

const filteredTasks = computed(() => {
  if (taskFilter.value === 'all') return tasks.value
  return tasks.value.filter((t:any) => t.status === taskFilter.value)
})

const filteredItems = computed(() => {
  if (selectedTaskId.value) return items.value.filter((i:any) => i.task_id === selectedTaskId.value)
  return items.value
})

const taskNameMap = computed(() => {
  const m: Record<string,string> = {}
  tasks.value.forEach((t:any) => { m[t.id] = t.payload?.name || t.payload?.url || t.id.slice(0,8) })
  return m
})

onMounted(refresh)
</script>

<template>
  <div class="px-7 py-6">
    <h2 class="text-lg font-bold mb-1">爬虫采集</h2>
    <p class="text-[13px] text-gray-500 mb-5">抓取网页内容，提取标题、媒体链接等结构化数据</p>

    <div class="flex gap-2 mb-5">
      <el-button v-for="tab in [
        {k:'config',l:'采集配置'},
        {k:'tasks',l:'任务列表'},
        {k:'items',l:'采集结果'},
      ]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">
        {{ tab.l }}
        <span v-if="tab.k==='tasks'" class="ml-1 text-gray-500 text-xs">({{tasks.length}})</span>
        <span v-if="tab.k==='items'" class="ml-1 text-gray-500 text-xs">({{items.length}})</span>
      </el-button>
    </div>

    <!-- Config -->
    <div v-show="activeTab==='config'" class="space-y-5">
      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-globe text-blue-400"></i>新建采集任务</h3>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div class="text-xs text-gray-400 mb-1.5">任务名称（可选）</div>
            <el-input v-model="taskName" placeholder="留空则使用 URL 前60字符" />
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1.5">页面 URL</div>
            <el-input v-model="url" placeholder="https://example.com/articles" />
          </div>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <div class="text-xs text-gray-400 mb-1.5">列表项选择器</div>
            <el-input v-model="itemSelector" placeholder=".article-item" />
            <div class="text-[11px] text-gray-600 mt-1">留空提取整页</div>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1.5">下一页选择器</div>
            <el-input v-model="nextPageSelector" placeholder=".pagination .next" />
            <div class="text-[11px] text-gray-600 mt-1">留空不翻页</div>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1.5">最大页数 (0=全部)</div>
            <el-input-number v-model="maxPages" :min="0" :max="9999" :step="1" :precision="0" class="!w-full" />
          </div>
        </div>
      </div>

      <div class="card-static">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-semibold flex items-center gap-2"><i class="fas fa-magnifying-glass text-amber-400"></i>提取规则</h3>
          <div class="flex gap-2">
            <el-button size="small" @click="applyPreset('basic')">基础</el-button>
            <el-button size="small" @click="applyPreset('list')">列表页</el-button>
            <el-button size="small" @click="addRule"><i class="fas fa-plus mr-1"></i>添加</el-button>
          </div>
        </div>
        <div class="space-y-2">
          <div v-for="(rule,i) in rules" :key="i"
            class="flex items-center gap-3 p-2.5 rounded-lg bg-gray-900/40 border border-gray-700/30">
            <span class="text-[11px] text-gray-600 w-5 text-center">{{ i+1 }}</span>
            <el-input v-model="rule.name" placeholder="字段名" size="small" class="!w-32" />
            <el-input v-model="rule.selector" placeholder="CSS 选择器" size="small" class="flex-1" />
            <el-input v-model="rule.attr" placeholder="属性(可选)" size="small" class="!w-32" />
            <el-button v-if="rules.length>1" size="small" type="danger" circle plain @click="removeRule(i)"><i class="fas fa-xmark"></i></el-button>
          </div>
        </div>
        <div class="text-[11px] text-gray-600 mt-2">attr 留空=提取文本, 填写=提取属性值(src/href等)</div>
      </div>

      <div class="flex gap-3">
        <el-button type="primary" :disabled="!url||loading" :loading="loading" @click="startCrawl">
          <i class="fas fa-play mr-1.5"></i>{{ loading ? '创建中...' : '创建采集任务' }}
        </el-button>
        <span class="text-xs text-gray-500 self-center">可连续创建多个任务</span>
      </div>
    </div>

    <!-- Tasks -->
    <div v-show="activeTab==='tasks'" class="card-static">
      <div class="flex items-center justify-between mb-4">
        <div class="flex gap-2">
          <el-button v-for="f in [
            {k:'all',l:'全部'},{k:'running',l:'进行中'},{k:'completed',l:'已完成'},{k:'failed',l:'失败'}
          ]" :key="f.k"
            size="small" :type="taskFilter===f.k?'primary':'default'" :plain="taskFilter!==f.k"
            @click="taskFilter=f.k"
          >{{ f.l }}</el-button>
        </div>
        <span class="text-xs text-gray-500">共 {{filteredTasks.length}} 个任务</span>
      </div>
      <el-table v-if="filteredTasks.length" :data="filteredTasks" size="small" row-key="id">
        <el-table-column label="任务名称" min-width="160" show-overflow-tooltip>
          <template #default="{row}">
            <span class="text-xs text-gray-300 cursor-pointer hover:text-blue-400" @click="selectedTaskId=row.id;activeTab='items'">
              {{ row.payload?.name || row.payload?.url || row.id.slice(0,12)+'...' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="URL" min-width="180" show-overflow-tooltip>
          <template #default="{row}"><span class="text-xs text-gray-500">{{ row.payload?.url }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
              :class="row.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':row.status==='running'?'bg-blue-500/15 text-blue-300 border-blue-500/25':row.status==='failed'?'bg-red-500/15 text-red-300 border-red-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">
              {{ row.status==='completed'?'完成':row.status==='running'?'进行中':row.status==='failed'?'失败':'等待' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140"><template #default="{row}"><el-progress :percentage="row.progress" :stroke-width="6" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined"/></template></el-table-column>
        <el-table-column label="结果" width="70" align="center">
          <template #default="{row}">
            <el-button size="small" text type="primary" @click="selectedTaskId=row.id;activeTab='items'">
              {{ items.filter((i:any)=>i.task_id===row.id).length }} 条
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{row}">
            <div class="flex items-center justify-center gap-1">
            <el-button v-if="row.status==='running'||row.status==='pending'" size="small" type="danger" plain @click="cancelTask(row.id)">取消</el-button>
            <el-button v-else-if="row.status==='failed'" size="small" type="warning" plain @click="retryTask(row.id)">重试</el-button>
            <el-button v-else-if="row.status==='completed'" size="small" type="primary" plain @click="retryTask(row.id)">重跑</el-button>
            <span v-else class="text-xs text-gray-600">-</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-12 text-gray-500 text-sm"><i class="fas fa-bug text-3xl mb-3 block opacity-30"></i>暂无匹配任务</div>
    </div>

    <!-- Items -->
    <div v-show="activeTab==='items'" class="card-static">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-400">共 {{filteredItems.length}} 条</span>
          <el-select v-model="selectedTaskId" placeholder="按任务筛选" size="small" class="!w-56" clearable>
            <el-option v-for="t in tasks" :key="t.id" :label="(t.payload?.name||t.payload?.url||t.id.slice(0,8)) + ' ('+items.filter((i:any)=>i.task_id===t.id).length+'条)'" :value="t.id"/>
          </el-select>
          <el-button v-if="selectedTaskId" size="small" @click="selectedTaskId=''">查看全部</el-button>
        </div>
      </div>
      <el-table v-if="filteredItems.length" :data="filteredItems" size="small" max-height="450" @selection-change="(rows:any)=>selectedIds=rows.map((r:any)=>r.id)">
        <el-table-column type="selection" width="40"/>
        <el-table-column label="所属任务" width="140" show-overflow-tooltip>
          <template #default="{row}"><span class="text-xs text-gray-500">{{ taskNameMap[row.task_id] || row.task_id?.slice(0,8) }}</span></template>
        </el-table-column>
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="180"/>
        <el-table-column prop="media_url" label="媒体链接" show-overflow-tooltip min-width="220"/>
        <el-table-column label="类型" width="80"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_type||'-'}}</span></template></el-table-column>
        <el-table-column label="来源" width="90"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_source||'-'}}</span></template></el-table-column>
      </el-table>
      <div v-if="filteredItems.length" class="mt-4 flex items-center gap-3">
        <el-button type="success" :disabled="!selectedIds.length" @click="continuePipeline">
          <i class="fas fa-forward-step mr-1.5"></i>继续流水线 → 识别+AI分析
        </el-button>
        <span class="text-xs text-gray-500">勾选项目后送入自动流水线 (需已转码为 WAV)</span>
      </div>
      <div v-else class="text-center py-12 text-gray-500 text-sm"><i class="fas fa-table text-3xl mb-3 block opacity-30"></i>{{selectedTaskId ? '该任务暂无结果' : '暂无采集数据'}}</div>
    </div>
  </div>
</template>
