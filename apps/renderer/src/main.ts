import { createApp } from 'vue'
import App from './App.vue'

// 单页双模式：?window=pet → 桌宠 / ?window=panel → 管理面板
const mode = new URLSearchParams(location.search).get('window') ?? 'panel'
document.title = mode === 'pet' || mode === 'index' ? '' : '熊猫盯盯 · 管理面板'

createApp(App, { mode }).mount('#app')
