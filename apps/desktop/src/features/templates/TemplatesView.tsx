import { useEffect, useRef, useState } from 'react'
import { idb, uid, type Identified } from '../../data/idb'
import styles from './templates.module.css'

export interface Template extends Identified {
  id: string
  name: string
  body: string
  createdAt?: number
}

const DEFAULT_TEMPLATES: Template[] = [
  { id: 'tpl_review', name: '代码审查', body: '请审查以下代码的 bug、安全和性能问题：\n\n{{selected_text}}' },
  { id: 'tpl_explain', name: '解释代码', body: '用通俗语言解释这段代码做什么：\n\n{{clipboard}}' },
  { id: 'tpl_commit', name: '生成提交信息', body: '基于当前改动生成一条 Conventional Commits 提交信息。日期：{{date}}' },
  { id: 'tpl_refactor', name: '重构建议', body: '请给出重构建议，目标：{{目标}}。约束：{{约束}}' },
]

async function loadTemplates(): Promise<Template[]> {
  let list = await idb.getAll<Template>('templates')
  if (!list.length) {
    for (const t of DEFAULT_TEMPLATES) await idb.put('templates', { ...t, createdAt: Date.now() })
    list = DEFAULT_TEMPLATES.map((t) => ({ ...t }))
  }
  return list
}

interface EditorState {
  open: boolean
  tpl: Template | null
}

export function TemplatesView() {
  const [list, setList] = useState<Template[] | null>(null)
  const [editor, setEditor] = useState<EditorState>({ open: false, tpl: null })
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = () => loadTemplates().then(setList)
  useEffect(() => {
    refresh()
  }, [])

  const remove = async (id: string) => {
    await idb.delete('templates', id)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <div className="view-head">
        <h1>提示词模板</h1>
        <div className="vh-actions">
          <button className="btn-primary" onClick={() => setEditor({ open: true, tpl: null })}>
            + 新建模板
          </button>
        </div>
      </div>
      <div className="preset-body">
        <div className={styles.hint}>
          在对话输入框键入 <code>/</code> 可快速插入模板。支持变量：<code>{'{{date}}'}</code>{' '}
          <code>{'{{time}}'}</code> <code>{'{{clipboard}}'}</code> <code>{'{{selected_text}}'}</code>
          ，自定义变量如 <code>{'{{目标}}'}</code> 会变成待填占位，用 <kbd>Tab</kbd> 跳转。
        </div>
        {list === null ? (
          <div>
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <h2>还没有模板</h2>
          </div>
        ) : (
          <div className="preset-grid">
            {list.map((t) => (
              <div className="preset-card" key={t.id}>
                <div className="pc-top">
                  <span className="pc-badge">/</span>
                  <div className="pc-acts">
                    {confirmId === t.id ? (
                      <span className={styles.confirm}>
                        <button className="pc-icon" onClick={() => remove(t.id)} title="确认删除">
                          ✓
                        </button>
                        <button className="pc-icon" onClick={() => setConfirmId(null)} title="取消">
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button className="pc-icon" onClick={() => setConfirmId(t.id)} title="删除">
                        🗑
                      </button>
                    )}
                  </div>
                </div>
                <div className="pc-name">{t.name}</div>
                <div className="pc-prompt">{t.body}</div>
                <div className="pc-foot">
                  <button className="btn-ghost" onClick={() => setEditor({ open: true, tpl: t })}>
                    编辑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editor.open && (
        <TemplateEditor
          tpl={editor.tpl}
          onClose={() => setEditor({ open: false, tpl: null })}
          onSaved={() => {
            setEditor({ open: false, tpl: null })
            refresh()
          }}
        />
      )}
    </>
  )
}

function TemplateEditor({
  tpl,
  onClose,
  onSaved,
}: {
  tpl: Template | null
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !tpl
  const [name, setName] = useState(tpl?.name ?? '')
  const [body, setBody] = useState(tpl?.body ?? '')
  const [err, setErr] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setErr('名称不能为空')
      return
    }
    try {
      await idb.put<Template>('templates', {
        id: tpl?.id ?? uid('tpl'),
        name: trimmed,
        body,
        createdAt: tpl?.createdAt ?? Date.now(),
      })
      onSaved()
    } catch (e) {
      setErr(`保存失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="modal-overlay show" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">{isNew ? '新建模板' : '编辑模板'}</div>
        <label>
          名称
          <input
            ref={nameRef}
            type="text"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <span className="field-err">{err}</span>
        <label>
          内容（用 {'{{变量}}'} 定义占位）
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
