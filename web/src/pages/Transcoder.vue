<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { transcoderAPI, whisperAPI } from '../api'
import { ElMessage } from 'element-plus'

const ffmpegStatus = ref<any>(null)
const whisperStatus = ref<any>(null)
const dirPath = ref('')
const transcodeTasks = ref<any[]>([])
const whisperTasks = ref<any[]>([])
const whisperResults = ref<any[]>([])
const uploadedFiles = ref<string[]>([])
const uploading = ref(false)
const activeTab = ref('upload')

async function checkFfmpeg(){const{data}=await transcoderAPI.checkFfmpeg();ffmpegStatus.value=data}
async function checkWhisper(){try{const{data}=await whisperAPI.getStatus();whisperStatus.value=data}catch{whisperStatus.value=null}}
async function refreshAll(){
  const[tc,wt,wr]=await Promise.all([transcoderAPI.getTasks(),whisperAPI.getTasks(),whisperAPI.getResults()])
  transcodeTasks.value=tc.data;whisperTasks.value=wt.data;whisperResults.value=wr.data
}

async function handleUpload(e:Event){
  const input=e.target as HTMLInputElement
  if(!input.files?.length)return
  uploading.value=true
  const fd=new FormData()
  for(const f of Array.from(input.files))fd.append('files',f)
  try{const{data}=await transcoderAPI.upload(fd);uploadedFiles.value.push(...data.files);ElMessage.success(`已上传 ${data.files.length} 个文件`);refreshAll()}catch{ElMessage.error('上传失败')}
  uploading.value=false;input.value=''
}

async function startConvert(){
  if(!dirPath.value&&!uploadedFiles.value.length){ElMessage.warning('请先上传文件或指定目录');return}
  const{data}=await transcoderAPI.startConvert({dir:dirPath.value||undefined,files:uploadedFiles.value.length?uploadedFiles.value:undefined})
  if(data.error){ElMessage.error(data.error);return}
  ElMessage.success(`已创建 ${data.tasks.length} 个转码任务`);activeTab.value='transcode';refreshAll()
}

async function startExtract(){
  ElMessage.info('请前往 AI 分析页面选择已转码文件进行识别')
}

async function cancelTcTask(id:string){await transcoderAPI.cancelTask(id);refreshAll()}
async function retryTcTask(id:string){await transcoderAPI.retryTask(id);ElMessage.success('已重新加入队列');refreshAll()}
async function cancelWsTask(id:string){await whisperAPI.cancelTask(id);refreshAll()}
async function retryWsTask(id:string){await whisperAPI.retryTask(id);ElMessage.success('已重新加入队列');refreshAll()}

onMounted(()=>{checkFfmpeg();checkWhisper();refreshAll()})
</script>

