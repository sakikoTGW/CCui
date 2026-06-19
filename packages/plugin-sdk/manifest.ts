/**
 * ccui.plugin.json — 插件清单 schema（单一真相，zod 运行时校验）。
 *
 * 一个插件 = 一个目录，根放 ccui.plugin.json。UI 类插件声明一个 view 入口
 * （相对 HTML），由宿主在沙箱 iframe 中加载。能力（permissions）显式声明，
 * 宿主据此对 postMessage RPC 做白名单门控——未声明即拒绝。
 */
import { z } from 'zod'

export const MANIFEST_FILE = 'ccui.plugin.json'

/** 插件可申请的能力。宿主按此做 RPC 门控。 */
export const PluginPermissionSchema = z.enum([
  'toast', // 弹 toast 提示
  'bus:emit', // 向宿主事件总线发事件（受安全事件白名单二次约束）
  'bus:on', // 订阅宿主事件
  'store:read', // 读取共享 store 快照
  'daemon:request', // 调 daemon 只读命令（受命令白名单约束）
])
export type PluginPermission = z.infer<typeof PluginPermissionSchema>

export const PluginUiSchema = z.object({
  kind: z.literal('view'),
  title: z.string().min(1),
  /** 一级导航图标 id（复用内置 ICONS），缺省用通用插件图标 */
  icon: z.string().optional(),
  /** 相对插件目录的 HTML 入口，如 "index.html" */
  entry: z.string().min(1),
})
export type PluginUi = z.infer<typeof PluginUiSchema>

export const PluginManifestSchema = z.object({
  /** 全局唯一 id：小写字母/数字/-_. */
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'id 只能含小写字母、数字、. _ -，且字母/数字开头'),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  ui: PluginUiSchema.optional(),
  permissions: z.array(PluginPermissionSchema).default([]),
})
export type PluginManifest = z.infer<typeof PluginManifestSchema>

export interface ParseOk {
  ok: true
  manifest: PluginManifest
}
export interface ParseErr {
  ok: false
  error: string
}

/** 解析 + 校验清单 JSON 文本。永不抛错，返回判别式结果。 */
export function parseManifest(raw: string): ParseOk | ParseErr {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message}` }
  }
  const r = PluginManifestSchema.safeParse(json)
  if (!r.success) {
    const first = r.error.issues[0]
    return {
      ok: false,
      error: first ? `${first.path.join('.') || '<root>'}: ${first.message}` : '清单校验失败',
    }
  }
  return { ok: true, manifest: r.data }
}
