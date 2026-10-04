import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import { RecordSkeleton } from '../components/Skeleton'

function StatCard({ label, data }) {
  if (!data) return null
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-row">
        <div className="stat-item">
          <span className="v">{data.totalCount}</span>
          <span className="k">举报</span>
        </div>
        <div className="stat-item">
          <span className="v success">{data.successCount}</span>
          <span className="k">成功</span>
        </div>
        <div className="stat-item">
          <span className="v danger">{data.failCount}</span>
          <span className="k">失败</span>
        </div>
      </div>
    </div>
  )
}

function ReportResultsPage() {
  const [results, setResults] = useState([])
  const [pageInfo, setPageInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)
  const [counting, setCounting] = useState(false)

  useEffect(() => {
    loadResults(1)
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const res = await axios.get('/api/stats')
      if (res.data?.today) setStats(res.data)
    } catch (error) {
      console.error('加载统计失败:', error)
    }
  }

  const loadResults = async (page) => {
    setLoading(true)
    try {
      const res = await axios.post('/api/report-results', { page })
      setResults(res.data.results)
      setPageInfo(res.data.page)
    } catch (error) {
      toast.error('加载失败: ' + error.message)
    }
    setLoading(false)
  }

  const refreshStats = async () => {
    setCounting(true)
    try {
      const res = await axios.post('/api/fetch-report-stats')
      if (res.data.success) {
        setStats({
          today: res.data.today,
          yesterday: res.data.yesterday,
          lastUpdate: new Date().toISOString()
        })
        toast.success('统计完成')
      }
    } catch (error) {
      toast.error('统计失败: ' + error.message)
    }
    setCounting(false)
  }

  const page = pageInfo?.pageNum || 1
  const totalPage = pageInfo?.totalPage || 1
  const lastUpdate = stats?.lastUpdate ? new Date(stats.lastUpdate).toLocaleString('zh-CN') : null

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">举报记录</h1>
        {lastUpdate && <span className="page-sub">更新于 {lastUpdate}</span>}
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">统计</h2>
          <div className="section-sub" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lastUpdate && <span>最近更新 {lastUpdate}</span>}
            <Button size="sm" onClick={refreshStats} disabled={counting}>
              {counting ? '统计中…' : '重新统计'}
            </Button>
          </div>
        </div>

        {stats ? (
          <div className="stat-grid">
            <StatCard label="今日" data={stats.today} />
            <StatCard label="昨日" data={stats.yesterday} />
          </div>
        ) : (
          <EmptyState title="还没有统计数据" hint="点击「重新统计」拉取" />
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">记录</h2>
          <span className="section-sub">第 {page} / {totalPage} 页</span>
        </div>

        {loading && Array.from({ length: 6 }, (_, i) => <RecordSkeleton key={i} />)}

        {!loading && results.length === 0 && (
          <EmptyState title="暂无举报记录" hint="还没有数据" />
        )}

        {!loading &&
          results.map((item) => (
            <div key={item.pmid} className="reply">
              <div className="reply-body">
                <div className="reply-content">{item.fullContent}</div>
                <div className="reply-meta">
                  <span className={`badge ${item.isSuccess ? 'success' : 'default'}`}>
                    {item.isSuccess ? '举报成功' : '已受理'}
                  </span>
                  <span className="sep">·</span>
                  <span>{item.nickName}</span>
                  <span className="sep">·</span>
                  <span>{new Date(item.createTime * 1000).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            </div>
          ))}

        <div className="pager">
          <Button onClick={() => loadResults(page - 1)} disabled={loading || page <= 1}>
            ‹ 上一页
          </Button>
          <Button onClick={() => loadResults(page + 1)} disabled={loading || page >= totalPage}>
            下一页 ›
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ReportResultsPage
