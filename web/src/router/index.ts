import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../pages/Dashboard.vue'),
    },
    {
      path: '/crawler/tasks',
      name: 'crawler-tasks',
      component: () => import('../pages/CrawlerTasks.vue'),
    },
    {
      path: '/crawler/items',
      name: 'crawler-items',
      component: () => import('../pages/CrawlerItems.vue'),
    },
    {
      path: '/downloads',
      name: 'downloads',
      component: () => import('../pages/DownloadPage.vue'),
    },
    {
      path: '/transcode',
      name: 'transcode',
      component: () => import('../pages/TranscodePage.vue'),
    },
    {
      path: '/whisper',
      name: 'whisper',
      component: () => import('../pages/WhisperPage.vue'),
    },
    {
      path: '/ai-analysis',
      name: 'ai-analysis',
      component: () => import('../pages/AiAnalysisPage.vue'),
    },
    {
      path: '/providers',
      name: 'providers',
      component: () => import('../pages/Providers.vue'),
    },
    {
      path: '/prompts',
      name: 'prompts',
      component: () => import('../pages/Prompts.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export default router