<template>
  <div class="px-7 py-6">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h2 class="text-lg font-bold mb-1">转码处理</h2>
        <p class="text-[13px] text-gray-500">上传文件 → FFmpeg 转码 → 语音识别</p>
      </div>
      <div class="text-xs flex items-center gap-4">
        <span v-if="ffmpegStatus?.found" class="text-emerald-400"><i class="fas fa-circle text-[5px] mr-1"></i>FFmpeg {{ffmpegStatus.version?.split('-')[0]}}</span>
        <span v-else class="text-red-400"><i class="fas fa-circle text-[5px] mr-1"></i>FFmpeg 未检测到</span>
        <span class="text-gray-600">|</span>
        <span v-if="whisperStatus?.mode==='api'" class="text-blue-400"><i class="fas fa-cloud mr-1"></i>识别: API</span>
        <span v-else-if="whisperStatus?.mode==='local'" class="text-emerald-400"><i class="fas fa-laptop mr-1"></i>识别: 本地 CLI</span>
        <span v-else class="text-red-400 cursor-help" :title="whisperStatus?.detail">识别: 不可用</span>
      </div>
    </div>

    <!-- Whisper unavailable warning -->
    <div v-if="whisperStatus?.mode==='unavailable'" class="rounded-xl bg-amber-500/8 border border-amber-500/20 p-4 mb-5">
      <div class="flex items-start gap-3">
        <i class="fas fa-triangle-exclamation text-amber-400 mt-0.5"></i>
        <div class="flex-1">
          <div class="text-sm text-amber-300 font-medium mb-1">语音识别不可用</div>
          <div class="text-xs text-amber-400/80 mb-2">{{ whisperStatus.detail }}</div>
          <div class="text-xs text-gray-400 space-y-1">
            <div><strong>方案一:</strong> 设置 <code class="text-gray-500 bg-gray-800 px-1 rounded">MEMO_AI_BASE_URL</code> 使用远端服务</div>
            <div><strong>方案二:</strong> <code class="text-gray-500 bg-gray-800 px-1 rounded">pip install openai-whisper</code> 使用本地 CLI</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Pipeline indicator -->
    <div class="flex items-center gap-2 mb-5 text-xs text-gray-500">
      <span :class="activeTab==='upload'?'text-blue-400':''">① 文件选择</span>
      <span>→</span>
      <span :class="activeTab==='transcode'?'text-emerald-400':''">② 转码任务</span>
      <span>→</span>
      <span :class="activeTab==='extract'?'text-violet-400':''">③ 文字提取</span>
    </div>

    <div class="flex gap-2 mb-5">
      <el-button v-for="tab in [
        {k:'upload',l:'文件选择',icon:'fa-upload'},
        {k:'transcode',l:'转码任务',icon:'fa-gear'},
        {k:'extract',l:'文字提取',icon:'fa-microphone'},
      ]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">
        <i :class="'fas '+tab.icon+' mr-1 text-xs'"></i>{{tab.l}}
        <span v-if="tab.k==='transcode'" class="ml-1 text-gray-500 text-xs">({{transcodeTasks.length}})</span>
        <span v-if="tab.k==='extract'" class="ml-1 text-gray-500 text-xs">({{whisperTasks.length}})</span>
      </el-button>
    </div>

    <!-- ① 文件选择 -->
    <div v-show="activeTab==='upload'" class="space-y-5">
      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-upload text-emerald-400"></i>上传音视频文件</h3>
        <label class="block border-2 border-dashed border-gray-600/40 rounded-xl p-10 text-center cursor-pointer hover:border-blue-500/40 hover:bg-gray-800/30 transition-all duration-200">
          <i class="fas fa-cloud-arrow-up text-3xl text-gray-500 mb-3 block"></i>
          <div class="text-sm text-gray-400 mb-1">{{uploading?'上传中...':'点击选择文件（可多选）'}}</div>
          <div class="text-xs text-gray-600">支持 mp3/wav/flac/aac/ogg/mp4/mkv/webm/mov/avi</div>
          <input type="file" multiple accept="audio/*,video/*" class="hidden" :disabled="uploading" @change="handleUpload"/>
        </label>
        <div v-if="uploadedFiles.length" class="mt-4 space-y-1">
          <div class="text-xs text-gray-500 mb-2">已上传 {{uploadedFiles.length}} 个文件，点击"开始转码"进行处理</div>
          <div v-for="f in uploadedFiles.slice(0,6)" :key="f" class="text-xs text-gray-400 py-1.5 px-3 bg-gray-900/40 rounded-lg truncate font-mono"><i class="fas fa-file-lines mr-2 text-gray-600"></i>{{f}}</div>
        </div>
      </div>

      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-folder-open text-amber-400"></i>或扫描本地目录</h3>
        <div class="flex gap-3">
          <el-input v-model="dirPath" placeholder="D:\media 或 /home/user/media" class="flex-1"/>
          <el-button type="primary" @click="startConvert"><i class="fas fa-play mr-1.5"></i>开始转码</el-button>
        </div>
        <p class="text-[11px] text-gray-600 mt-2">自动递归扫描目录下所有支持的音视频文件</p>
      </div>

      <div class="rounded-xl bg-blue-500/5 border border-blue-500/15 p-4 flex items-start gap-3">
        <i class="fas fa-bolt text-blue-400 mt-0.5"></i>
        <div><div class="text-sm text-blue-300 font-medium mb-0.5">转码规格</div><div class="text-xs text-blue-400/70">16kHz · 单声道 · 16-bit PCM WAV — Whisper 最佳输入格式</div></div>
      </div>
    </div>

    <!-- ② 转码任务 -->
    <div v-show="activeTab==='transcode'" class="card-static">
      <el-table v-if="transcodeTasks.length" :data="transcodeTasks" size="small" row-key="id">
        <el-table-column label="文件" min-width="180" show-overflow-tooltip>
          <template #default="{row}"><span class="text-xs text-gray-300">{{ row.payload?.file?.split(/[\\/]/).pop() || row.id.slice(0,12)+'...' }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
              :class="row.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':row.status==='running'?'bg-blue-500/15 text-blue-300 border-blue-500/25':row.status==='failed'?'bg-red-500/15 text-red-300 border-red-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">
              {{row.status==='completed'?'完成':row.status==='running'?'转换中':row.status==='failed'?'失败':'等待'}}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="160"><template #default="{row}"><el-progress :percentage="row.progress" :stroke-width="6" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined"/></template></el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{row}">
            <div class="flex items-center justify-center gap-1">
            <el-button v-if="row.status==='running'||row.status==='pending'" size="small" type="danger" plain @click="cancelTcTask(row.id)">取消</el-button>
            <el-button v-else-if="row.status==='failed'" size="small" type="warning" plain @click="retryTcTask(row.id)">重试</el-button>
            <el-button v-else-if="row.status==='completed'" size="small" type="primary" plain @click="retryTcTask(row.id)">重跑</el-button>
            <span v-else class="text-xs text-gray-600">-</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div v-else class="text-center py-12 text-gray-500 text-sm"><i class="fas fa-gear text-3xl mb-3 block opacity-30"></i>暂无转码任务</div>
    </div>

    <!-- ③ 文字提取 -->
    <div v-show="activeTab==='extract'" class="card-static">
      <div class="text-xs text-gray-500 mb-4">语音识别任务和结果（由流水线自动触发或在 AI 分析页面手动触发）</div>
      <el-tabs model-value="tasks" size="small">
        <el-tab-pane label="提取任务" name="tasks">
          <el-table v-if="whisperTasks.length" :data="whisperTasks" size="small" row-key="id">
            <el-table-column label="文件" min-width="180" show-overflow-tooltip>
              <template #default="{row}"><span class="text-xs text-gray-300">{{ row.payload?.filePath?.split(/[\\/]/).pop() || row.id.slice(0,12)+'...' }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{row}">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
                  :class="row.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':row.status==='running'?'bg-blue-500/15 text-blue-300 border-blue-500/25':row.status==='failed'?'bg-red-500/15 text-red-300 border-red-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">
                  {{row.status==='completed'?'完成':row.status==='running'?'识别中':row.status==='failed'?'失败':'等待'}}</span>
              </template>
            </el-table-column>
            <el-table-column label="进度" width="160"><template #default="{row}"><el-progress :percentage="row.progress" :stroke-width="6" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined"/></template></el-table-column>
            <el-table-column label="操作" width="130" align="center">
              <template #default="{row}">
                <div class="flex items-center justify-center gap-1">
                <el-button v-if="row.status==='running'||row.status==='pending'" size="small" type="danger" plain @click="cancelWsTask(row.id)">取消</el-button>
                <el-button v-else-if="row.status==='failed'" size="small" type="warning" plain @click="retryWsTask(row.id)">重试</el-button>
                <el-button v-else-if="row.status==='completed'" size="small" type="primary" plain @click="retryWsTask(row.id)">重跑</el-button>
                <span v-else class="text-xs text-gray-600">-</span>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="text-center py-12 text-gray-500 text-sm"><i class="fas fa-microphone text-3xl mb-3 block opacity-30"></i>暂无提取任务</div>
        </el-tab-pane>
        <el-tab-pane :label="'提取结果 ('+whisperResults.length+')'" name="results">
          <div v-if="whisperResults.length" class="space-y-3 max-h-[500px] overflow-y-auto">
            <div v-for="r in whisperResults" :key="r.id" class="p-4 rounded-lg bg-gray-900/40 border border-gray-700/30">
              <div class="flex items-center justify-between mb-2">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border"
                  :class="r.status==='completed'?'bg-emerald-500/15 text-emerald-300 border-emerald-500/25':'bg-yellow-500/15 text-yellow-300 border-yellow-500/25'">{{r.status==='completed'?'完成':'处理中'}}</span>
                <span class="text-[11px] text-gray-600">{{r.created_at}}</span>
              </div>
              <div class="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{{r.content?.slice(0,500)}}{{r.content?.length>500?'...':''}}</div>
              <div v-if="!r.content" class="text-sm text-gray-600">等待识别结果...</div>
            </div>
          </div>
          <div v-else class="text-center py-12 text-gray-500 text-sm">暂无提取结果</div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>
