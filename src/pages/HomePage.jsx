import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import AccountSelect from '../components/AccountSelect'
import Checkbox from '../components/Checkbox'
import Button from '../components/Button'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'
import { ReplySkeleton } from '../components/Skeleton'

function HomePage() {
  const [config, setConfig] = useState({ euids: [], interval: 3000 })
  const [users, setUsers] = useState([])
  const [activeEuid, setActiveEuid] = useState('')
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [progress, setProgress] = useState(null)
  const [done, setDone] = useState(new Set())
  const [failed, setFailed] = useState(new Set())

  useEffect(() => {
    loadConfig()
    const saved = localStorage.getItem('viewedItems')
    if (saved) setDone(new Set(JSON.parse(saved)))
  }, [])

  useEffect(() => {
    if (activeEuid) {
      localStorage.setItem('lastActiveEuid', activeEuid)
      setSelected(new Set())
      loadReplies(activeEuid, 1)
    }
  }, [activeEuid])

  const loadConfig = async () => {
    try {
      const [c, u] = await Promise.all([axios.get('/api/config'), axios.get('/api/users')])
      setConfig({ interval: 3000, ...c.data })
      setUsers(u.data)

      const last = localStorage.getItem('lastActiveEuid')
      const euids = c.data.euids || []
      setActiveEuid(euids.includes(last) ? last : euids[0] || '')
    } catch (error) {
      toast.error('加载配置失败: ' + error.message)
    }
  }

  const loadReplies = async (euid, page) => {
    setLoading(true)
    try {
      const res = await axios.get(`/api/replies/${euid}?page=${page}`)
      setUserData(res.data)
      setSelected(new Set())
      if (page !== 1) {
        await axios.post('/api/save-progress', { euid, page, maxTime: res.data.maxTime })
      }
      return res.data
    } catch (error) {
      toast.error('加载失败: ' + error.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  const markDone = (pid) => {
    setDone((prev) => {
      const next = new Set(prev).add(pid)
      localStorage.setItem('viewedItems', JSON.stringify([...next]))
      return next
    })
  }

  const toggle = (pid) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(pid) ? next.delete(pid) : next.add(pid)
      return next
    })
  }

  const pending = userData ? userData.replies.filter((r) => !done.has(r.pid)) : []
  const pendingCount = pending.length
  const allSelected = pending.length > 0 && pending.every((r) => selected.has(r.pid))
  const partialSelected =
    pending.length > 0 &&
    pending.some((r) => selected.has(r.pid)) &&
    !allSelected

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(pending.map((r) => r.pid)))
  }

  const report = async (item) => {
    try {
      const res = await axios.post('/api/report', {
        tid: item.tid,
        pid: item.pid,
        topicId: item.topicId
      })
      await axios.post('/api/save-operation', {
        id: item.pid,
        content: item.content,
        userid: item.puid,
        username: item.username,
        submitted: res.data.status === 'success'
      })
      setFailed((prev) => {
        const next = new Set(prev)
        next.delete(item.pid)
        return next
      })
      markDone(item.pid)
    } catch (error) {
      await axios.post('/api/save-operation', {
        id: item.pid,
        content: item.content,
        userid: item.puid,
        username: item.username,
        submitted: false,
        error: error.message
      })
      setFailed((prev) => new Set(prev).add(item.pid))
      throw error
    }
  }

  const reportOne = async (item) => {
    try {
      await report(item)
      toast.success('已举报')
    } catch (error) {
      toast.error('举报失败: ' + error.message)
    }
  }

  const reportSelected = async () => {
    if (!userData) return
    const items = userData.replies.filter((r) => selected.has(r.pid))
    if (items.length === 0) return
    if (!window.confirm(`举报选中的 ${items.length} 条？`)) return

    let ok = 0
    for (let i = 0; i < items.length; i++) {
      setProgress({ current: i + 1, total: items.length })
      try {
        await report(items[i])
        ok++
      } catch (error) {
        // 失败已在 report 内记录，继续处理剩余项
      }
      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, config.interval || 3000))
      }
    }

    setProgress(null)
    setSelected(new Set())
    const fail = items.length - ok
    fail === 0 ? toast.success(`已举报 ${ok} 条`) : toast.error(`成功 ${ok} 条，失败 ${fail} 条`)
  }

  // 账号选择器 items
  const accountItems = config.euids.map((euid) => {
    const u = users.find((u) => u.euid === euid)
    return {
      value: euid,
      label: u?.username || `用户 ${euid}`,
      avatar: (u?.username || '用').slice(0, 1)
    }
  })

  if (config.euids.length === 0) {
    return <EmptyState title="还没有账号" hint="先去设置里添加" />
  }

  const page = userData?.page || 1
  const busy = loading || progress !== null

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">回帖列表</h1>
        <span className="page-sub">
          监控 {config.euids.length} · 待处理 {pendingCount} 条
        </span>
      </div>

      {/* 工具栏 1：账号 + 分页 + 刷新 */}
      <div className="toolbar">
        <AccountSelect
          items={accountItems}
          value={activeEuid}
          onValueChange={setActiveEuid}
          disabled={busy}
        />
        <span className="muted">第 {page} 页</span>
        <Button className="ml-auto" onClick={() => loadReplies(activeEuid, page)} disabled={busy}>
          刷新
        </Button>
      </div>

      {/* 工具栏 2：全选 + 已选 + 进度 + 批量举报 */}
      <div className="toolbar">
        <Checkbox
          checked={allSelected ? true : partialSelected ? 'indeterminate' : false}
          onCheckedChange={toggleAll}
          disabled={busy || pendingCount === 0}
        >
          全选（{pendingCount}）
        </Checkbox>
        {selected.size > 0 && <span className="badge accent">已选 {selected.size}</span>}
        {progress && (
          <ProgressBar
            value={progress.current}
            max={progress.total}
            label={`举报中 ${progress.current} / ${progress.total}`}
          />
        )}
        <Button
          variant="danger"
          className="ml-auto"
          onClick={reportSelected}
          disabled={busy || selected.size === 0}
        >
          举报选中
        </Button>
      </div>

      {loading && Array.from({ length: 6 }, (_, i) => <ReplySkeleton key={i} />)}

      {!loading && userData?.replies.length === 0 && (
        <EmptyState title="暂无回帖" hint="该账号当前没有需要处理的回帖" />
      )}

      {!loading &&
        userData?.replies.map((item) => {
          const isDone = done.has(item.pid)
          const isFail = failed.has(item.pid)
          return (
            <div key={item.pid} className={`reply${isDone ? ' done' : ''}`}>
              <Checkbox
                checked={selected.has(item.pid)}
                onCheckedChange={() => toggle(item.pid)}
                disabled={isDone || busy}
              />
              <div className="reply-body">
                <div className="reply-content">{item.content}</div>
                <div className="reply-meta">
                  <span>{item.formatTime}</span>
                  {isDone && (
                    <>
                      <span className="sep">·</span>
                      <span className="badge success">已举报</span>
                    </>
                  )}
                  {isFail && !isDone && (
                    <>
                      <span className="sep">·</span>
                      <span className="badge danger">上次失败</span>
                    </>
                  )}
                </div>
              </div>
              <div className="reply-actions">
                {isDone ? (
                  <span className="muted" style={{ padding: '6px 4px' }}>—</span>
                ) : (
                  <Button
                    size="sm"
                    variant={isFail ? 'default' : 'danger'}
                    onClick={() => reportOne(item)}
                    disabled={busy}
                  >
                    {isFail ? '重试' : '举报'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}

      <div className="pager">
        <Button onClick={() => loadReplies(activeEuid, page - 1)} disabled={busy || page <= 1}>
          ‹ 上一页
        </Button>
        <Button
          onClick={() => loadReplies(activeEuid, page + 1)}
          disabled={busy || !userData?.hasNext}
        >
          下一页 ›
        </Button>
      </div>
    </div>
  )
}

export default HomePage
