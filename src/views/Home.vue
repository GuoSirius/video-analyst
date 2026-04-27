<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import type { Task, TranscriptionMethod } from '../types'
import { useTaskStore } from '../store/tasks'

const { t } = useI18n()
const taskStore = useTaskStore()

// 配置
const includeSubfolder = ref(false)
const recursionDepth = ref(3)
const transcriptionMethod = ref<TranscriptionMethod>('local')
const selectedModel = ref('')
const isProcessing = ref(false)

// 选中任务
const selectedTask = ref<Task | null>(null)
const summarizingTasks = ref<Set<string>>(new Set())

// 选中任务变化
watch(selectedTask, async (newTask, oldTask) => {
  if (oldTask) {
    // 清除旧选中任务的监听
  }
  if (newTask) {
    // 监听进度更新
    window.electronAPI?.onSummaryProgress((taskId, progress) => {
      if (taskId === newTask.id) {
        console.log('Summary progress:', progress)
      }
    })
  }
})

// 选择文件夹
async function selectFolder() {
  if (window.electronAPI) {
    const folderPath = await window.electronAPI.selectFolder()
    console.log('Selected folder:', folderPath)
    if (folderPath) {
      ElMessage.info('正在扫描文件夹...')
      try {
        const maxDepth = includeSubfolder.value ? recursionDepth.value : 1
        const files = await window.electronAPI.scanFolder(folderPath, maxDepth)
        
        if (files.length === 0) {
          ElMessage.warning('文件夹中没有找到视频文件')
          return
        }
        
        const added = await taskStore.addTasks(files.map(path => ({
          name: path.split(/[/\\]/).pop() || '未知文件',
          path,
          size: 0
        })))
        
        ElMessage.success(`已添加 ${added.length} 个文件到任务列表`)
        
        // 如果没有正在处理，自动开始处理
        if (!isProcessing.value && added.length > 0) {
          startQueueProcessing()
        }
      } catch (error) {
        console.error('Scan folder error:', error)
        ElMessage.error('扫描文件夹失败')
      }
    }
  }
}

// 选择文件
async function selectFiles() {
  if (window.electronAPI) {
    const filePaths = await window.electronAPI.selectFiles()
    console.log('Selected files:', filePaths)
    if (filePaths && filePaths.length > 0) {
      const added = await taskStore.addTasks(filePaths.map(path => ({
        name: path.split(/[/\\]/).pop() || '未知文件',
        path,
        size: 0
      })))
      
      ElMessage.success(`已添加 ${added.length} 个文件到任务列表`)
      
      // 如果没有正在处理，自动开始处理
      if (!isProcessing.value && added.length > 0) {
        startQueueProcessing()
      }
    }
  }
}

// 处理队列中的下一个任务
async function processNextTask() {
  // 等待一下让 UI 更新
  await new Promise(resolve => setTimeout(resolve, 100))
  
  const nextTask = taskStore.getNextPendingTask()
  if (!nextTask) {
    isProcessing.value = false
    const total = taskStore.tasks.length
    const completed = taskStore.completedTasks.length
    const failed = taskStore.failedTasks.length
    ElMessage.success(`全部处理完成！成功: ${completed}, 失败: ${failed}`)
    return
  }
  
  isProcessing.value = true
  try {
    await taskStore.processTask(nextTask.id, transcriptionMethod.value, selectedModel.value)
  } catch (error) {
    console.error('Processing failed:', error)
  }
  
  // 处理完成后自动处理下一个
  processNextTask()
}

// 开始队列处理
function startQueueProcessing() {
  if (isProcessing.value) {
    ElMessage.info('正在处理中，新任务将自动加入队列')
    return
  }
  
  const pending = taskStore.pendingTasks.length
  if (pending === 0) {
    ElMessage.warning('没有待处理的任务')
    return
  }
  
  isProcessing.value = true
  ElMessage.info(`开始处理 ${pending} 个任务`)
  processNextTask()
}

// 开始处理单个任务（手动触发）
async function startProcessingTask(task: Task) {
  // 如果有正在处理的任务，只添加队列
  if (isProcessing.value) {
    ElMessage.info('当前有任务正在处理，已将任务加入队列末尾')
    return
  }
  
  isProcessing.value = true
  try {
    await taskStore.processTask(task.id, transcriptionMethod.value, selectedModel.value)
  } catch (error) {
    console.error('Processing failed:', error)
  }
  
  // 处理完成后检查是否还有待处理任务
  processNextTask()
}

// 重置任务
function resetTask(taskId: string) {
  taskStore.updateTask(taskId, { status: 'pending', progress: 0 })
}

// 清空所有任务
function clearAllTasks() {
  taskStore.clearTasks()
  selectedTask.value = null
}

