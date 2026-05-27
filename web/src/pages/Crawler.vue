<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { crawlerAPI, whisperAPI } from '../api'
import { ElMessage } from 'element-plus'

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
  try{await crawlerAPI.start({url:url.value,rules:rules.value.filter(r=>r.name&&r.selector),itemSelector:itemSelector.value||undefined,nextPageSelector:nextPageSelector.value||undefined,maxPages:maxPages.value});ElMessage.success('采集任务已创建');await refresh();activeTab.value='tasks'}catch{ElMessage.error('创建失败')}
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

const filtered = computed(()=>selectedTaskId.value?items.value.filter((i:any)=>i.task_id===selectedTaskId.value):items.value)
onMounted(refresh)
</script>

<template>
  <div class="px-7 py-6 max-w-[1240px]">
    <h2 class="text-lg font-bold mb-1">爬虫采集</h2>
    <p class="text-[13px] text-gray-500 mb-5">抓取网页内容，提取标题、媒体链接等结构化数据</p>

    <div class="flex gap-2 mb-5">
      <el-button v-for="tab in [{k:'config',l:'采集配置'},{k:'tasks',l:'任务列表'},{k:'items',l:'采集结果'}]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">
        {{ tab.l }}
        <span v-if="tab.k==='tasks'" class="ml-1 text-gray-500 text-xs">({{tasks.length}})</span>
        <span v-if="tab.k==='items'" class="ml-1 text-gray-500 text-xs">({{items.length}})</span>
      </el-button>
    </div>

    <div v-show="activeTab==='config'" class="space-y-5">
      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-globe text-blue-400"></i>目标页面</h3>
        <div class="mb-4">
          <div class="text-xs text-gray-400 mb-1.5">页面 URL</div>
          <el-input v-model="url" placeholder="https://example.com/articles" />
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
        <el-button type="primary" :disabled="!url||loading" :loading="loading" @click="startCrawl"><i class="fas fa-play mr-1.5"></i>开始采集</el-button>
        <el-button @click="url='';rules=[{name:'title',selector:'h1',attr:''},{name:'media_url',selector:'video,audio,source',attr:'src'}]"><i class="fas fa-arrows-rotate mr-1.5"></i>重置</el-button>
      </div>
    </div>

    <div v-show="activeTab==='tasks'" class="card-static">
      <el-table v-if="tasks.length" :data="tasks" size="small">
        <el-table-column label="任务" min-width="200">
          <template #default="{row}">
            <div class="text-xs text-gray-300 truncate max-w-[260px]">{{ row.payload?.url || row.id.slice(0,12)+'...' }}</div>
            <div class="text-[11px] text-gray-600">{{ row.created_at }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
              :class="row.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':row.status==='running'?'bg-blue-500/15 text-blue-300 border-blue-500/25':row.status==='failed'?'bg-red-500/15 text-red-300 border-red-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">
              {{ row.status==='completed'?'完成':row.status==='running'?'进行中':row.status==='failed'?'失败':'等待' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="160"><template #default="{row}"><el-progress :percentage="row.progress" :stroke-width="6" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined"/></template></el-table-column>
        <el-table-column prop="retries" label="重试" width="60" align="center"/>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{row}">
            <div class="flex items-center justify-center gap-1">
            <el-button v-if="row.status==='running'||row.status==='pending'" size="small" type="danger" plain @click="cancelTask(row.id)">取消</el-button><el-button v-else-if="row.status==='failed'" size="small" type="warning" plain @click="retryTask(row.id)">重试</el-button><el-button v-else-if="row.status==='completed'" size="small" type="primary" plain @click="retryTask(row.id)">重跑</el-button><span v-else class="text-xs text-gray-600">-</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-12 text-gray-500 text-sm"><i class="fas fa-bug text-3xl mb-3 block opacity-30"></i>暂无采集任务</div>
    </div>

    <div v-show="activeTab==='items'" class="card-static">
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm text-gray-400">共 {{items.length}} 条</span>
        <el-select v-model="selectedTaskId" placeholder="全部任务" size="small" class="!w-48" clearable>
          <el-option v-for="t in tasks" :key="t.id" :label="t.id.slice(0,12)+'...'" :value="t.id"/>
        </el-select>
      </div>
      <el-table v-if="filtered.length" :data="filtered" size="small" max-height="400" @selection-change="(rows:any)=>selectedIds=rows.map((r:any)=>r.id)">
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200"/>
        <el-table-column type="selection" width="40"/>
        <el-table-column prop="media_url" label="媒体链接" show-overflow-tooltip min-width="250"/>
        <el-table-column label="类型" width="80"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_type||'-'}}</span></template></el-table-column>
        <el-table-column label="来源" width="90"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_source||'-'}}</span></template></el-table-column>
      </el-table>
      <div v-if="filtered.length" class="mt-4 flex items-center gap-3">
        <el-button type="success" :disabled="!selectedIds.length" @click="continuePipeline">
          <i class="fas fa-forward-step mr-1.5"></i>继续流水线 → 识别+AI分析
        </el-button>
        <span class="text-xs text-gray-500">勾选项目后送入自动流水线 (需已转码为 WAV)</span>
      </div>
      <div v-else class="text-center py-12 text-gray-500 text-sm"><i class="fas fa-table text-3xl mb-3 block opacity-30"></i>暂无数据</div>
    </div>
  </div>
</template>
