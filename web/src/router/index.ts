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
      redirect: '/crawler/tasks',
      children: [
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
      path: '/transcoder',
      name: 'transcoder',
      component: () => import('../pages/Transcoder.vue'),
    },
    {
      path: '/ai',
      redirect: '/ai/whisper',
      children: [
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
