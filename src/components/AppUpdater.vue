<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

interface UpdateInfo {
  version?: string
  releaseDate?: string
  percent?: number
}

const updateInfo = ref<UpdateInfo>({})
const updateStatus = ref<'idle' | 'checking' | 'available' | 'downloading' | 'ready'>('idle')
const isDialogVisible = ref(false)

let unsubscribe: (() => void) | null = null

onMounted(() => {
  // 监听更新状态变化
  unsubscribe = window.electronAPI.onUpdateStatus((status: string, data?: Record<string, unknown>) => {
    console.log('[Updater] Status changed:', status, data)
    updateStatus.value = status as typeof updateStatus.value

    switch (status) {
      case 'available':
        updateInfo.value = {
          version: data?.version as string,
          releaseDate: data?.releaseDate as string
        }
        isDialogVisible.value = true
        break

      case 'downloading':
        updateInfo.value.percent = data?.percent as number
        ElMessage({
          message: `正在下载更新: ${(data?.percent as number)?.toFixed(1)}%`,
          type: 'info',
          duration: 2000
        })
        break

      case 'ready':
        ElMessage.success('更新已下载完成，点击确定立即安装')
        isDialogVisible.value = true
        break

      case 'not-available':
        ElMessage.info('已是最新版本')
        break

      case 'error':
        ElMessage.error(`更新检查失败: ${data?.message}`)
        break
    }
  })

  // 检查更新状态
  checkUpdateStatus()
})

onUnmounted(() => {
  unsubscribe?.()
})

async function checkUpdateStatus() {
  try {
    const result = await window.electronAPI.updateStatus()
    if (result.status !== 'idle') {
      updateStatus.value = result.status as typeof updateStatus.value
      if (result.version) {
        updateInfo.value.version = result.version
      }
    }
  } catch (error) {
    console.error('[Updater] Failed to get status:', error)
  }
}

async function handleDownload() {
  isDialogVisible.value = false
  try {
    await window.electronAPI.updateDownload()
  } catch (error) {
    ElMessage.error('下载失败')
  }
}

async function handleInstall() {
  try {
    await window.electronAPI.updateInstall()
  } catch (error) {
    ElMessage.error('安装失败')
  }
}

async function handleCheckUpdate() {
  try {
    await window.electronAPI.updateCheck()
  } catch (error) {
    ElMessage.error('检查更新失败')
  }
}

async function handleClose() {
  isDialogVisible.value = false
}
</script>

<template>
  <!-- 更新提示对话框 -->
  <el-dialog
    v-model="isDialogVisible"
    :title="updateStatus === 'ready' ? '更新已就绪' : '发现新版本'"
    width="400px"
    :close-on-click-modal="false"
    :show-close="updateStatus !== 'downloading'"
  >
    <template v-if="updateStatus === 'available'">
      <p>有新版本可用：<strong>{{ updateInfo.version }}</strong></p>
      <p v-if="updateInfo.releaseDate" style="color: #999; font-size: 12px;">
        发布日期：{{ updateInfo.releaseDate }}
      </p>
      <p style="margin-top: 16px;">是否立即下载更新？</p>
    </template>

    <template v-else-if="updateStatus === 'downloading'">
      <p>正在下载更新...</p>
      <el-progress
        :percentage="Number(updateInfo.percent?.toFixed(1)) || 0"
        :stroke-width="20"
        style="margin-top: 16px;"
      />
    </template>

    <template v-else-if="updateStatus === 'ready'">
      <p>更新包已下载完成</p>
      <p style="margin-top: 8px; color: #67c23a;">
        版本：{{ updateInfo.version }}
      </p>
      <p style="margin-top: 16px;">是否立即安装并重启应用？</p>
    </template>

    <template #footer>
      <template v-if="updateStatus === 'available'">
        <el-button @click="handleClose">稍后</el-button>
        <el-button type="primary" @click="handleDownload">下载更新</el-button>
      </template>

      <template v-else-if="updateStatus === 'downloading'">
        <el-button disabled>下载中...</el-button>
      </template>

      <template v-else-if="updateStatus === 'ready'">
        <el-button @click="handleClose">稍后</el-button>
        <el-button type="primary" @click="handleInstall">立即安装</el-button>
      </template>

      <template v-else>
        <el-button @click="handleClose">关闭</el-button>
      </template>
    </template>
  </el-dialog>

  <!-- 检查更新按钮 (可选，可以在设置页面添加) -->
</template>