// 分析总结
async function summarizeTask(task: Task) {
  if (!selectedModel.value) {
    ElMessage.warning('请先选择模型')
    return
  }
  
  summarizingTasks.value.add(task.id)
  taskStore.updateTask(task.id, { summaryStatus: 'processing' })
  
  try {
    const result = await window.electronAPI?.summarizeTask(task.id, selectedModel.value)
    taskStore.updateTask(task.id, { 
      summaryStatus: 'completed',
      summaryText: result 
    })
    ElMessage.success('分析完成')
  } catch (error) {
    console.error('Summarize failed:', error)
    taskStore.updateTask(task.id, { summaryStatus: 'failed' })
    ElMessage.error(`分析失败: ${(error as Error).message}`)
  } finally {
    summarizingTasks.value.delete(task.id)
  }
}

// 选中任务
function selectTaskItem(task: Task) {
  selectedTask.value = task
}

// 获取状态文本
function getStatusText(status: string) {
  return t(`home.status.${status}`)
}

// 获取 Font Awesome 图标类名
function getStatusIconClass(status: string): string {
  switch (status) {
    case 'pending': return 'fa-clock'
    case 'processing': return 'fa-spin fa-spinner'
    case 'completed': return 'fa-check'
    case 'failed': return 'fa-exclamation-circle'
    default: return 'fa-clock'
  }
}

// 统计数据
const stats = computed(() => {
  const tasks = taskStore.tasks
  return {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    processing: tasks.filter(t => t.status === 'processing').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length
  }
})

// 挂载时加载任务
onMounted(async () => {
  await taskStore.loadTasks()
})
</script>

