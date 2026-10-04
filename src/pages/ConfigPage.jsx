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
  const [editingAccount, setEditingAccount] = useState(null) // { id, name, euid }
  const startEdit = (a) => setEditingAccount({ id: a.id, name: a.name || '', euid: a.euid || '' })

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
    try {
      await axios.patch(`/api/accounts/${editingAccount.id}`, {
        name: editingAccount.name,
        euid: editingAccount.euid
      })
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
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      value={editingAccount.name}
                      onChange={(e) =>
                        setEditingAccount({ ...editingAccount, name: e.target.value })
                      }
                      placeholder="昵称"
                      style={{ width: 160 }}
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
function ScheduleTab() {
  const [board, setBoard] = useState([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState({}) // taskId -> bool
  const [feedback, setFeedback] = useState(null) // {type, msg}

  const load = async () => {
    try {
      const r = await axios.get('/api/scheduler/board')
      setBoard(r.data.tasks || [])
    } catch (e) {
      toast.error('加载失败: ' + e.message)
    }
  }

  useEffect(() => {
    load()
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

  const runNow = async (id, force) => {
    setRunning((r) => ({ ...r, [id]: true }))
    setFeedback(null)
    try {
      const res = await axios.post(`/api/scheduler/run/${id}`, { force })
      const d = res.data
      if (d.skipped) {
        if (d.reason === '今日已跑过') {
          setFeedback({
            type: 'warn',
            msg: `「${id}」今天已经跑过了（${d.todayRun?.at}）。如需重跑请勾选"强制重跑"。`
          })
        } else {
          setFeedback({ type: 'info', msg: `${d.reason}` })
        }
      } else if (d.success) {
        setFeedback({
          type: 'success',
          msg: `「${id}」跑完了。结果：${JSON.stringify(d.result || {}).slice(0, 200)}`
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

      {board.map((t) => (
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
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>
                {t.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                {t.description}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
                下次执行: {t.nextRun ? new Date(t.nextRun).toLocaleString('zh-CN') : '—'}
              </div>
              {t.ranToday && t.todayRun && (
                <div
                  style={{
                    fontSize: 12,
                    color: t.todayRun.success ? 'var(--success)' : 'var(--danger)',
                    marginTop: 4
                  }}
                >
                  今日 {t.todayRun.at} 已跑完 · {t.todayRun.success ? '✓ 成功' : '✗ 失败'}
                </div>
              )}
              {t.running && (
                <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>
                  ⏳ 正在执行...
                </div>
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
                onClick={() => runNow(t.id, false)}
                disabled={t.running || running[t.id]}
              >
                {t.running || running[t.id] ? '跑着...' : '立即跑'}
              </Button>
              {t.ranToday && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm('确定要重新跑一次？（会再调一次虎扑接口）')) {
                      runNow(t.id, true)
                    }
                  }}
                  disabled={t.running || running[t.id]}
                >
                  强制重跑
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
