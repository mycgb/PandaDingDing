/** 渲染层访问主进程 API 的类型安全封装 */
import type { IpcInvokeMap, AlertEvent, PetState, QuoteSnapshot, SystemNotice, AppSettings, UpdateProgress } from '@shared/index'
import { IPC } from '@shared/index'

declare global {
  interface Window {
    petApi: {
      [K in keyof IpcInvokeMap]: IpcInvokeMap[K] extends (...a: infer A) => infer R
        ? (...args: A) => Promise<R>
        : never
    } & {
      on: (channel: string, cb: (...args: unknown[]) => void) => () => void
    }
  }
}

export const api = window.petApi

export function onQuote(cb: (snaps: QuoteSnapshot[]) => void): () => void {
  return api.on(IPC.push.quoteSnapshot, (s) => cb(s as QuoteSnapshot[]))
}
export function onIndexQuotes(cb: (snaps: QuoteSnapshot[]) => void): () => void {
  return api.on(IPC.push.indexQuotes, (s) => cb(s as QuoteSnapshot[]))
}
export function onAlert(cb: (e: AlertEvent) => void): () => void {
  return api.on(IPC.push.alertTriggered, (e) => cb(e as AlertEvent))
}
export function onNotice(cb: (n: SystemNotice) => void): () => void {
  return api.on(IPC.push.systemNotice, (n) => cb(n as SystemNotice))
}
export function onPetState(cb: (s: PetState) => void): () => void {
  return api.on(IPC.push.petState, (s) => cb(s as PetState))
}
export function onSettingsChanged(cb: (s: AppSettings) => void): () => void {
  return api.on(IPC.push.settingsChanged, (s) => cb(s as AppSettings))
}
export function onUpdateProgress(cb: (p: UpdateProgress) => void): () => void {
  return api.on(IPC.push.updateProgress, (p) => cb(p as UpdateProgress))
}
