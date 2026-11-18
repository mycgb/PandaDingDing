/** 面板主题状态：SettingsView 修改，PanelRoot 响应。 */
import { ref } from 'vue'
import type { AppSettings } from '@shared/index'

export type Theme = AppSettings['theme']

export const theme = ref<Theme>('light')

export function setTheme(t: Theme): void {
  theme.value = t
}
