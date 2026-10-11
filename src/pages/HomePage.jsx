import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import AccountSelect from '../components/AccountSelect'
import Checkbox from '../components/Checkbox'
import Button from '../components/Button'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'
import { ReplySkeleton } from '../components/Skeleton'

// 用户 puid：优先读 users[i].puid，没填回退到 euid（多数情况下两者一致）
function resolvePuid(users, euid) {
  const u = users.find((u) => u.euid === euid)
  return u?.puid || euid
}

function HomePage() {
  const [config, setConfig] = useState({ euids: [], interval: 3000 })
  const [users, setUsers] = useState([])
  const [activeEuid, setActiveEuid] = useState('')
  const [activeTab, setActiveTab] = useState('replies') // 'replies' | 'scores'

  // 回帖 tab state
  // userData 只放 meta（page / totalPages / hasNext / source ...），
  // items 拆出来用顶层 `replies` 累积渲染（滚到底自动 append）
  const [userData, setUserData] = useState(null)
  const [replies, setReplies] = useState([]) // 累积数组
  const [loading, setLoading] = useState(false)        // 首屏加载
  const [loadingMore, setLoadingMore] = useState(false) // 追加下一页
  const [hasMore, setHasMore] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [progress, setProgress] = useState(null)
  const [failed, setFailed] = useState(new Set())
  const loadMoreRef = useRef(null) // IntersectionObserver 目标

  // 评分 tab state
  const [scores, setScores] = useState(null) // { items, source, hasMore, queryParam, totalCount }
  const [scoresLoading, setScoresLoading] = useState(false)
  const [scoresSelected, setScoresSelected] = useState(new Set())
  const [scoresProgress, setScoresProgress] = useState(null)
  const [scoresFailed, setScoresFailed] = useState(new Set())
  const [scoresLoadedEuid, setScoresLoadedEuid] = useState('') // 上次拉取的 euid（避免误重拉）
  const [scoresPageSize, setScoresPageSize] = useState(30) // 单页条数
  const [scoresCursor, setScoresCursor] = useState('0') // 下一页 cursor（首屏 0）
  const [scoresStack, setScoresStack] = useState([]) // 历史 cursor 栈，用于「上一页」
  const [hasReportSession, setHasReportSession] = useState(false) // 是否已配 report session

  // 全量抓取进度：{[euid]: { status: 'idle'|'running'|'completed'|'failed', page, fetchedCount, ... }}
  // 任意账号 status=running 时由 effect 启动 setInterval 轮询
  const [fetchProgress, setFetchProgress] = useState({})
  const fetchProgressTimerRef = useRef(null)

  useEffect(() => {
    loadConfig()
    loadSessionKeys()
    // 清掉历史 viewedItems（旧逻辑遗物：report 成功后 markDone 进去的）
    // 现在「是否已提交」完全靠 item.submitted（来自 operations.json）展示
    localStorage.removeItem('viewedItems')
  }, [])

  // 进入页面后拉一次所有账号的 fetch-progress，决定哪些账号有 cache 可秒开
  useEffect(() => {
    if (config.euids.length === 0) return
    refreshAllFetchProgress()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.euids.length > 0])

  useEffect(() => {
    if (activeEuid) {
      localStorage.setItem('lastActiveEuid', activeEuid)
      // 切换账号时两个 tab 各自重新拉数据（跟回帖 tab 切账号行为一致）
      if (activeTab === 'replies') {
        setSelected(new Set())
        loadReplies(activeEuid, 'reset')
      } else if (activeTab === 'scores') {
        setScoresStack([]) // 切账号清空翻页栈
        loadScores(activeEuid)
      }
    }
  }, [activeEuid])

  // tab 切换时按需加载数据
  useEffect(() => {
    if (!activeEuid) return
    if (activeTab === 'scores' && scoresLoadedEuid !== activeEuid) {
      setScoresStack([])
      loadScores(activeEuid)
    }
  }, [activeTab])

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

  // 检查主账号是否已配 report session（动态决定是否显示提示卡）
  const loadSessionKeys = async () => {
    try {
      const res = await axios.get('/api/app-sessions')
      const s = res.data || {}
      const r = s.report || {}
      setHasReportSession(Boolean(r.hupuNewSign && r.hupuEncryptSalt))
    } catch {
      setHasReportSession(false)
    }
  }

  // loadReplies(euid, mode)
//   mode 默认 'reset'：重新加载 page=1 并替换累积数组
//   mode = 'append'：拉下一页 append 到累积数组（滚到底触发）
//   mode = 'refresh'：同 reset，但保留 selected（用户主动点刷新）
//
// source 自动判断策略：
//   1. fetchProgress[euid].status === 'completed'（或 fetchedCount > 0）→ 用 cache
//   2. 否则用 live（兜底，保证没 cache 的账号也能用）
//   3. cache 接口返回 404 NO_CACHE 时自动回退 live（防止 fetch-progress 文件被误删）
const loadReplies = async (euid, mode = 'reset') => {
    const isAppend = mode === 'append'
    const isRefresh = mode === 'refresh'

    if (isAppend) setLoadingMore(true)
    else setLoading(true)

    try {
      // 决定 source：从 fetchProgress 判断 cache 是否存在
      const fp = fetchProgress[euid]
      const cacheReady = fp && (fp.status === 'completed' || (fp.status !== 'idle' && fp.fetchedCount > 0))
      const useSource = cacheReady ? 'cache' : 'live'

      const currentPage = isAppend ? (userData?.page || 1) + 1 : 1
      const res = await axios.get(`/api/replies/${euid}`, {
        params: { source: useSource, page: currentPage }
      })

      const newItems = res.data.replies || []
      if (isAppend) {
        setReplies((prev) => [...prev, ...newItems])
      } else {
        setReplies(newItems)
        if (!isRefresh) setSelected(new Set())
      }
      // 累积模式下 userData 不再带 replies，只存 meta（接口返的 replies 我们丢掉）
      setUserData({ ...res.data, replies: undefined })
      setHasMore(!!res.data.hasNext)

      // live 模式需要 save cursor
      if (useSource === 'live') {
        await axios.post('/api/save-progress', {
          euid,
          page: currentPage,
          maxTime: res.data.maxTime
        })
      }
      return res.data
    } catch (error) {
      // cache 接口报 NO_CACHE → 自动回退 live（不影响用户）
      if (
        error.response?.status === 404 &&
        error.response?.data?.code === 'NO_CACHE'
      ) {
        try {
          const currentPage = isAppend ? (userData?.page || 1) + 1 : 1
          const res = await axios.get(`/api/replies/${euid}`, {
            params: { source: 'live', page: currentPage }
          })
          const newItems = res.data.replies || []
          if (isAppend) {
            setReplies((prev) => [...prev, ...newItems])
          } else {
            setReplies(newItems)
            if (!isRefresh) setSelected(new Set())
          }
          setUserData({ ...res.data, replies: undefined })
          setHasMore(!!res.data.hasNext)
          await axios.post('/api/save-progress', {
            euid,
            page: currentPage,
            maxTime: res.data.maxTime
          })
          return res.data
        } catch (e2) {
          toast.error('加载失败: ' + e2.message)
          return null
        }
      }
      toast.error('加载失败: ' + error.message)
      return null
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // 拉所有监控账号的 fetch-progress（被定时轮询 effect 调用）
  const refreshAllFetchProgress = useCallback(async () => {
    if (config.euids.length === 0) return
    try {
      const results = await Promise.all(
        config.euids.map((euid) =>
          axios
            .get(`/api/replies/${euid}/fetch-progress`)
            .then((r) => [euid, r.data])
            .catch(() => [euid, { status: 'idle' }])
        )
      )
      setFetchProgress(Object.fromEntries(results))
    } catch {
      // 静默失败，等下一轮
    }
  }, [config.euids])

  // 触发单账号全量抓取
  const triggerFetchAll = async (euid) => {
    try {
      await axios.post(`/api/replies/${euid}/fetch-all`)
      toast.success('已开始全量抓取，进度自动刷新')
      refreshAllFetchProgress()
    } catch (e) {
      if (e.response?.status === 409) {
        toast('该账号已在抓取中')
      } else {
        toast.error('启动失败: ' + (e.response?.data?.error || e.message))
      }
    }
  }

  // 滚到底自动加载（IntersectionObserver）
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || loadingMore || loading) return
    const el = loadMoreRef.current
    const obs = new IntersectionObserver(
      (entries) => {
        // 出现在视口里 + 还有更多 + 不在加载中 → 加载下一页
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loading) {
          loadReplies(activeEuid, 'append')
        }
      },
      // 提前 200px 触发，避免用户看到「加载中…」的空窗
      { rootMargin: '200px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
    // 依赖 hasMore/loadingMore/loading/activeEuid 重新绑定监听器
  }, [hasMore, loadingMore, loading, activeEuid, userData])

  // 任一账号 fetch-progress 为 running 时启动 2s 轮询
  useEffect(() => {
    const hasRunning = Object.values(fetchProgress).some((p) => p?.status === 'running')
    if (hasRunning) {
      // 立即拉一次 + 每 2s 拉一次
      refreshAllFetchProgress()
      fetchProgressTimerRef.current = setInterval(refreshAllFetchProgress, 2000)
    }
    return () => {
      if (fetchProgressTimerRef.current) {
        clearInterval(fetchProgressTimerRef.current)
        fetchProgressTimerRef.current = null
      }
    }
  }, [JSON.stringify(Object.entries(fetchProgress).map(([k, v]) => `${k}:${v?.status}`)), refreshAllFetchProgress])

  // 翻页加载评分。cursor 不传 = 第一页；传值 = 翻页
  const loadScores = async (euid, cursor = '0', { pushPrev = false } = {}) => {
    const puid = resolvePuid(users, euid)
    setScoresLoading(true)
    try {
      const res = await axios.post('/api/scrape/user-comment-app', {
        userId: puid,
        pageSize: scoresPageSize,
        queryParam: cursor
      })
      setScores({
        items: res.data.items || [],
        source: res.data.source || '',
        hasMore: !!res.data.hasMore,
        queryParam: res.data.queryParam ?? null,
        totalCount: Number(res.data.totalCount || 0)
      })
      setScoresSelected(new Set())
      setScoresLoadedEuid(euid)
      setScoresCursor(res.data.queryParam ?? null)
      // pushPrev=true 时把当前 cursor 推入栈，便于「上一页」回退
      if (pushPrev) setScoresStack((prev) => [...prev, cursor])
    } catch (error) {
      toast.error('拉取评分失败: ' + (error.response?.data?.error || error.message))
      setScores({ items: [], source: '', hasMore: false, queryParam: null, totalCount: 0 })
      setScoresCursor(null)
    } finally {
      setScoresLoading(false)
    }
  }

  // 上一页：从 stack 弹出一个 cursor 加载（不更新 stack）
  const goPrevScoresPage = () => {
    if (scoresStack.length === 0) return
    const prev = [...scoresStack]
    const target = prev.pop()
    setScoresStack(prev)
    loadScores(activeEuid, target)
  }

  // 下一页：用当前 scoresCursor 翻一页 + 入栈
  const goNextScoresPage = () => {
    if (!scores?.hasMore || !scoresCursor) return
    loadScores(activeEuid, scoresCursor, { pushPrev: true })
  }

  const toggle = (pid) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(pid) ? next.delete(pid) : next.add(pid)
      return next
    })
  }

  const toggleScore = (bizId) => {
    setScoresSelected((prev) => {
      const next = new Set(prev)
      next.has(bizId) ? next.delete(bizId) : next.add(bizId)
      return next
    })
  }

  const pending = replies
  const pendingCount = pending.length
  const allSelected = pending.length > 0 && pending.every((r) => selected.has(r.pid))
  const partialSelected =
    pending.length > 0 &&
    pending.some((r) => selected.has(r.pid)) &&
    !allSelected

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(pending.map((r) => r.pid)))
  }

  // 评分 tab：列表里只剩有评论的项（接口返回里有"只打分没评论"的，过滤掉）
  const scoreItems = (scores?.items || []).filter((s) => s.hasComment)
  const allScoresSelected =
    scoreItems.length > 0 && scoreItems.every((s) => scoresSelected.has(s.bizId))
  const partialScoresSelected =
    scoreItems.length > 0 &&
    scoreItems.some((s) => scoresSelected.has(s.bizId)) &&
    !allScoresSelected
  const toggleAllScores = () => {
    setScoresSelected(
      allScoresSelected ? new Set() : new Set(scoreItems.map((s) => s.bizId))
    )
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
      // 不调 markDone：提交成功只代表「进了审核队列」，不代表 reply 真的被删。
      // reply 还出现在列表里就该让用户能再举报，等审核通过后 Hupu 自己就不返回这条了。
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
    const items = replies.filter((r) => selected.has(r.pid))
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

  // 单条评分举报（App 接口）
  const reportScoreOne = async (item) => {
    const bizId = `${item.subjectId}:${item.commentId}`
    try {
      const res = await axios.post('/api/action/app-report-comment', {
        bizId,
        reportReason: 4
      })
      await axios.post('/api/save-operation', {
        id: bizId,
        content: item.comment || '(无评论)',
        userid: resolvePuid(users, activeEuid),
        username: users.find((u) => u.euid === activeEuid)?.username || activeEuid,
        submitted: res.data.success === true
      })
      setScoresFailed((prev) => {
        const next = new Set(prev)
        next.delete(bizId)
        return next
      })
      toast.success('已举报')
    } catch (error) {
      await axios.post('/api/save-operation', {
        id: bizId,
        content: item.comment || '(无评论)',
        userid: resolvePuid(users, activeEuid),
        username: users.find((u) => u.euid === activeEuid)?.username || activeEuid,
        submitted: false,
        error: error.message
      })
      setScoresFailed((prev) => new Set(prev).add(bizId))
      toast.error('举报失败: ' + error.message)
    }
  }

  const reportScoresSelected = async () => {
    const items = scoreItems.filter((s) => scoresSelected.has(s.bizId))
    if (items.length === 0) return
    if (!window.confirm(`举报选中的 ${items.length} 条评分？`)) return

    let ok = 0
    for (let i = 0; i < items.length; i++) {
      setScoresProgress({ current: i + 1, total: items.length })
      try {
        await reportScoreOne(items[i])
        ok++
      } catch (error) {
        // 失败已在 reportScoreOne 内记录
      }
      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, config.interval || 3000))
      }
    }
    setScoresProgress(null)
    setScoresSelected(new Set())
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
  const scoresBusy = scoresLoading || scoresProgress !== null
  // 当前账号的全量抓取进度（fetchProgress 由 effect 定期拉取）
  const fp = fetchProgress[activeEuid] || { status: 'idle' }
  const fpRunning = fp.status === 'running'
  // 全局：任一账号 running（用于页面顶部展示总进度）
  const anyRunning = Object.values(fetchProgress).some((p) => p?.status === 'running')

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{activeTab === 'replies' ? '回帖列表' : '评分评论'}</h1>
          <span className="page-sub">
            监控 {config.euids.length}
            {activeTab === 'replies'
              ? ` · 待处理 ${pendingCount} 条`
              : scores
                ? ` · 共 ${scores.totalCount || scoreItems.length} 条 · 可举报 ${scoreItems.length}`
                : ''}
            {/* 全局：任一账号正在抓时显示总进度条 */}
            {anyRunning && (
              <span style={{ marginLeft: 8 }}>
                ·{' '}
                {Object.entries(fetchProgress)
                  .filter(([, p]) => p?.status === 'running')
                  .map(([k, p]) => {
                    const u = users.find((u) => u.euid === k)
                    return `${u?.username || k}: ${p.fetchedCount} 条`
                  })
                  .join(' / ')}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* 账号选择器行（两个 tab 都共用） */}
      <div className="toolbar">
        <AccountSelect
          items={accountItems}
          value={activeEuid}
          onValueChange={setActiveEuid}
          disabled={busy || scoresBusy}
        />
        {activeTab === 'scores' ? (
          <>
            <span className="muted">数量</span>
            <select
              className="input"
              value={scoresPageSize}
              onChange={(e) => setScoresPageSize(Number(e.target.value))}
              style={{ width: 80, padding: '4px 8px', height: 28, fontSize: 'var(--fs-12)' }}
            >
              <option value={10}>10</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <Button className="ml-auto" onClick={() => loadScores(activeEuid)} disabled={scoresBusy}>
              {scoresLoading ? '拉取中…' : '刷新'}
            </Button>
          </>
        ) : (
          <>
            {/* 当前页数 + 数据源 badge */}
            <span className="muted">第 {page} 页</span>
            {userData?.source === 'cache' && (
              <span className="badge accent" style={{ marginLeft: 6 }}>缓存</span>
            )}
            {/* 当前账号的抓取状态展示 */}
            {fpRunning ? (
              <span className="muted" style={{ marginLeft: 8 }}>
                抓取中 · 已抓 {fp.fetchedCount} 条 · 第 {fp.page} 页
              </span>
            ) : fp.status === 'completed' ? (
              <span className="muted" style={{ marginLeft: 8 }}>
                ✓ 已抓 {fp.fetchedCount} 条
              </span>
            ) : fp.status === 'failed' ? (
              <span className="badge danger" title={fp.error || ''} style={{ marginLeft: 8 }}>
                抓取失败
              </span>
            ) : null}
            {/* 「全量抓取」按钮：ramping / 已完成 / 失败 / idle 切换不同 label */}
            <Button
              size="sm"
              onClick={() => triggerFetchAll(activeEuid)}
              disabled={fpRunning}
              style={{ marginLeft: 8 }}
            >
              {fpRunning
                ? '抓取中…'
                : fp.status === 'completed'
                ? '↻ 重新抓取'
                : fp.status === 'failed'
                ? '重试'
                : '📥 全量抓取'}
            </Button>
            <Button
              className="ml-auto"
              onClick={() => loadReplies(activeEuid, 'refresh')}
              disabled={busy}
            >
              {loading ? '加载中…' : '刷新'}
            </Button>
          </>
        )}
      </div>

      {/* 账号下面：tab 切换 */}
      <div className="page-tabs" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={`page-tab ${activeTab === 'replies' ? 'active' : ''}`}
          onClick={() => setActiveTab('replies')}
        >
          回帖
        </button>
        <button
          type="button"
          className={`page-tab ${activeTab === 'scores' ? 'active' : ''}`}
          onClick={() => setActiveTab('scores')}
        >
          评分
        </button>
      </div>

      {/* ============================== */}
      {/* 回帖 tab */}
      {/* ============================== */}
      {activeTab === 'replies' && (
        <>
          {/* 工具栏：全选 + 已选 + 进度 + 批量举报 */}
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

          {!loading && replies.length === 0 && (
            <EmptyState
              title="暂无回帖"
              hint={
                fp.status === 'idle'
                  ? '该账号还没有 cache，点上方「📥 全量抓取」一次性拉完所有历史回帖'
                  : '该账号当前没有需要处理的回帖'
              }
            />
          )}

          {!loading &&
            replies.map((item) => {
              const isFail = failed.has(item.pid)
              return (
                <div key={item.pid} className="reply">
                  <Checkbox
                    checked={selected.has(item.pid)}
                    onCheckedChange={() => toggle(item.pid)}
                    disabled={busy}
                  />
                  <div className="reply-body">
                    <div className="reply-content">{item.content}</div>
                    <div className="reply-meta">
                      <span>{item.formatTime}</span>
                      {item.submitted && (
                        <>
                          <span className="sep">·</span>
                          <span className="badge">
                            已经提交过{item.submitCount > 1 ? ` ×${item.submitCount}` : ''}
                          </span>
                        </>
                      )}
                      {isFail && (
                        <>
                          <span className="sep">·</span>
                          <span className="badge danger">上次失败</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="reply-actions">
                    <Button
                      size="sm"
                      variant={isFail ? 'default' : 'danger'}
                      onClick={() => reportOne(item)}
                      disabled={busy}
                    >
                      {isFail ? '重试' : '举报'}
                    </Button>
                  </div>
                </div>
              )
            })}

          {/* 列表底部 sentinel + 手动加载更多按钮
              - 滚到底自动触发（IntersectionObserver）
              - 用户也可以手动点「加载更多」 */}
          {hasMore && !loading && (
            <div ref={loadMoreRef} className="pager">
              {loadingMore ? (
                <span className="muted">加载下一页中…</span>
              ) : (
                <Button
                  size="sm"
                  onClick={() => loadReplies(activeEuid, 'append')}
                  disabled={loadingMore}
                >
                  加载更多
                </Button>
              )}
            </div>
          )}
          {!hasMore && replies.length > 0 && !loading && (
            <div className="pager">
              <span className="muted">已到底 · 共 {replies.length} 条</span>
            </div>
          )}
        </>
      )}

      {/* ============================== */}
      {/* 评分 tab */}
      {/* ============================== */}
      {activeTab === 'scores' && (
        <>
          {/* 顶部提示：仅在未配置 report session 时显示 */}
          {!hasReportSession && (
            <div
              className="card"
              style={{
                padding: '10px 14px',
                background: 'var(--accent-bg)',
                boxShadow: 'inset 0 0 0 1px var(--accent-soft)',
                color: 'var(--accent)',
                fontSize: 'var(--fs-12)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <strong>提示：</strong>
              评分举报调用 App 接口，需要在「账号」Tab 配置主账号的 <code>appSessions.report</code> session。
              抓包一次 bbsreportapi/report 后用「粘贴 capture」按钮填入即可。
            </div>
          )}

          {scoresBusy && !scoresProgress && Array.from({ length: 4 }, (_, i) => <ReplySkeleton key={i} />)}

          {!scoresLoading && scores && scoreItems.length === 0 && (
            <EmptyState title="暂无评分" hint="该账号最近没有评分记录" />
          )}

          {!scoresLoading && scores && scoreItems.length > 0 && (
            <div className="toolbar">
              <Checkbox
                checked={
                  allScoresSelected ? true : partialScoresSelected ? 'indeterminate' : false
                }
                onCheckedChange={toggleAllScores}
                disabled={scoresBusy}
              >
                全选（{scoreItems.length}）
              </Checkbox>
              {scoresSelected.size > 0 && (
                <span className="badge accent">已选 {scoresSelected.size}</span>
              )}
              {scoresProgress && (
                <ProgressBar
                  value={scoresProgress.current}
                  max={scoresProgress.total}
                  label={`举报中 ${scoresProgress.current} / ${scoresProgress.total}`}
                />
              )}
              <Button
                variant="danger"
                className="ml-auto"
                onClick={reportScoresSelected}
                disabled={scoresBusy || scoresSelected.size === 0}
              >
                举报选中
              </Button>
            </div>
          )}

          {!scoresLoading &&
            scores &&
            scoreItems.map((item) => {
              const bizId = `${item.subjectId}:${item.commentId}`
              const isFail = scoresFailed.has(bizId)
              return (
                <div key={bizId} className="reply">
                  <Checkbox
                    checked={scoresSelected.has(bizId)}
                    onCheckedChange={() => toggleScore(bizId)}
                    disabled={scoresBusy}
                  />
                  <div className="reply-body">
                    <div className="reply-content">{item.comment || '(无评论)'}</div>
                    <div className="reply-meta">
                      <span>{item.publishTime || ''}</span>
                      {item.lightCount > 0 && (
                        <>
                          <span className="sep">·</span>
                          <span>👍 {item.lightCount}</span>
                        </>
                      )}
                      {isFail && (
                        <>
                          <span className="sep">·</span>
                          <span className="badge danger">上次失败</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="reply-actions">
                    <Button
                      size="sm"
                      variant={isFail ? 'default' : 'danger'}
                      onClick={() => reportScoreOne(item)}
                      disabled={scoresBusy}
                    >
                      {isFail ? '重试' : '举报'}
                    </Button>
                  </div>
                </div>
              )
            })}

          {/* 翻页（cursor 模式：上一页从 stack 弹出，下一页用当前 cursor） */}
          {!scoresLoading && scores && scoreItems.length > 0 && (
            <div className="pager">
              <Button onClick={goPrevScoresPage} disabled={scoresBusy || scoresStack.length === 0}>
                ‹ 上一页
              </Button>
              <span className="muted">
                第 {scoresStack.length + 1} 页 · 已加载{' '}
                {scoreItems.length + scoresStack.reduce((acc, _, i, arr) => acc + 0, 0)} 条
              </span>
              <Button
                onClick={goNextScoresPage}
                disabled={scoresBusy || !scores.hasMore || !scoresCursor}
              >
                下一页 ›
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default HomePage