<template>
  <div class="home">
    <!-- 页面标题区 -->
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">视频分析</h1>
        <p class="page-subtitle">选择视频文件，开始智能分析处理</p>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon total">
          <i class="fa-solid fa-film"></i>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.total }}</span>
          <span class="stat-label">总任务</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon pending">
          <i class="fa-regular fa-clock"></i>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.pending }}</span>
          <span class="stat-label">待处理</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon processing">
          <i class="fa-solid fa-spinner"></i>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.processing }}</span>
          <span class="stat-label">处理中</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon completed">
          <i class="fa-solid fa-check-circle"></i>
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ stats.completed }}</span>
          <span class="stat-label">已完成</span>
        </div>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="content-grid">
      <!-- 左侧：文件选择 -->
      <div class="content-card file-upload-section">
        <div class="card-header">
          <div class="card-icon">
            <i class="fa-solid fa-cloud-arrow-up"></i>
          </div>
          <h3 class="card-title">选择视频文件</h3>
        </div>
        
        <div class="upload-area" @click="selectFiles">
          <div class="upload-icon">
            <i class="fa-solid fa-video"></i>
          </div>
          <p class="upload-text">点击选择视频文件</p>
          <p class="upload-hint">支持 MP4, AVI, MOV, MKV 等格式</p>
        </div>

        <div class="folder-select">
          <button class="folder-btn" @click="selectFolder">
            <i class="fa-solid fa-folder-open"></i>
            选择文件夹
          </button>
        </div>

        <div class="config-form" style="margin-top: 20px;">
          <div class="form-item">
            <label>递归深度</label>
            <div class="slider-row">
              <el-slider v-model="recursionDepth" :min="1" :max="10" :show-tooltip="false" class="depth-slider" />
              <span class="slider-value">{{ recursionDepth }}</span>
            </div>
          </div>

          <div class="form-item switch-item">
            <label>包含子文件夹</label>
            <el-switch v-model="includeSubfolder" />
          </div>
        </div>

        <div class="config-actions" style="margin-top: 16px;">
          <button class="start-btn" @click="startQueueProcessing" :disabled="isProcessing || stats.pending === 0">
            <i class="fa-solid" :class="isProcessing ? 'fa-spinner fa-spin' : 'fa-play'"></i>
            {{ isProcessing ? `处理中 (${taskStore.processingTasks.length + taskStore.pendingTasks.length} 剩余)` : '开始处理' }}
          </button>
        </div>
      </div>

      <!-- 中间：任务列表 -->
      <div class="content-card tasks-section">
        <div class="section-header">
          <h3 class="section-title">任务列表</h3>
          <div class="header-actions">
            <span class="task-count">{{ taskStore.tasks.length }} 个任务</span>
            <button class="clear-btn" @click="clearAllTasks" :disabled="isProcessing || taskStore.tasks.length === 0">
              <i class="fa-solid fa-trash-can"></i>
              清空
            </button>
          </div>
        </div>

        <div class="tasks-list">
          <!-- 空状态 -->
          <div v-if="taskStore.tasks.length === 0" class="empty-state">
            <i class="fa-solid fa-inbox"></i>
            <p>暂无任务</p>
            <p class="empty-hint">请在上方选择视频文件或文件夹</p>
          </div>

          <!-- 任务项 -->
          <div 
            v-for="task in taskStore.tasks" 
            :key="task.id" 
            class="task-item"
            :class="[task.status, { selected: selectedTask?.id === task.id }]"
            @click="selectTaskItem(task)"
          >
            <div class="task-icon">
              <i class="fa-solid fa-file-video" v-if="task.status !== 'completed'"></i>
              <i class="fa-solid fa-check" v-else></i>
            </div>
            
            <div class="task-info">
              <span class="task-name">{{ task.fileName }}</span>
              <span class="task-size">{{ task.fileSize || '未知大小' }}</span>
            </div>

            <div class="task-status">
              <el-tag :type="task.status === 'completed' ? 'success' : task.status === 'failed' ? 'danger' : task.status === 'processing' ? 'warning' : 'info'" size="small">
                <i :class="['fa-solid', getStatusIconClass(task.status)]" v-if="task.status !== 'processing'"></i>
                <i class="fa-solid fa-spinner fa-spin" v-else></i>
                {{ getStatusText(task.status) }}
              </el-tag>
            </div>

            <div class="task-progress" v-if="task.status === 'processing'">
              <el-progress :percentage="task.progress" :stroke-width="6" />
            </div>

            <div class="task-actions">
              <button 
                v-if="task.status === 'pending'" 
                class="action-btn play-btn"
                @click="startProcessingTask(task)"
                :disabled="isProcessing"
                :title="isProcessing ? '队列处理中' : '开始处理'"
              >
                <i class="fa-solid fa-play"></i>
              </button>
              <button 
                class="action-btn reset-btn"
                @click="resetTask(task.id)"
              >
                <i class="fa-solid fa-rotate-right"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：详情面板 -->
      <div class="content-card detail-section" v-if="selectedTask">
        <div class="card-header">
          <div class="card-icon">
            <i class="fa-solid fa-file-text"></i>
          </div>
          <h3 class="card-title">任务详情</h3>
        </div>

        <div class="detail-content">
          <div class="detail-item">
            <label>文件名</label>
            <p class="detail-value">{{ selectedTask.fileName }}</p>
          </div>

          <div class="detail-item">
            <label>状态</label>
            <p class="detail-value">
              <el-tag :type="selectedTask.status === 'completed' ? 'success' : selectedTask.status === 'failed' ? 'danger' : selectedTask.status === 'processing' ? 'warning' : 'info'" size="small">
                {{ getStatusText(selectedTask.status) }}
              </el-tag>
            </p>
          </div>

          <!-- 转录文字 -->
          <div class="detail-item" v-if="selectedTask.status === 'completed' && selectedTask.transcriptionText">
            <div class="detail-label-row">
              <label>转录文字</label>
              <button class="text-copy-btn" @click="() => navigator.clipboard.writeText(selectedTask?.transcriptionText || '')">
                <i class="fa-solid fa-copy"></i> 复制
              </button>
            </div>
            <div class="text-content">
              {{ selectedTask.transcriptionText }}
            </div>
          </div>

          <!-- 分析总结按钮 -->
          <div class="detail-actions" v-if="selectedTask.status === 'completed' && selectedTask.transcriptionText">
            <button 
              class="summarize-btn" 
              @click="summarizeTask(selectedTask)"
              :disabled="!selectedModel || summarizingTasks.has(selectedTask.id)"
            >
              <i class="fa-solid" :class="summarizingTasks.has(selectedTask.id) ? 'fa-spinner fa-spin' : 'fa-brain'"></i>
              {{ summarizingTasks.has(selectedTask.id) ? '分析中...' : '分析总结' }}
            </button>
            <p v-if="!selectedModel" class="model-hint">请先在设置中选择模型</p>
          </div>

          <!-- 总结结果 -->
          <div class="detail-item" v-if="selectedTask.summaryText">
            <div class="detail-label-row">
              <label>分析总结</label>
              <button class="text-copy-btn" @click="() => navigator.clipboard.writeText(selectedTask?.summaryText || '')">
                <i class="fa-solid fa-copy"></i> 复制
              </button>
            </div>
            <div class="text-content summary-content">
              {{ selectedTask.summaryText }}
            </div>
          </div>
        </div>
      </div>

      <!-- 未选中任务时的提示 -->
      <div class="content-card detail-section" v-else>
        <div class="detail-empty">
          <i class="fa-solid fa-hand-pointer"></i>
          <p>点击左侧任务查看详情</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  padding: 24px;
  min-height: calc(100vh - 52px);
  background: var(--el-bg-color-page);
}

