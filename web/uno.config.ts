import { defineConfig } from 'unocss'
import { presetIcons } from 'unocss'

export default defineConfig({
  presets: [],
  rules: [
    ['page-container', { padding: '28px 32px', 'max-width': '1440px', margin: '0 auto' }],
  ],
  shortcuts: {
    'card': 'bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-lg border border-gray-700/60 p-6 hover:border-gray-600/80 transition-all duration-300',
    'card-static': 'bg-gray-800/80 backdrop-blur-sm rounded-xl shadow-lg border border-gray-700/60 p-6',
    'btn': 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed',
    'btn-primary': 'bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700 shadow-lg shadow-blue-600/20',
    'btn-danger': 'bg-red-600/90 text-white hover:bg-red-500 active:bg-red-700 shadow-lg shadow-red-600/20',
    'btn-success': 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700 shadow-lg shadow-emerald-600/20',
    'btn-ghost': 'bg-transparent text-gray-300 hover:bg-gray-700/60 hover:text-gray-100 border border-gray-600/50',
    'btn-sm': 'px-3 py-1.5 text-xs',
    'input': 'w-full px-3.5 py-2.5 bg-gray-900/70 border border-gray-600/50 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder-gray-500 transition-all duration-200',
    'label': 'block text-sm font-medium text-gray-300 mb-1.5',
    'badge': 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium',
    'badge-pending': 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25',
    'badge-running': 'bg-blue-500/15 text-blue-300 border border-blue-500/25',
    'badge-completed': 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
    'badge-failed': 'bg-red-500/15 text-red-300 border border-red-500/25',
    'badge-cancelled': 'bg-gray-500/15 text-gray-400 border border-gray-500/25',
    'stat-card': 'bg-gray-800/60 rounded-xl border border-gray-700/50 p-5 hover:bg-gray-800/80 transition-all duration-300',
    'divider': 'border-t border-gray-700/60',
  },
})
