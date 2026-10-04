import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import { Download, Trash } from '../components/icons'

const TABS = [
  { key: 'request', label: '请求' },
  { key: 'accounts', label: '监控账号' }
]

function ConfigPage() {
  const [config, setConfig] = useState({ cookie: '', euids: [], interval: 3000 })
  const [users, setUsers] = useState([])
  const [newEuid, setNewEuid] = useState('')
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [tab, setTab] = useState('request')

  useEffect(() => {
    load()
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
      {tab === 'request' && (
        <div className="card">
          <div className="field">
            <label className="field-label" htmlFor="cookie">Cookie</label>
            <textarea
              id="cookie"
              className="textarea"
              value={config.cookie}
              onChange={(e) => setConfig({ ...config, cookie: e.target.value })}
              placeholder="从浏览器开发者工具复制"
            />
            <div className="field-hint">失效后接口会返回空列表，重新复制一次即可</div>
          </div>

          <div className="field">
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

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button variant="primary" onClick={() => save()} disabled={saving}>
              {saving ? '保存中…' : '保存设置'}
            </Button>
          </div>
        </div>
      )}

      {/* 监控账号 tab */}
      {tab === 'accounts' && (
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