/* 页面标题区 */
.page-header {
  margin-bottom: 24px;
}

.header-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.page-subtitle {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

/* 统计卡片网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--el-bg-color);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--el-border-color);
  transition: all 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.stat-icon.total {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  color: #3b82f6;
}

.stat-icon.pending {
  background: linear-gradient(135deg, rgba(100, 116, 139, 0.15), rgba(148, 163, 184, 0.15));
  color: #64748b;
}

.stat-icon.processing {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(251, 191, 36, 0.15));
  color: #f59e0b;
}

.stat-icon.completed {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(74, 222, 128, 0.15));
  color: #22c55e;
}

.stat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/* 内容网格 */
.content-grid {
  display: grid;
  grid-template-columns: 300px 1fr 350px;
  gap: 20px;
  margin-bottom: 24px;
}

.content-card {
  background: var(--el-bg-color);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid var(--el-border-color);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.card-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3b82f6;
}

.card-icon svg {
  width: 20px;
  height: 20px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

/* 上传区域 */
.upload-area {
  border: 2px dashed var(--el-border-color);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 16px;
}

.upload-area:hover {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.upload-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(14, 165, 233, 0.1));
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3b82f6;
}

.upload-icon svg {
  width: 28px;
  height: 28px;
}

.upload-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin: 0 0 4px;
}

.upload-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

.folder-select {
  display: flex;
  justify-content: center;
}

.folder-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 10px;
  background: linear-gradient(135deg, #3b82f6, #0ea5e9);
  border: none;
  color: white;
  font-weight: 500;
  transition: all 0.2s ease;
}

.folder-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

/* 配置表单 */
.config-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 24px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.method-group {
  display: flex;
  gap: 12px;
}

.radio-label {
  display: block;
  font-weight: 500;
}

.radio-desc {
  display: block;
  font-size: 11px;
  opacity: 0.7;
}

.model-select {
  width: 100%;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.depth-slider {
  flex: 1;
}

.slider-value {
  min-width: 24px;
  text-align: center;
  font-weight: 600;
  color: #3b82f6;
}

.switch-item {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.config-actions {
  display: flex;
  justify-content: center;
}

.start-btn {
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  background: linear-gradient(135deg, #3b82f6, #0ea5e9);
  border: none;
  font-size: 15px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.start-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
}

.start-btn:disabled {
  opacity: 0.5;
  background: #94a3b8;
}

/* 任务列表 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.clear-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-btn:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #fecaca;
  color: #ef4444;
}

.clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0;
}

.task-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--el-text-color-secondary);
}

.empty-state i {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: 15px;
}

.empty-hint {
  font-size: 13px !important;
  opacity: 0.7;
  margin-top: 8px !important;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 12px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.task-item:hover {
  background: var(--el-fill-color);
}

.task-item.selected {
  background: rgba(59, 130, 246, 0.1);
  border: 2px solid #3b82f6;
}

.task-item.completed {
  opacity: 0.7;
}

.task-icon {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(14, 165, 233, 0.15));
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3b82f6;
  flex-shrink: 0;
}

.task-item.completed .task-icon {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(74, 222, 128, 0.15));
  color: #22c55e;
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-name {
  display: block;
  font-weight: 500;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-size {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.task-status {
  flex-shrink: 0;
}

.task-progress {
  width: 120px;
  flex-shrink: 0;
}

.task-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 12px;
}

.play-btn {
  background: linear-gradient(135deg, #3b82f6, #0ea5e9);
  color: white;
}

.play-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.reset-btn {
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}

.reset-btn:hover {
  background: #ef4444;
  color: white;
}

/* 详情面板 */
.detail-section {
  overflow: hidden;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.detail-value {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.detail-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.text-copy-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.text-copy-btn:hover {
  background: var(--el-fill-color);
  color: #3b82f6;
}

.text-content {
  max-height: 200px;
  overflow-y: auto;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
}

.summary-content {
  background: rgba(59, 130, 246, 0.05);
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summarize-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: linear-gradient(135deg, #8b5cf6, #a855f7);
  border: none;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.summarize-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(139, 92, 246, 0.4);
}

.summarize-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-hint {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--el-text-color-secondary);
}

.detail-empty i {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.detail-empty p {
  margin: 0;
  font-size: 14px;
}

/* 响应式 */
@media (max-width: 1200px) {
  .content-grid {
    grid-template-columns: 1fr 1fr;
  }
  
  .detail-section {
    grid-column: span 2;
  }
}

@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .content-grid {
    grid-template-columns: 1fr;
  }
  
  .detail-section {
    grid-column: span 1;
  }
}
</style>
