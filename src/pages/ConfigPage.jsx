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
      cookie: a.cookie || '',
      appAuth: a.appAuth || {},
      appSessions: a.appSessions || { reply: {}, follow: {}, share: {} }
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
    // appAuth + appSessions 一并保存（per-account 配置，跟账号绑定）
    if (editingAccount.appAuth) {
      patch.appAuth = editingAccount.appAuth
    }
    if (editingAccount.appSessions) {
      patch.appSessions = editingAccount.appSessions
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

  const updateAppAuth = (field, value) => {
    setEditingAccount({
      ...editingAccount,
      appAuth: { ...(editingAccount.appAuth || {}), [field]: value }
    })
  }

  const updateAppSession = (sessionKey, field, value) => {
    setEditingAccount({
      ...editingAccount,
      appSessions: {
        ...(editingAccount.appSessions || {}),
        [sessionKey]: {
          ...(editingAccount.appSessions?.[sessionKey] || {}),
          [field]: value
        }
      }
    })
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
            <div
              key={a.id}
              className={`account ${editingAccount?.id === a.id ? 'account-editing' : ''}`}
            >
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
                  <div className="field-group">
                    <div className="field">
                      <label className="field-label">昵称</label>
                      <input
                        className="input"
                        value={editingAccount.name}
                        onChange={(e) =>
                          setEditingAccount({ ...editingAccount, name: e.target.value })
                        }
                        placeholder="昵称"
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">euid</label>
                      <input
                        className="input"
                        value={editingAccount.euid}
                        onChange={(e) =>
                          setEditingAccount({ ...editingAccount, euid: e.target.value })
                        }
                        placeholder="euid（如 21291079）"
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 12 }}>
                      <label className="field-label">新 cookie</label>
                      <input
                        className="input"
                        type="password"
                        value={editingAccount.cookie}
                        onChange={(e) =>
                          setEditingAccount({ ...editingAccount, cookie: e.target.value })
                        }
                        placeholder="留空保持原值"
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          fontSize: 12
                        }}
                      />
                      <span className="field-hint">仅修改时粘贴新的；不填保留原 cookie</span>
                    </div>

                    {/* App 认证子区块 —— 账号共享 + 每个接口 */}
                    <div className="field">
                      <label className="field-label">App 认证（可选）</label>
                      <span className="field-hint">
                        用于 notifyShare / appReply / appFollow 等 mobileapi 操作。
                        x-hupu-token / cookie 账号级共享（同一账号同一会话）；
                        hupu-new-sign / hupu-encrypt-salt 每个接口单独配（per-request 变，session 过期重抓）。
                        详见抓包说明.md
                      </span>
                    </div>

                    {/* 账号共享 3 字段 */}
                    <div
                      style={{
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-sm)',
                        padding: 12,
                        marginBottom: 12,
                        background: 'var(--bg-2)'
                      }}
                    >
                      <div
                        style={{
                          fontSize: 'var(--fs-12)',
                          fontWeight: 500,
                          color: 'var(--accent)',
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace'
                        }}
                      >
                        📱 账号共享（2 字段）
                      </div>
                      <div className="field" style={{ marginBottom: 10 }}>
                        <label className="field-label" style={{ fontSize: 'var(--fs-12)' }}>x-hupu-token</label>
                        <textarea
                          className="textarea"
                          value={editingAccount.appAuth?.xHupuToken || ''}
                          onChange={(e) => updateAppAuth('xHupuToken', e.target.value)}
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                            fontSize: 12,
                            minHeight: 60
                          }}
                        />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label className="field-label" style={{ fontSize: 'var(--fs-12)' }}>cookie</label>
                        <textarea
                          className="textarea"
                          value={editingAccount.appAuth?.cookie || ''}
                          onChange={(e) => updateAppAuth('cookie', e.target.value)}
                          placeholder="留空保持原值"
                          style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                            fontSize: 12,
                            minHeight: 88
                          }}
                        />
                      </div>
                    </div>

                    {/* 每个接口 4 字段 */}
                    <div className="field">
                      <label className="field-label" style={{ fontSize: 'var(--fs-13)' }}>每个接口</label>
                      {[
                        { key: 'reply' },
                        { key: 'follow' },
                        { key: 'share' }
                      ].map((s) => {
                        const v = editingAccount.appSessions?.[s.key] || {}
                        return (
                          <div
                            key={s.key}
                            style={{
                              border: '1px solid var(--line)',
                              borderRadius: 'var(--r-sm)',
                              padding: 12,
                              marginTop: 8,
                              background: 'var(--bg-2)'
                            }}
                          >
                            <div
                              style={{
                                fontSize: 'var(--fs-12)',
                                fontWeight: 500,
                                color: 'var(--text-2)',
                                marginBottom: 8,
                                fontFamily: 'ui-monospace, SFMono-Regular, monospace'
                              }}
                            >
                              {s.key}
                            </div>
                            <div className="field" style={{ marginBottom: 10 }}>
                              <label className="field-label" style={{ fontSize: 'var(--fs-12)' }}>hupu-new-sign</label>
                              <input
                                className="input"
                                value={v.hupuNewSign || ''}
                                onChange={(e) => updateAppSession(s.key, 'hupuNewSign', e.target.value)}
                                style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}
                              />
                            </div>
                            <div className="field" style={{ marginBottom: 0 }}>
                              <label className="field-label" style={{ fontSize: 'var(--fs-12)' }}>hupu-encrypt-salt</label>
                              <textarea
                                className="textarea"
                                value={v.hupuEncryptSalt || ''}
                                onChange={(e) => updateAppSession(s.key, 'hupuEncryptSalt', e.target.value)}
                                style={{
                                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                                  fontSize: 12,
                                  minHeight: 60
                                }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="sm" variant="primary" onClick={updateCookie}>
                        保存
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingAccount(null)}>
                        取消
                      </Button>
                    </div>
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
                      {a.appSessions && Object.keys(a.appSessions).length > 0 && (
                        <span
                          className="badge"
                          style={{
                            marginLeft: 8,
                            background: 'var(--accent-bg)',
                            color: 'var(--accent)',
                            borderColor: 'transparent'
                          }}
                        >
                          📱 App {Object.keys(a.appSessions).length} 个 session
                        </span>
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
  const [accounts, setAccounts] = useState([]) // 用于「每日自动发帖」账号多选
  const [preview, setPreview] = useState({}) // taskId -> {loading, content}（仅预览类任务）

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
      const list = r.data.accounts || []
      setAccounts(list)
      setAccountNames(list.map((a) => a.name).filter(Boolean))
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

  const runNow = async (id, opts = {}, meta = {}) => {
    const { force: forceOpt, retryOnly } = opts
    setRunning((r) => ({ ...r, [id]: true }))
    setFeedback(null)
    try {
      const res = await axios.post(`/api/scheduler/run/${id}`, { force: forceOpt, retryOnly })
      const d = res.data
      if (d.skipped) {
        if (d.reason === '今日已跑过') {
          const retryHint = meta.hasFailures
            ? '如需重跑失败请点「立即跑」，'
            : ''
          setFeedback({
            type: 'warn',
            msg: `「${id}」今天已经跑过了（${d.todayRun?.at}）。${retryHint}全部重跑请点「强制重跑」。`
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

  const previewThread = async (id) => {
    setPreview((p) => ({ ...p, [id]: { loading: true } }))
    try {
      const r = await axios.post('/api/preview/thread')
      if (r.data.success) {
        setPreview((p) => ({
          ...p,
          [id]: { loading: false, content: r.data, error: null }
        }))
      } else {
        setPreview((p) => ({
          ...p,
          [id]: { loading: false, error: r.data.error || '生成失败' }
        }))
      }
    } catch (e) {
      setPreview((p) => ({
        ...p,
        [id]: { loading: false, error: e.response?.data?.error || e.message }
      }))
    }
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
        const failedCount = t.lastResult?.failedActions?.length || 0
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

                {/* 任务专属配置（目前 daily-post-content：账号 + 每天几条） */}
                {t.id === 'daily-post-content' && (
                  <TaskCfgRow
                    accounts={accounts}
                    taskCfg={t.taskCfg || {}}
                    primaryId={(accounts.find((a) => a.primary) || {}).id}
                    onSave={(patch) => save(t.id, patch)}
                  />
                )}
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
                  onClick={() => runNow(t.id, { retryOnly: failedCount > 0 }, { hasFailures: failedCount > 0 })}
                  disabled={t.running || running[t.id]}
                >
                  {t.running || running[t.id]
                    ? '跑着...'
                    : failedCount > 0
                      ? `重跑失败 (${failedCount})`
                      : '立即跑'}
                </Button>
                {t.id === 'daily-post-content' && (
                  <Button
                    variant="ghost"
                    onClick={() => previewThread(t.id)}
                    disabled={preview[t.id]?.loading}
                  >
                    {preview[t.id]?.loading ? '预览生成中…' : '预览生成'}
                  </Button>
                )}
                {t.ranToday && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm('确定要重新跑一次？（会再调一次虎扑接口）')) {
                        runNow(t.id, { force: true }, { hasFailures: failedCount > 0 })
                      }
                    }}
                    disabled={t.running || running[t.id]}
                  >
                    强制重跑
                  </Button>
                )}
              </div>
            </div>

            {/* AI 预览结果（仅 daily-post-content） */}
            {t.id === 'daily-post-content' && preview[t.id] && (
              <div
                style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--bg-2)',
                  fontSize: 'var(--fs-13)'
                }}
              >
                {preview[t.id].error ? (
                  <div style={{ color: 'var(--danger)' }}>✗ {preview[t.id].error}</div>
                ) : preview[t.id].content ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                        color: 'var(--text-3)',
                        fontSize: 12
                      }}
                    >
                      <span>预览生成结果（不会真发帖）</span>
                      <span
                        className="badge"
                        style={{
                          background: preview[t.id].content.kind === 'paper' ? 'var(--accent-bg)' : 'var(--bg)',
                          color: preview[t.id].content.kind === 'paper' ? 'var(--accent)' : 'var(--text-2)',
                          borderColor: 'transparent'
                        }}
                      >
                        {preview[t.id].content.kind === 'paper' ? '📄 论文/报告' : '💡 经典主题'}
                      </span>
                      <span style={{ color: 'var(--text-3)' }}>
                        候选 {preview[t.id].content.candidatesCount} · 已收录 {preview[t.id].content.usedTitlesCount}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>
                      {preview[t.id].content.title}
                    </div>
                    {preview[t.id].content.link && (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-3)',
                          marginBottom: 6,
                          wordBreak: 'break-all'
                        }}
                      >
                        🔗{' '}
                        <a
                          href={preview[t.id].content.link}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--accent)' }}
                        >
                          {preview[t.id].content.link}
                        </a>
                      </div>
                    )}
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)', lineHeight: 1.7 }}>
                      {preview[t.id].content.body}
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {/* 上次执行日志（默认收起，避免长 task 占太多空间） */}
            {entries.length > 0 && (
              <details style={{ marginTop: 12 }}>
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

/**
 * 任务专属配置行（目前只用于 daily-post-content）
 * - 账号多选（默认勾选主账号）
 * - 每个号每天发几条（1-5）
 * - 板块 fid（可选，默认 4860 = NBA 区）
 */
function TaskCfgRow({ accounts, taskCfg, primaryId, onSave }) {
  // 当前选中账号；未配置则默认勾选主账号（仅在本地 state 用）
  const [selectedIds, setSelectedIds] = useState(
    Array.isArray(taskCfg.accountIds) && taskCfg.accountIds.length > 0
      ? taskCfg.accountIds
      : primaryId
      ? [primaryId]
      : []
  )
  const [postsPerAccount, setPostsPerAccount] = useState(
    Number(taskCfg.postsPerAccount) || 1
  )
  const [fid, setFid] = useState(Number(taskCfg.fid) || 4860)

  // 父组件每 5s 轮询会重渲染并传新 taskCfg；把 prop 同步到本地 state，
  // 避免「我改的值不显示」或「输入后又被服务端旧值覆盖」。
  useEffect(() => {
    if (Array.isArray(taskCfg.accountIds)) {
      setSelectedIds(taskCfg.accountIds)
    }
    if (typeof taskCfg.postsPerAccount === 'number') {
      setPostsPerAccount(taskCfg.postsPerAccount)
    }
    if (typeof taskCfg.fid === 'number' && taskCfg.fid > 0) {
      setFid(taskCfg.fid)
    }
  }, [taskCfg])

  const toggleAccount = (id) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      onSave({ accountIds: next })
      return next
    })
  }

  const setPosts = (n) => {
    const v = Math.max(1, Math.min(5, Math.floor(Number(n) || 1)))
    setPostsPerAccount(v)
    onSave({ postsPerAccount: v })
  }

  const setFidVal = (n) => {
    // 不再用 || 4860 兜底——空值应该报 invalid，不静默回滚
    const num = Number(n)
    if (!Number.isFinite(num) || num <= 0) return
    const v = Math.floor(num)
    setFid(v)
    onSave({ fid: v })
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 12px',
        background: 'var(--bg-2)',
        borderRadius: 'var(--r-sm)',
        fontSize: 'var(--fs-13)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap'
        }}
      >
        <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>账号</span>
        {accounts.length === 0 ? (
          <span style={{ color: 'var(--text-3)' }}>（先去「账号」tab 添加）</span>
        ) : (
          accounts.map((a) => (
            <label
              key={a.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                color: selectedIds.includes(a.id) ? 'var(--text)' : 'var(--text-3)'
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(a.id)}
                onChange={() => toggleAccount(a.id)}
              />
              <span
                style={{
                  fontWeight: a.id === primaryId ? 600 : 400,
                  color: a.primary ? 'var(--accent)' : 'var(--text-2)'
                }}
              >
                {a.name || `账号 ${a.id}`}
                {a.primary && (
                  <span style={{ fontSize: 11, marginLeft: 4 }}>⭐</span>
                )}
              </span>
            </label>
          ))
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 10,
          flexWrap: 'wrap'
        }}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>每个号每天</span>
          <input
            className="input"
            type="number"
            min={1}
            max={5}
            step={1}
            value={postsPerAccount}
            onChange={(e) => setPosts(e.target.value)}
            style={{ width: 70 }}
          />
          <span style={{ color: 'var(--text-2)' }}>帖</span>
        </label>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
          计划共 {selectedIds.length * postsPerAccount} 帖/天
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 10
        }}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>板块 fid</span>
          <input
            className="input"
            type="number"
            min={1}
            step={1}
            value={fid}
            onChange={(e) => setFidVal(e.target.value)}
            style={{ width: 90 }}
          />
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
            4860=NBA · 6=步行街 · 其他自己查
          </span>
        </label>
      </div>
    </div>
  )
}

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
        💡 提示：AI 同时驱动 3 个任务：<br />
        · <strong>「号与号互相回复」</strong>：每个号 8 条评论（20 字以内，口语化）<br />
        · <strong>「每日自动发帖」</strong>：每个主账号每天发 1 条 AI Agent digest 帖（标题 18-32 字、正文 3 段式）<br />
        · 「测试生成」按钮只验证 provider，不发帖。虎扑风控可能拒掉部分接口（频率限制），任务日志会显示每条的真实结果。
      </div>
    </div>
  )
}
