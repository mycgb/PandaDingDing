<template>
  <div class="bubble-layer">
    <div v-for="b in bubbles" :key="b.id" class="bubble" :class="[b.kind, b.tone]"
         :style="{
           ...(b.kind === 'tick' ? { backgroundColor: bubbleColor } : {}),
           fontSize: `${fontSize}px`,
           padding: `${Math.max(3, Math.round(fontSize * 0.3))}px ${Math.max(7, Math.round(fontSize * 0.65))}px`
         }"
         @click="$emit('dismiss', b.id)">
      <span class="bubble-text">{{ b.text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  bubbles: { id: number; kind: 'tick' | 'alert' | 'system'; text: string; tone?: 'up' | 'down' | 'neutral' }[]
  bubbleColor?: string
  fontSize?: number
}>()
defineEmits<{ (e: 'dismiss', id: number): void }>()
</script>

<style scoped>
.bubble-layer {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 148px;             /* 桌宠窗口 160px 两侧各留 6px，气泡绝不越界 */
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  pointer-events: auto;
}
.bubble {
  /* 宽度严格限制在桌宠窗口(160px)内：max-width 用 92% 并 box-sizing:border-box，
     确保含边框/内边距后也绝不超出窗口，圆角完整可见；长文本折行。 */
  width: max-content;
  max-width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  border-radius: 8px;
  font: 11px/1.35 'Segoe UI', 'Microsoft YaHei', sans-serif;
  color: #fff;
  background: rgba(20, 24, 30, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  animation: pop-in 0.18s ease-out;
  white-space: normal;          /* 允许折行 */
  overflow-wrap: break-word;    /* 长名称也能安全换行 */
  text-align: center;
}
.bubble.alert { font-weight: 700; font-size: 11px; }
.bubble.alert.up { background: rgba(200, 60, 60, 0.92); }
.bubble.alert.down { background: rgba(40, 160, 90, 0.92); }
.bubble.tick.up { color: #ff7b7b; }
.bubble.tick.down { color: #6fd96f; }
.bubble.system { background: rgba(40, 60, 100, 0.9); }
@keyframes pop-in {
  from { opacity: 0; transform: translateY(6px) scale(0.92); }
  to { opacity: 1; transform: none; }
}
</style>
