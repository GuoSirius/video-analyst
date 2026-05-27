<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { transcoderAPI } from '../api'
import { ElMessage } from 'element-plus'

const ffmpegStatus = ref<any>(null)
const dirPath = ref('')
const tasks = ref<any[]>([])
const uploadedFiles = ref<string[]>([])
const uploading = ref(false)
const activeTab = ref('upload')

async function checkFfmpeg(){const{data}=await transcoderAPI.checkFfmpeg();ffmpegStatus.value=data}
async function refreshTasks(){const{data}=await transcoderAPI.getTasks();tasks.value=data}

async function handleUpload(e:Event){
  const input=e.target as HTMLInputElement
  if(!input.files?.length)return
  uploading.value=true
  const fd=new FormData()
  for(const f of Array.from(input.files))fd.append('files',f)
  try{const{data}=await transcoderAPI.upload(fd);uploadedFiles.value.push(...data.files);ElMessage.success(`已上传 ${data.files.length} 个文件`)}catch{ElMessage.error('上传失败')}
  uploading.value=false;input.value=''
}

async function startConvert(){
  if(!dirPath.value&&!uploadedFiles.value.length){ElMessage.warning('请先上传文件或指定目录');return}
  const{data}=await transcoderAPI.startConvert({dir:dirPath.value||undefined,files:uploadedFiles.value.length?uploadedFiles.value:undefined})
  if(data.error){ElMessage.error(data.error);return}
  ElMessage.success(`已创建 ${data.tasks.length} 个转码任务`);activeTab.value='tasks';refreshTasks()
}

async function cancelTask(id:string){await transcoderAPI.cancelTask(id);refreshTasks()}
onMounted(()=>{checkFfmpeg();refreshTasks()})
</script>

<template>
  <div style="padding:24px 28px;max-width:1240px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <h2 style="font-size:18px;font-weight:700;margin-bottom:4px">转码处理</h2>
        <p style="font-size:13px;color:#6b7280">FFmpeg 将音视频转换为 16kHz 单声道 WAV</p>
      </div>
      <div style="font-size:12px">
        <span v-if="ffmpegStatus?.found" style="color:#34d399"><i class="fas fa-circle" style="font-size:5px;margin-right:4px"></i>FFmpeg {{ffmpegStatus.version?.split('-')[0]}}</span>
        <span v-else style="color:#f87171"><i class="fas fa-circle" style="font-size:5px;margin-right:4px"></i>FFmpeg 未检测到</span>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:20px">
      <el-button v-for="tab in [{k:'upload',l:'上传文件'},{k:'tasks',l:'转码任务'}]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">
        {{tab.l}}<span v-if="tab.k==='tasks'" style="margin-left:4px;opacity:0.6">({{tasks.length}})</span>
      </el-button>
    </div>

    <div v-show="activeTab==='upload'" style="display:flex;flex-direction:column;gap:20px">
      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-upload" style="color:#34d399"></i>上传音视频文件</h3>
        <label style="display:block;border:2px dashed rgba(75,85,99,0.35);border-radius:12px;padding:40px;text-align:center;cursor:pointer;transition:border-color 0.2s">
          <i class="fas fa-cloud-arrow-up" style="font-size:32px;color:#6b7280;display:block;margin-bottom:12px"></i>
          <div style="font-size:14px;color:#9ca3af;margin-bottom:4px">{{uploading?'上传中...':'点击或拖拽文件到此处'}}</div>
          <div style="font-size:12px;color:#6b7280">支持 mp3/wav/flac/aac/ogg/mp4/mkv/webm/mov/avi</div>
          <input type="file" multiple accept="audio/*,video/*" style="display:none" :disabled="uploading" @change="handleUpload" />
        </label>
        <div v-if="uploadedFiles.length" style="margin-top:16px">
          <div style="font-size:12px;color:#9ca3af;margin-bottom:8px">已上传 {{uploadedFiles.length}} 个文件</div>
          <div v-for="f in uploadedFiles.slice(0,6)" :key="f" style="font-size:12px;color:#9ca3af;padding:6px 12px;background:rgba(13,17,23,0.5);border-radius:8px;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace"><i class="fas fa-file-lines" style="margin-right:8px;color:#6b7280"></i>{{f}}</div>
        </div>
      </div>

      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-folder-open" style="color:#fbbf24"></i>或扫描本地目录</h3>
        <div style="display:flex;gap:12px">
          <el-input v-model="dirPath" placeholder="D:\media 或 /home/user/media" size="default" style="flex:1" />
          <el-button type="primary" @click="startConvert"><i class="fas fa-play" style="margin-right:6px"></i>开始转换</el-button>
        </div>
      </div>

      <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:12px;padding:16px;display:flex;align-items:flex-start;gap:10px">
        <i class="fas fa-bolt" style="color:#60a5fa;margin-top:2px"></i>
        <div><div style="font-size:13px;color:#93c5fd;font-weight:500;margin-bottom:2px">输出规格</div><div style="font-size:12px;color:rgba(147,197,253,0.7)">16kHz · 单声道 · 16-bit PCM WAV</div></div>
      </div>
    </div>

    <div v-show="activeTab==='tasks'" style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
      <el-table v-if="tasks.length" :data="tasks" size="small">
        <el-table-column label="任务 ID" min-width="160"><template #default="{row}"><span style="font-size:12px;font-family:monospace;color:#9ca3af">{{row.id.slice(0,12)}}...</span></template></el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{row}">
            <span :style="{
              display:'inline-flex',padding:'2px 8px',borderRadius:'99px',fontSize:'11px',
              background:row.status==='completed'?'rgba(52,211,153,0.15)':row.status==='running'?'rgba(59,130,246,0.15)':row.status==='failed'?'rgba(248,113,113,0.15)':'rgba(250,204,21,0.15)',
              color:row.status==='completed'?'#6ee7b7':row.status==='running'?'#93c5fd':row.status==='failed'?'#fca5a5':'#fde047',
            }">{{row.status==='completed'?'完成':row.status==='running'?'转换中':row.status==='failed'?'失败':'等待'}}</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="180"><template #default="{row}"><el-progress :percentage="row.progress" :stroke-width="6" :status="row.status==='failed'?'exception':row.status==='completed'?'success':undefined" /></template></el-table-column>
        <el-table-column prop="retries" label="重试" width="60" align="center" />
        <el-table-column label="操作" width="80" align="center">
          <template #default="{row}">
            <el-button v-if="row.status==='running'||row.status==='pending'" size="small" type="danger" plain @click="cancelTask(row.id)">取消</el-button>
            <span v-else style="font-size:12px;color:#6b7280">-</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-else style="text-align:center;padding:48px 0;color:#6b7280;font-size:13px"><i class="fas fa-wand-magic-sparkles" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.3"></i>暂无转码任务</div>
    </div>
  </div>
</template>
