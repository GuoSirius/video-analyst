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
      path: '/crawler',
      component: () => import('../layouts/CrawlerLayout.vue'),
      children: [
        {
          path: '',
          redirect: '/crawler/tasks',
        },
        {
          path: 'tasks',
          name: 'crawler-tasks',
          component: () => import('../pages/CrawlerTasks.vue'),
        },
        {
          path: 'items',
          name: 'crawler-items',
          component: () => import('../pages/CrawlerItems.vue'),
        },
      ],
    },
    {
      path: '/media',
      component: () => import('../layouts/MediaLayout.vue'),
      children: [
        {
          path: '',
          redirect: '/media/resources',
        },
        {
          path: 'resources',
          name: 'media-download',
          component: () => import('../pages/Download.vue'),
        },
        {
          path: 'transcode',
          name: 'media-transcode',
          component: () => import('../pages/Transcode.vue'),
        },
      ],
    },
    {
      path: '/ai',
      component: () => import('../layouts/AiLayout.vue'),
      children: [
        {
          path: '',
          redirect: '/ai/whisper',
        },
        {
          path: 'whisper',
          name: 'ai-whisper',
          component: () => import('../pages/WhisperPage.vue'),
        },
        {
          path: 'summary',
          name: 'ai-summary',
          component: () => import('../pages/AISummary.vue'),
        },
      ],
    },
    {
      path: '/export',
      name: 'export',
      component: () => import('../pages/Export.vue'),
    },
    {
      path: '/models',
      name: 'models',
      component: () => import('../pages/Models.vue'),
    },
    {
      path: '/prompts',
      name: 'prompts',
      component: () => import('../pages/Prompts.vue'),
    },
  ],
})

export default router
