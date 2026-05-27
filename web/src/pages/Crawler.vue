<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { crawlerAPI } from '../api'
import { ElMessage } from 'element-plus'

const url = ref('')
const itemSelector = ref('')
const nextPageSelector = ref('')
const maxPages = ref(1)
const rules = ref([
  { name:'title', selector:'h1, .title, [class*="title"]', attr:'' },
  { name:'media_url', selector:'video, audio, source, a[href$=".mp4"]', attr:'src' },
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
  try{
    await crawlerAPI.start({url:url.value,rules:rules.value.filter(r=>r.name&&r.selector),itemSelector:itemSelector.value||undefined,nextPageSelector:nextPageSelector.value||undefined,maxPages:maxPages.value})
    ElMessage.success('采集任务已创建');await refresh();activeTab.value='tasks'
  }catch{ElMessage.error('创建失败')}
  loading.value=false
}

async function cancelTask(id:string){await crawlerAPI.cancelTask(id);refresh()}
onMounted(refresh)

const filtered = computed(()=>selectedTaskId.value?items.value.filter((i:any)=>i.task_id===selectedTaskId.value):items.value)
import { computed } from 'vue'
</script>

<template>
  <div style="padding:24px 28px;max-width:1240px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:4px">爬虫采集</h2>
    <p style="font-size:13px;color:#6b7280;margin-bottom:20px">抓取网页内容，提取标题、媒体链接等结构化数据</p>

    <div style="display:flex;gap:8px;margin-bottom:20px">
      <el-button v-for="tab in [{k:'config',l:'采集配置'},{k:'tasks',l:'任务列表'},{k:'items',l:'采集结果'}]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'"
        :plain="activeTab!==tab.k"
        size="small"
        @click="activeTab=tab.k"
      >
        {{tab.l}}
        <span v-if="tab.k==='tasks'" style="margin-left:4px;opacity:0.6">({{tasks.length}})</span>
        <span v-if="tab.k==='items'" style="margin-left:4px;opacity:0.6">({{items.length}})</span>
      </el-button>
    </div>

    <!-- Config -->
    <div v-show="activeTab==='config'" style="display:flex;flex-direction:column;gap:20px">
      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-globe" style="color:#60a5fa"></i>目标页面</h3>
        <div style="margin-bottom:16px">
          <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">页面 URL</div>
          <el-input v-model="url" placeholder="https://example.com/articles" size="default" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 160px;gap:16px">
          <div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">列表项选择器</div>
            <el-input v-model="itemSelector" placeholder=".article-item" size="default" />
            <div style="font-size:11px;color:#6b7280;margin-top:4px">留空提取整页</div>
          </div>
          <div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">下一页选择器</div>
            <el-input v-model="nextPageSelector" placeholder=".pagination .next" size="default" />
            <div style="font-size:11px;color:#6b7280;margin-top:4px">留空不翻页</div>
          </div>
          <div>
            <div style="font-size:12px;color:#9ca3af;margin-bottom:6px">最大页数</div>
            <el-input-number v-model="maxPages" :min="1" :max="100" size="default" style="width:100%" />
          </div>
        </div>
      </div>

      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px"><i class="fas fa-magnifying-glass" style="color:#fbbf24"></i>提取规则</h3>
          <div style="display:flex;gap:8px">
            <el-button size="small" @click="applyPreset('basic')">基础</el-button>
            <el-button size="small" @click="applyPreset('list')">列表页</el-button>
            <el-button size="small" @click="addRule"><i class="fas fa-plus" style="margin-right:4px"></i>添加</el-button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div v-for="(rule,i) in rules" :key="i"
            style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;background:rgba(13,17,23,0.5);border:1px solid rgba(75,85,99,0.2)">
            <span style="font-size:11px;color:#6b7280;width:20px;text-align:center">{{i+1}}</span>
            <el-input v-model="rule.name" placeholder="字段名" size="small" style="width:120px" />
            <el-input v-model="rule.selector" placeholder="CSS 选择器" size="small" style="flex:1" />
            <el-input v-model="rule.attr" placeholder="属性(可选)" size="small" style="width:120px" />
            <el-button v-if="rules.length>1" size="small" type="danger" :icon="'fas fa-xmark'" circle plain @click="removeRule(i)" />
          </div>
        </div>
        <div style="font-size:11px;color:#6b7280;margin-top:8px">attr 留空=提取文本, 填写=提取属性值(src/href等)</div>
      </div>

      <div style="display:flex;gap:12px">
        <el-button type="primary" :disabled="!url||loading" :loading="loading" @click="startCrawl">
          <i class="fas fa-play" style="margin-right:6px"></i>开始采集
        </el-button>
        <el-button @click="url='';rules=[{name:'title',selector:'h1',attr:''},{name:'media_url',selector:'video,audio,source',attr:'src'}]">
          <i class="fas fa-arrows-rotate" style="margin-right:6px"></i>重置
        </el-button>
      </div>
    </div>

    <!-- Tasks -->
    <div v-show="activeTab==='tasks'" style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
      <el-table v-if="tasks.length" :data="tasks" size="small">
        <el-table-column label="任务 ID" min-width="160">
          <template #default="{row}"><span style="font-size:12px;font-family:monospace;color:#9ca3af">{{row.id.slice(0,12)}}...</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}">
            <span :style="{
              display:'inline-flex',alignItems:'center',padding:'2px 8px',borderRadius:'99px',fontSize:'11px',
              background:row.status==='completed'?'rgba(52,211,153,0.15)':row.status==='running'?'rgba(59,130,246,0.15)':row.status==='failed'?'rgba(248,113,113,0.15)':'rgba(250,204,21,0.15)',
              color:row.status==='completed'?'#6ee7b7':row.status==='running'?'#93c5fd':row.status==='failed'?'#fca5a5':'#fde047',
            }">{{row.status==='completed'?'完成':row.status==='running'?'进行中':row.status==='failed'?'失败':'等待'}}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="160">
          <template #default="{row}"><el-progress :percentage="row.progress" :stroke-width="6" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined" /></template>
        </el-table-column>
        <el-table-column prop="retries" label="重试" width="60" align="center" />
        <el-table-column label="操作" width="80" align="center">
          <template #default="{row}">
            <el-button v-if="row.status==='running'||row.status==='pending'" size="small" type="danger" plain @click="cancelTask(row.id)">取消</el-button>
            <span v-else style="font-size:12px;color:#6b7280">-</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else style="text-align:center;padding:48px 0;color:#6b7280;font-size:13px"><i class="fas fa-bug" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.3"></i>暂无采集任务</div>
    </div>

    <!-- Items -->
    <div v-show="activeTab==='items'" style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <span style="font-size:13px;color:#9ca3af">共 {{items.length}} 条</span>
        <el-select v-model="selectedTaskId" placeholder="全部任务" size="small" style="width:200px" clearable>
          <el-option v-for="t in tasks" :key="t.id" :label="t.id.slice(0,12)+'...'" :value="t.id" />
        </el-select>
      </div>
      <el-table v-if="filtered.length" :data="filtered" size="small" max-height="400">
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
        <el-table-column prop="media_url" label="媒体链接" show-overflow-tooltip min-width="250" />
        <el-table-column label="类型" width="80"><template #default="{row}"><span style="font-size:12px;color:#9ca3af">{{row.media_type||'-'}}</span></template></el-table-column>
        <el-table-column label="来源" width="90"><template #default="{row}"><span style="font-size:12px;color:#9ca3af">{{row.media_source||'-'}}</span></template></el-table-column>
      </el-table>
      <div v-else style="text-align:center;padding:48px 0;color:#6b7280;font-size:13px"><i class="fas fa-table" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.3"></i>暂无数据</div>
    </div>
  </div>
</template>
