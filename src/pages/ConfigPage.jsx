import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import { Download, Trash } from '../components/icons'

const TABS = [
  { key: 'accounts', label: '账号' },
  { key: 'monitor', label: '监控账号' },
  { key: 'ai', label: 'AI' },
  { key: 'schedule', label: '调度' }
]

function ConfigPage() {
  const [config, setConfig] = useState({ cookie: '', euids: [], interval: 3000 })
  const [users, setUsers] = useState([])
  const [newEuid, setNewEuid] = useState('')
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [tab, setTab] = useState('accounts')

  // 多 cookie 账号管理
  const [cookies, setCookies] = useState([])
  const [newCookie, setNewCookie] = useState('')
  const [newName, setNewName] = useState('')
  const [newEuidInput, setNewEuidInput] = useState('')
  const [editingAccount, setEditingAccount] = useState(null) // { id, name, euid, cookie }
  const startEdit = (a) =>
    setEditingAccount({
      id: a.id,
      name: a.name || '',
      euid: a.euid || '',
      cookie: a.cookie || ''
    })

  useEffect(() => {
    load()
    loadCookies()
  }, [])

  const load = async () => {
    try {
      const [c, u] = await Promise.all([axios.get('/api/config'), axios.get('/api/users')])
      setConfig({ cookie: '', euids: [], interval: 3000, ...c.data })
      setUsers(u.data)
    } catch (error) {
      toast.error('加载失败: ' + error.message)
    }
  }

  const loadCookies = async () => {
    try {
      const r = await axios.get('/api/accounts')
      setCookies(r.data.accounts || [])
    } catch (e) {
      console.error(e)
    }
  }

  const addCookie = async () => {
    if (!newCookie.trim()) return toast.error('先粘贴 cookie')
    try {
      await axios.post('/api/accounts', {
        cookie: newCookie.trim(),
        name: newName.trim() || undefined,
        euid: newEuidInput.trim() || undefined
      })
      setNewCookie('')
      setNewName('')
      setNewEuidInput('')
      toast.success('已添加')
      loadCookies()
    } catch (e) {
      toast.error('添加失败: ' + e.message)
    }
  }

  const updateCookie = async () => {
    if (!editingAccount) return
    const patch = { name: editingAccount.name, euid: editingAccount.euid }
    // cookie 留空时不发，避免误清空
    if (editingAccount.cookie && editingAccount.cookie.trim()) {
      patch.cookie = editingAccount.cookie.trim()
    }
    try {
      await axios.patch(`/api/accounts/${editingAccount.id}`, patch)
      toast.success('已保存')
      setEditingAccount(null)
      loadCookies()
    } catch (e) {
      toast.error('保存失败: ' + e.message)
    }
  }

  const removeCookie = async (id) => {
    if (!window.confirm(`删除账号 ${id}？`)) return
    try {
      await axios.delete(`/api/accounts/${id}`)
      toast.success('已删除')
      loadCookies()
    } catch (e) {
      toast.error('删除失败: ' + e.message)
    }
  }

  const setPrimaryAccount = async (id) => {
    try {
      await axios.post(`/api/accounts/${id}/primary`)
      toast.success(`${id} 已设为主账号`)
      loadCookies()
    } catch (e) {
      toast.error('设置失败: ' + e.message)
    }
  }

  const save = async (next) => {
    const payload = next || config
    setSaving(true)
    try {
      await axios.post('/api/config', payload)
      setConfig(payload)
      const u = await axios.get('/api/users')
      setUsers(u.data)
      toast.success('已保存')
    } catch (error) {
      toast.error('保存失败: ' + error.message)
    }
    setSaving(false)
  }

  const addEuid = () => {
    const euid = newEuid.trim()
    if (!euid) return toast.error('先输入用户 ID')
    if (config.euids.includes(euid)) return toast.error('该 ID 已存在')
    setNewEuid('')
    save({ ...config, euids: [...config.euids, euid] })
  }

  const removeEuid = (euid) => {
    save({ ...config, euids: config.euids.filter((e) => e !== euid) })
    setConfirmRemove(null)
  }

  const fetchInfo = async (euid) => {
    setFetching(euid)
    try {
      await axios.post('/api/fetch-user-info', { euid })
      const u = await axios.get('/api/users')
      setUsers(u.data)
      toast.success('已更新')
    } catch (error) {
      toast.error('抓取失败: ' + error.message)
    }
    setFetching('')
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">设置</h1>
        <span className="page-sub">请求配置 · 监控账号</span>
      </div>

      {/* 子 tab 切换 */}
      <nav className="nav-tabs" style={{ marginLeft: 0, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* 请求 tab */}
      {/* 监控账号 tab */}
      {tab === 'monitor' && (
        <div>
          <div className="toolbar">
            <input
              className="input"
              value={newEuid}
              onChange={(e) => setNewEuid(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEuid()}
              placeholder="用户 ID"
              style={{ maxWidth: '200px' }}
            />
            <Button onClick={addEuid} disabled={saving}>添加</Button>
          </div>

          {config.euids.length === 0 && <EmptyState title="还没有账号" />}

          {config.euids.map((euid) => {
            const user = users.find((u) => u.euid === euid) || {}
            const initial = (user.username || `用 ${euid}`).slice(0, 1)
            const fetched = Boolean(user.lastUpdate)
            return (
              <div key={euid} className="account">
                <div className="avatar-lg">{initial}</div>
                <div className="account-body">
                  <div className="account-name">{user.username || `用户 ${euid}`}</div>
                  <div className="account-meta">
                    <span>{euid}</span>
                    {user.replyCount ? (
                      <>
                        <span className="sep">·</span>
                        <span>回帖 {user.replyCount}</span>
                      </>
                    ) : null}
                    {user.recommendCount ? (
                      <>
                        <span className="sep">·</span>
                        <span>推荐 {user.recommendCount}</span>
                      </>
                    ) : null}
                    {user.reputation && user.reputation !== '-' ? (
                      <>
                        <span className="sep">·</span>
                        <span>声望 {user.reputation}</span>
                      </>
                    ) : null}
                    <span className="sep">·</span>
                    <span>{fetched ? `更新于 ${new Date(user.lastUpdate).toLocaleDateString('zh-CN')}` : '未抓取'}</span>
                  </div>
                </div>
                <div className="account-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => fetchInfo(euid)}
                    disabled={fetching === euid}
                  >
                    {fetching === euid ? '抓取中…' : (<><Download /> 抓取</>)}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirmRemove(euid)}
                    disabled={saving}
                  >
                    <Trash />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 账号 tab（多 cookie 管理） */}
      {/* 账号 tab（合并：批量举报间隔 + 主账号管理 + 多 cookie 列表） */}
      {tab === 'accounts' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="interval">批量举报间隔</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  id="interval"
                  className="input"
                  type="number"
                  min="1000"
                  step="500"
                  style={{ width: '120px' }}
                  value={config.interval}
                  onChange={(e) =>
                    setConfig({ ...config, interval: Number(e.target.value) })
                  }
                />
                <span className="field-hint" style={{ marginTop: 0 }}>毫秒 · 太短容易被限制 IP</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button variant="primary" onClick={() => save()} disabled={saving}>
                {saving ? '保存中…' : '保存设置'}
              </Button>
            </div>
          </div>

          <div className="section-head" style={{ marginBottom: 8 }}>
            <h2 className="section-title">操作账号</h2>
            <span className="section-sub">标 ⭐ 的为主账号，所有举报/抓取都使用主账号 cookie</span>
          </div>

          <div className="toolbar">
            <input
              className="input"
              value={newCookie}
              onChange={(e) => setNewCookie(e.target.value)}
              placeholder="粘贴 cookie"
              style={{ minWidth: 200, flex: 1 }}
            />
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="昵称（可选）"
              style={{ width: 140 }}
            />
            <input
              className="input"
              value={newEuidInput}
              onChange={(e) => setNewEuidInput(e.target.value)}
              placeholder="euid（如 21291079）"
              style={{ width: 160 }}
            />
            <Button onClick={addCookie}>添加</Button>
          </div>

          {cookies.length === 0 && <EmptyState title="还没有账号" hint="粘贴 cookie 添加" />}

          {cookies.map((a) => (
            <div key={a.id} className="account">
              <div
                className="avatar-lg"
                style={{
                  background: a.primary
                    ? 'var(--accent-bg)'
                    : a.id === 'A'
                    ? 'var(--accent-bg)'
                    : a.id === 'B'
                    ? '#e8f5e9'
                    : a.id === 'C'
                    ? '#e3f2fd'
                    : 'var(--bg-2)',
                  color: a.primary
                    ? 'var(--accent)'
                    : a.id === 'A'
                    ? 'var(--accent)'
                    : a.id === 'B'
                    ? '#1f7a4d'
                    : a.id === 'C'
                    ? '#1565c0'
                    : 'var(--text-2)'
                }}
              >
                {a.primary ? '★' : a.id}
              </div>
              <div className="account-body">
                {editingAccount?.id === a.id ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      className="input"
                      value={editingAccount.name}
                      onChange={(e) =>
                        setEditingAccount({ ...editingAccount, name: e.target.value })
                      }
                      placeholder="昵称"
                      style={{ width: 140 }}
                    />
                    <input
                      className="input"
                      value={editingAccount.euid}
                      onChange={(e) =>
                        setEditingAccount({ ...editingAccount, euid: e.target.value })
                      }
                      placeholder="euid"
                      style={{ width: 160 }}
                    />
                    <input
                      className="input"
                      type="password"
                      value={editingAccount.cookie}
                      onChange={(e) =>
                        setEditingAccount({ ...editingAccount, cookie: e.target.value })
                      }
                      placeholder="新 cookie（留空保持原值）"
                      style={{
                        width: 360,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        fontSize: 12
                      }}
                    />
                    <Button size="sm" variant="primary" onClick={updateCookie}>
                      保存
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingAccount(null)}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="account-name">
                      {a.name || `账号 ${a.id}`}
                      {a.primary && (
                        <span
                          className="badge"
                          style={{
                            marginLeft: 8,
                            background: 'var(--accent-bg)',
                            color: 'var(--accent)',
                            borderColor: 'transparent'
                          }}
                        >
                          ⭐ 主账号
                        </span>
                      )}
                      {a.migrated && !a.primary && (
                        <span className="badge" style={{ marginLeft: 8 }}>已迁移</span>
                      )}
                    </div>
                    <div className="account-meta">
                      <span>id: {a.id}</span>
                      <span className="sep">·</span>
                      <span>euid: {a.euid || '(未填)'}</span>
                      <span className="sep">·</span>
                      <span>{a.cookie}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="account-actions">
                {!editingAccount && (
                  <>
                    {!a.primary && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPrimaryAccount(a.id)}
                      >
                        设为主账号
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => startEdit(a)}>
                      编辑
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => removeCookie(a.id)}>
                      <Trash />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}

          {cookies.length > 0 && (
            <div className="hint" style={{ marginTop: 16, fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>
              跨号任务（号间互相点亮/推荐）在 <code>config.interact.pairs</code> 里配置。
            </div>
          )}
        </div>
      )}

      {/* AI tab */}
      {tab === 'ai' && <AITab />}

      {/* 调度 tab */}
      {tab === 'schedule' && <ScheduleTab />}

      <ConfirmDialog
        open={!!confirmRemove}
        onOpenChange={(o) => !o && setConfirmRemove(null)}
        title="移除账号"
        description={`确定要移除账号 ${confirmRemove} 吗？该操作不可撤销。`}
        confirmText="移除"
        danger
        onConfirm={() => removeEuid(confirmRemove)}
      />
    </div>
  )
}

export default ConfigPage

/* ===========================================================
   调度 Tab 子组件
   =========================================================== */

// 日志级别 → 颜色映射
const LOG_LEVEL_COLOR = {
  info: 'var(--text-2)',
  ok: 'var(--success)',
  warn: 'var(--accent)',
  err: 'var(--danger)'
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 在日志文本中把已知账号名加粗渲染。
 * 用「非汉字字符」作为边界，避免误匹配类似「水啦啦」。
 * @param {string} text
 * @param {string[]} names
 * @returns {Array|string} React 元素数组 或 原文本
 */
function boldify(text, names) {
  if (!names || names.length === 0) return text
  const valid = names.filter(Boolean)
  if (valid.length === 0) return text
  // 名字长的优先匹配（避免「A」被「AA」先匹配）
  const sorted = [...valid].sort((a, b) => b.length - a.length)
  const re = new RegExp(
    `(^|[^\\u4e00-\\u9fff])(${sorted.map(escapeRegex).join('|')})(?=$|[^\\u4e00-\\u9fff])`,
    'g'
  )
  const parts = []
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1]) parts.push(m[1])
    parts.push(
      <strong key={parts.length} style={{ fontWeight: 700 }}>
        {m[2]}
      </strong>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : text
}

function LogList({ entries, names }) {
  if (!entries || entries.length === 0) return null
  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        background: 'var(--bg-2)',
        borderRadius: 'var(--r-sm)',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 12,
        lineHeight: 1.7,
        maxHeight: 360,
        overflowY: 'auto'
      }}
    >
      {entries.map((e, i) => (
        <div
          key={i}
          style={{
            color: LOG_LEVEL_COLOR[e.level] || 'var(--text-2)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {boldify(e.line, names)}
        </div>
      ))}
    </div>
  )
}

function ScheduleTab() {
  const [board, setBoard] = useState([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState({}) // taskId -> bool
  const [feedback, setFeedback] = useState(null) // {type, msg}
  const [accountNames, setAccountNames] = useState([]) // 用于日志加粗

  const load = async () => {
    try {
      const r = await axios.get('/api/scheduler/board')
      setBoard(r.data.tasks || [])
    } catch (e) {
      toast.error('加载失败: ' + e.message)
    }
  }

  const loadAccountNames = async () => {
    try {
      const r = await axios.get('/api/accounts')
      const names = (r.data.accounts || []).map((a) => a.name).filter(Boolean)
      setAccountNames(names)
    } catch {
      // 静默失败：没拿到 names 就当普通文本渲染
    }
  }

  useEffect(() => {
    load()
    loadAccountNames()
    const t = setInterval(load, 5000) // 5s 轮询，让状态实时
    return () => clearInterval(t)
  }, [])

  const save = async (id, patch) => {
    try {
      await axios.patch(`/api/scheduler/task/${id}`, patch)
      toast.success('已保存')
      load()
    } catch (e) {
      toast.error('保存失败: ' + e.message)
    }
  }

  const runNow = async (id, opts = {}) => {
    const { force: forceOpt, retryOnly } = opts
    setRunning((r) => ({ ...r, [id]: true }))
    setFeedback(null)
    try {
      const res = await axios.post(`/api/scheduler/run/${id}`, { force: forceOpt, retryOnly })
      const d = res.data
      if (d.skipped) {
        if (d.reason === '今日已跑过') {
          setFeedback({
            type: 'warn',
            msg: `「${id}」今天已经跑过了（${d.todayRun?.at}）。如需重跑失败请点「立即跑」，全部重跑请点「强制重跑」。`
          })
        } else if (d.reason === '没有失败的操作可重跑') {
          setFeedback({
            type: 'info',
            msg: `「${id}」上次没有失败操作，无需重跑。`
          })
        } else {
          setFeedback({ type: 'info', msg: `${d.reason}` })
        }
      } else if (d.success) {
        const counts = countLogs(d.logEntries || [])
        const failedActions = d.result?.failedActions?.length || 0
        const modeLabel = retryOnly ? '重跑失败完成' : '跑完了'
        const failedMsg = failedActions > 0 ? `，仍失败 ${failedActions} 条` : ''
        setFeedback({
          type: failedActions > 0 ? 'warn' : 'success',
          msg: `「${id}」${modeLabel}。真成功 ${counts.ok} 条 · 幂等 ${counts.warn} 条 · 失败 ${counts.err} 条${failedMsg}`
        })
      } else {
        setFeedback({ type: 'error', msg: `「${id}」跑失败：${d.error}` })
      }
      load()
    } catch (e) {
      setFeedback({ type: 'error', msg: `「${id}」触发失败：${e.message}` })
    }
    setRunning((r) => ({ ...r, [id]: false }))
  }

  const copyLogs = (entries) => {
    const text = (entries || []).map((e) => e.line).join('\n')
    navigator.clipboard?.writeText(text).then(
      () => toast.success('已复制日志'),
      () => toast.error('复制失败')
    )
  }

  return (
    <div>
      {feedback && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--r-sm)',
            marginBottom: 16,
            fontSize: 'var(--fs-13)',
            background:
              feedback.type === 'success'
                ? 'var(--success-bg)'
                : feedback.type === 'warn'
                ? 'var(--accent-bg)'
                : feedback.type === 'error'
                ? 'var(--danger-bg)'
                : 'var(--bg-2)',
            color:
              feedback.type === 'success'
                ? 'var(--success)'
                : feedback.type === 'warn'
                ? 'var(--accent)'
                : feedback.type === 'error'
                ? 'var(--danger)'
                : 'var(--text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {feedback.msg}
        </div>
      )}

      {board.map((t) => {
        const entries = t.lastResult?.logEntries || []
        const counts = countLogs(entries)
        return (
          <div key={t.id} className="card" style={{ marginBottom: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                {/* 标题 + 今日状态 badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>
                    {t.name}
                  </div>
                  {t.ranToday && t.todayRun && (
                    <span
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 'var(--r-pill)',
                        background: t.todayRun.success ? 'var(--success-bg)' : 'var(--danger-bg)',
                        color: t.todayRun.success ? 'var(--success)' : 'var(--danger)',
                        fontWeight: 500
                      }}
                    >
                      {t.todayRun.success ? '✓' : '✗'} 今日 {t.todayRun.at} 已完成
                    </span>
                  )}
                  {t.running && (
                    <span
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 'var(--r-pill)',
                        background: 'var(--accent-bg)',
                        color: 'var(--accent)',
                        fontWeight: 500
                      }}
                    >
                      ⏳ 正在执行
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                  {t.description}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
                  下次执行: {t.nextRun ? new Date(t.nextRun).toLocaleString('zh-CN') : '—'}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 'var(--fs-13)',
                    color: 'var(--text-2)'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => save(t.id, { enabled: e.target.checked })}
                  />
                  启用
                </label>

                <input
                  className="input"
                  type="time"
                  value={t.schedule || ''}
                  onChange={(e) => save(t.id, { schedule: e.target.value })}
                  disabled={!t.enabled}
                  style={{ width: 100 }}
                />

                <Button
                  onClick={() => runNow(t.id, { retryOnly: true })}
                  disabled={t.running || running[t.id]}
                >
                  {t.running || running[t.id]
                    ? '跑着...'
                    : (() => {
                        const n = t.lastResult?.failedActions?.length || 0
                        return n > 0 ? `重跑失败 (${n})` : '立即跑'
                      })()}
                </Button>
                {t.ranToday && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm('确定要重新跑一次？（会再调一次虎扑接口）')) {
                        runNow(t.id, { force: true })
                      }
                    }}
                    disabled={t.running || running[t.id]}
                  >
                    强制重跑
                  </Button>
                )}
              </div>
            </div>

            {/* 上次执行日志 */}
            {entries.length > 0 && (
              <details style={{ marginTop: 12 }} open>
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: 'var(--fs-13)',
                    color: 'var(--text-2)',
                    userSelect: 'none',
                    listStyle: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  <span style={{ display: 'inline-block', transition: 'transform 120ms' }} className="caret">
                    ▸
                  </span>
                  <span>上次执行日志 · 共 {entries.length} 条</span>
                  <span style={{ color: 'var(--success)' }}>真成功 {counts.ok}</span>
                  <span style={{ color: 'var(--accent)' }}>幂等 {counts.warn}</span>
                  <span style={{ color: 'var(--danger)' }}>失败 {counts.err}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      copyLogs(entries)
                    }}
                    style={{
                      marginLeft: 'auto',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text-2)',
                      borderRadius: 'var(--r-sm)',
                      padding: '2px 8px',
                      fontSize: 12,
                      cursor: 'pointer'
                    }}
                  >
                    复制
                  </button>
                </summary>
                <LogList entries={entries} names={accountNames} />
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}

function countLogs(entries) {
  const c = { ok: 0, warn: 0, err: 0, info: 0 }
  for (const e of entries || []) {
    if (c[e.level] != null) c[e.level]++
  }
  return c
}

/* ===========================================================
   AI 配置 Tab 子组件
   =========================================================== */
function AITab() {
  const [providers, setProviders] = useState([])
  const [ai, setAi] = useState({ provider: '', apiKey: '', model: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // {success, content, error}

  useEffect(() => {
    // 拉 providers + 当前 AI 配置
    Promise.all([axios.get('/api/ai/providers'), axios.get('/api/config')]).then(
      ([pr, cfg]) => {
        setProviders(pr.data.providers || [])
        setAi({
          provider: cfg.data.ai?.provider || 'deepseek',
          apiKey: cfg.data.ai?.apiKey || '',
          model: cfg.data.ai?.model || ''
        })
      }
    )
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      // 用 PATCH 方式合并（只更新 ai 字段）
      const cfg = (await axios.get('/api/config')).data
      cfg.ai = { provider: ai.provider, apiKey: ai.apiKey, model: ai.model }
      await axios.post('/api/config', cfg)
      toast.success('已保存')
    } catch (e) {
      toast.error('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 先保存当前输入
      const cfg = (await axios.get('/api/config')).data
      cfg.ai = { provider: ai.provider, apiKey: ai.apiKey, model: ai.model }
      await axios.post('/api/config', cfg)
      // 再测试
      const r = await axios.post('/api/ai/generate', {
        threadTitle: '湖人这场打得不错，你怎么看？'
      })
      setTestResult({ success: true, content: r.data.content })
    } catch (e) {
      setTestResult({ success: false, error: e.response?.data?.error || e.message })
    }
    setTesting(false)
  }

  const currentProvider = providers.find((p) => p.key === ai.provider)

  return (
    <div>
      <div className="card">
        <div className="section-head" style={{ marginBottom: 12 }}>
          <h2 className="section-title">AI Provider 配置</h2>
          <span className="section-sub">用于「号与号互相回复」任务，自动生成评论内容</span>
        </div>

        <div className="field">
          <label className="field-label">Provider</label>
          <select
            className="input"
            value={ai.provider}
            onChange={(e) => setAi({ ...ai, provider: e.target.value, model: '' })}
            style={{ maxWidth: 280 }}
          >
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="field-hint">
            当前选 {currentProvider?.name || '?'}，默认模型 {currentProvider?.defaultModel || '?'}
          </div>
        </div>

        <div className="field">
          <label className="field-label">API Key</label>
          <input
            className="input"
            type="password"
            value={ai.apiKey}
            onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
            placeholder="sk-..."
            style={{ maxWidth: 400 }}
          />
          <div className="field-hint">存到 server/data/config.json，不入库</div>
        </div>

        <div className="field">
          <label className="field-label">Model（可选）</label>
          <input
            className="input"
            value={ai.model}
            onChange={(e) => setAi({ ...ai, model: e.target.value })}
            placeholder={currentProvider?.defaultModel || '留空用默认'}
            style={{ maxWidth: 400 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button onClick={test} disabled={testing || !ai.apiKey}>
            {testing ? '生成中…' : '测试生成'}
          </Button>
        </div>

        {testResult && (
          <div
            style={{
              marginTop: 16,
              padding: '12px 14px',
              borderRadius: 'var(--r-sm)',
              fontSize: 'var(--fs-13)',
              background: testResult.success ? 'var(--success-bg)' : 'var(--danger-bg)',
              color: testResult.success ? 'var(--success)' : 'var(--danger)'
            }}
          >
            {testResult.success ? (
              <>
                ✓ 生成成功：
                <span style={{ marginLeft: 6, fontFamily: 'ui-monospace, monospace' }}>
                  {testResult.content}
                </span>
              </>
            ) : (
              <>✗ 失败：{testResult.error}</>
            )}
          </div>
        )}
      </div>

      <div
        className="hint"
        style={{
          marginTop: 16,
          fontSize: 'var(--fs-12)',
          color: 'var(--text-3)',
          lineHeight: 1.6
        }}
      >
        💡 提示：AI 用于「号与号互相回复」任务，每天给 to 的 1 条主题帖回 3 条 + 给首页 5 条帖子各回 1 条（每个号 8 条）。<br />
        评论由 AI 自动生成（20 字以内，口语化）。虎扑风控可能拒掉部分 reply（频率限制），任务日志会显示每条的真实结果。
      </div>
    </div>
  )
}
