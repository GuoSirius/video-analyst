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
  <div class="px-7 py-6 max-w-[1240px]">
    <h2 class="text-lg font-bold mb-1">数据导出</h2>
    <p class="text-[13px] text-gray-500 mb-5">自定义字段和范围，导出 Excel 结构化数据</p>

    <div class="flex gap-2 mb-5">
      <el-button v-for="tab in [{k:'export',l:'导出配置'},{k:'preview',l:'数据预览'}]" :key="tab.k"
        :type="activeTab===tab.k?'primary':'default'" :plain="activeTab!==tab.k" size="small" @click="activeTab=tab.k">{{tab.l}}</el-button>
    </div>

    <div v-show="activeTab==='export'" class="space-y-5">
      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-list-check text-blue-400"></i>导出字段 <span class="text-xs text-gray-500 font-normal ml-2">{{selectedColumns.length}}/{{columns.length}}</span></h3>
        <div class="flex flex-wrap gap-2">
          <el-checkbox v-for="col in columns" :key="col" v-model="selectedColumns" :label="col" :value="col" size="small">{{colLabels[col]||col}}</el-checkbox>
        </div>
      </div>

      <div class="card-static">
        <h3 class="text-sm font-semibold mb-4 flex items-center gap-2"><i class="fas fa-table text-amber-400"></i>选择数据范围 <span class="text-xs text-gray-500 font-normal ml-2">留空导出全部</span></h3>
        <el-table :data="items" size="small" max-height="300" @selection-change="(rows:any)=>selectedItemIds=rows.map((r:any)=>r.id)">
          <el-table-column type="selection" width="40"/>
          <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="200"/>
          <el-table-column label="类型" width="80"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_type||'-'}}</span></template></el-table-column>
          <el-table-column label="来源" width="90"><template #default="{row}"><span class="text-xs text-gray-400">{{row.media_source||'-'}}</span></template></el-table-column>
        </el-table>
      </div>

      <el-button type="primary" :disabled="exporting||!selectedColumns.length" :loading="exporting" @click="doExport">
        <i class="fas fa-download mr-1.5"></i>{{exporting?'导出中...':`导出 Excel (${selectedItemIds.length||items.length} 条)`}}
      </el-button>
    </div>

    <div v-show="activeTab==='preview'" class="card-static">
      <h3 class="text-sm font-semibold mb-4">数据预览</h3>
      <el-table v-if="items.length" :data="items" size="small" max-height="500">
        <el-table-column v-for="col in selectedColumns" :key="col" :prop="col" :label="colLabels[col]||col" show-overflow-tooltip min-width="150"/>
      </el-table>
      <div v-else class="text-center py-12 text-gray-500 text-sm"><i class="fas fa-table text-3xl mb-3 block opacity-30"></i>暂无数据</div>
    </div>
  </div>
</template>
