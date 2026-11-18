/** petWindow 查询：handlers 回查主进程创建的桌宠窗口 */
import { BrowserWindow } from 'electron'

let petWindow: BrowserWindow | null = null

export function setPetWindow(w: BrowserWindow | null): void { petWindow = w }
export function getCurrentPetWindow(): BrowserWindow | null {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null
}
