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
      name: 'crawler',
      component: () => import('../pages/Crawler.vue'),
    },
    {
      path: '/transcoder',
      name: 'transcoder',
      component: () => import('../pages/Transcoder.vue'),
    },
    {
      path: '/ai',
      name: 'ai',
      component: () => import('../pages/AIAnalysis.vue'),
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
