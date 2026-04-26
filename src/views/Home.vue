<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload, Folder, VideoCamera } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'

const { t } = useI18n()

// 文件列表
const fileList = ref<UploadFile[]>([])

// 配置
const includeSubfolder = ref(false)
const recursionDepth = ref(3)
const transcriptionMethod = ref('local')
const selectedModel = ref('')

// 任务列表（模拟数据）
const tasks = ref([
  { id: '1', fileName: 'video1.mp4', filePath: '/path/to/video1.mp4', fileSize: 1024000, status: 'completed', progress: 100, createdAt: Date.now(), updatedAt: Date.now() },
  { id: '2', fileName: 'video2.mp4', filePath: '/path/to/video2.mp4', fileSize: 2048000, status: 'processing', progress: 45, createdAt: Date.now(), updatedAt: Date.now() },
  { id: '3', fileName: 'audio1.mp3', filePath: '/path/to/audio1.mp3', fileSize: 512000, status: 'pending', progress: 0, createdAt: Date.now(), updatedAt: Date.now() }
])

// 状态颜色映射
const statusColorMap: Record<string, string> = {
  pending: 'info',
  processing: 'warning',
  completed: 'success',
  failed: 'danger'
}

// 选择文件夹
async function selectFolder() {
  // TODO: 调用 Electron API 选择文件夹
  console.log('Select folder')
}

// 开始处理
function startProcessing() {
  console.log('Start processing')
}
</script>

<template>
  <div class="home p-6 h-full overflow-auto">
    <h1 class="text-2xl font-bold mb-6">{{ t('home.title') }}</h1>

    <!-- 文件选择区域 -->
    <el-card class="mb-6">
      <template #header>
        <div class="flex items-center gap-2">
          <el-icon><VideoCamera /></el-icon>
          <span>{{ t('home.selectFile') }} / {{ t('home.selectFolder') }}</span>
        </div>
      </template>

      <el-upload
        v-model:file-list="fileList"
        class="upload-demo"
        drag
        action="#"
        multiple
        :auto-upload="false"
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">
          {{ t('home.selectFile') }} 或 {{ t('home.selectFolder') }}
        </div>
      </el-upload>

      <div class="mt-4 flex gap-2">
        <el-button type="primary" @click="selectFolder">
          <el-icon><Folder /></el-icon>
          {{ t('home.selectFolder') }}
        </el-button>
      </div>
    </el-card>

    <!-- 处理配置区域 -->
    <el-card class="mb-6">
      <template #header>{{ t('home.title') }} {{ t('settings.title') }}</template>

      <el-form label-width="120px">
        <el-form-item :label="t('home.includeSubfolder')">
          <el-switch v-model="includeSubfolder" />
        </el-form-item>

        <el-form-item :label="t('home.recursionDepth')">
          <el-input-number v-model="recursionDepth" :min="1" :max="10" />
        </el-form-item>

        <el-form-item :label="t('home.transcriptionMethod')">
          <el-radio-group v-model="transcriptionMethod">
            <el-radio value="local">{{ t('home.local') }}</el-radio>
            <el-radio value="cloud">{{ t('home.cloud') }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item :label="t('home.selectModel')">
          <el-select v-model="selectedModel" :placeholder="t('home.selectModel')">
            <el-option label="Local Whisper" value="local-whisper" />
            <el-option label="OpenAI Whisper API" value="openai-whisper" />
          </el-select>
        </el-form-item>
      </el-form>

      <div class="flex justify-end mt-4">
        <el-button type="primary" @click="startProcessing">
          {{ t('home.start') }}
        </el-button>
      </div>
    </el-card>

    <!-- 任务列表 -->
    <el-card>
      <template #header>{{ t('home.taskList') }}</template>

      <el-table :data="tasks" style="width: 100%">
        <el-table-column prop="fileName" :label="t('home.selectFile')" />
        <el-table-column prop="fileSize" :label="'大小'" width="120" />
        <el-table-column :label="'状态'" width="120">
          <template #default="{ row }">
            <el-tag :type="statusColorMap[row.status]">
              {{ t(`home.status.${row.status}`) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="'进度'" width="200">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" />
          </template>
        </el-table-column>
        <el-table-column :label="'操作'" width="200">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" type="primary">
              {{ t('home.start') }}
            </el-button>
            <el-button v-if="row.status === 'processing'" size="small" type="warning">
              {{ t('home.pause') }}
            </el-button>
            <el-button size="small" type="danger">
              {{ t('home.cancel') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.home {
  background-color: var(--el-bg-color-page, #141414);
  color: var(--el-text-color-primary, #fff);
}
</style>
