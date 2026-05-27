<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { exportAPI, crawlerAPI } from '../api'
import { ElMessage } from 'element-plus'

const columns = ref<string[]>([])
const selectedColumns = ref<string[]>(['title','source_url','media_url','media_type','media_source','transcription','ai_result'])
const items = ref<any[]>([])
const selectedItemIds = ref<string[]>([])
const exporting = ref(false)
const activeTab = ref('export')

const colLabels:Record<string,string>={id:'ID',title:'标题',source_url:'来源 URL',media_url:'媒体 URL',media_type:'媒体类型',media_source:'媒体来源',transcription:'识别文本',language:'语言',duration:'时长',ai_result:'AI 分析结果',ai_model:'AI 模型',ai_prompt:'分析提示词'}

async function refresh(){const[c,i]=await Promise.all([exportAPI.getColumns(),crawlerAPI.getItems()]);columns.value=c.data;items.value=i.data}

async function doExport(){
  exporting.value=true
  try{
    const{data}=await exportAPI.exportExcel({columns:selectedColumns.value,itemIds:selectedItemIds.value.length?selectedItemIds.value:undefined,includeTranscriptions:true,includeAIResults:true})
    const blob=new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`export_${new Date().toISOString().slice(0,10)}.xlsx`;a.click();URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }catch{ElMessage.error('导出失败')}
  exporting.value=false
}

onMounted(refresh)
</script>

<template>
  <div style="padding:24px 28px;max-width:1240px">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:4px">数据导出</h2>
    <p style="font-size:13px;color:#6b7280;margin-bottom:20px">自定义字段和范围，导出 Excel 结构化数据</p>

    <div style="display:flex;gap:8px;margin-bottom:20px">
      <el-button v-for="tab in [{k:'export',l:'导出配置'},{k:'preview',l:'数据预览'}]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">{{tab.l}}</el-button>
    </div>

    <div v-show="activeTab==='export'" style="display:flex;flex-direction:column;gap:20px">
      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-list-check" style="color:#60a5fa"></i>导出字段 <span style="font-size:12px;color:#6b7280;font-weight:400;margin-left:8px">{{selectedColumns.length}}/{{columns.length}}</span></h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <el-checkbox v-for="col in columns" :key="col" v-model="selectedColumns" :label="col" :value="col" size="small">
            {{colLabels[col]||col}}
          </el-checkbox>
        </div>
      </div>

      <div style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px"><i class="fas fa-table" style="color:#fbbf24"></i>选择数据范围 <span style="font-size:12px;color:#6b7280;font-weight:400;margin-left:8px">留空导出全部</span></h3>
        <el-table :data="items" size="small" max-height="300" @selection-change="(rows:any)=>selectedItemIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40" />
          <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200" />
          <el-table-column label="类型" width="80"><template #default="{row}"><span style="font-size:12px;color:#9ca3af">{{row.media_type||'-'}}</span></template></el-table-column>
          <el-table-column label="来源" width="90"><template #default="{row}"><span style="font-size:12px;color:#9ca3af">{{row.media_source||'-'}}</span></template></el-table-column>
        </el-table>
      </div>

      <el-button type="primary" :disabled="exporting||!selectedColumns.length" :loading="exporting" @click="doExport" style="align-self:flex-start">
        <i class="fas fa-download" style="margin-right:6px"></i>{{exporting?'导出中...':`导出 Excel (${selectedItemIds.length||items.length} 条)`}}
      </el-button>
    </div>

    <div v-show="activeTab==='preview'" style="background:rgba(22,27,34,0.7);border:1px solid rgba(75,85,99,0.3);border-radius:12px;padding:24px">
      <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">数据预览</h3>
      <el-table v-if="items.length" :data="items" size="small" max-height="500">
        <el-table-column v-for="col in selectedColumns" :key="col" :prop="col" :label="colLabels[col]||col" show-overflow-tooltip min-width="150" />
      </el-table>
      <div v-else style="text-align:center;padding:48px 0;color:#6b7280;font-size:13px"><i class="fas fa-table" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.3"></i>暂无数据</div>
    </div>
  </div>
</template>
