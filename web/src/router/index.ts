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
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export default router
