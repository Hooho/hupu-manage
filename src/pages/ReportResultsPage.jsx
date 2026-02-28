import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'

function ReportResultsPage() {
  const [results, setResults] = useState([])
  const [page, setPage] = useState(1)
  const [pageInfo, setPageInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [todayStats, setTodayStats] = useState(null)
  const [yesterdayStats, setYesterdayStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    loadResults(1)
    loadSavedStats()
  }, [])

  const loadSavedStats = async () => {
    try {
      const res = await axios.get('/api/stats')
      if (res.data && res.data.today) {
        setTodayStats(res.data.today)
        setYesterdayStats(res.data.yesterday)
        setLastUpdate(res.data.lastUpdate)
      }
    } catch (error) {
      console.error('加载统计数据失败:', error)
    }
  }

  const loadResults = async (pageNum) => {
    setLoading(true)
    try {
      const res = await axios.post('/api/report-results', { page: pageNum })
      setResults(res.data.results)
      setPageInfo(res.data.page)
      setPage(pageNum)
    } catch (error) {
      toast.error('加载举报结果失败: ' + error.message)
    }
    setLoading(false)
  }

  const loadStats = async () => {
    setStatsLoading(true)
    try {
      const res = await axios.post('/api/fetch-report-stats')
      if (res.data.success) {
        setTodayStats(res.data.today)
        setYesterdayStats(res.data.yesterday)
        setLastUpdate(new Date().toISOString())
        toast.success('统计完成！')
      }
    } catch (error) {
      toast.error('统计失败: ' + error.message)
    }
    setStatsLoading(false)
  }

  const formatDateTime = (isoString) => {
    if (!isoString) return ''
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN')
  }

  const formatTime = (timestamp) => {
    const date = new Date(timestamp * 1000)
    return date.toLocaleString('zh-CN')
  }

  return (
    <div>
      {/* 统计卡片 */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <h2>举报统计</h2>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '15px', marginBottom: '15px' }}>
          <button
            className="btn btn-primary"
            onClick={loadStats}
            disabled={statsLoading}
          >
            {statsLoading ? '统计中...' : '开始统计'}
          </button>
          {lastUpdate && (
            <span style={{ color: '#666', fontSize: '14px' }}>
              最后更新: {formatDateTime(lastUpdate)}
            </span>
          )}
        </div>

        {statsLoading && (
          <div style={{
            padding: '15px',
            background: '#f8f9fa',
            borderRadius: '4px',
            textAlign: 'center'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #c60100',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 10px'
            }}></div>
            <div style={{ color: '#666', fontSize: '14px' }}>
              正在获取举报结果，请稍候...
            </div>
          </div>
        )}

        {!statsLoading && (todayStats || yesterdayStats) && (
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {/* 今日统计 */}
            {todayStats && (
              <div style={{
                flex: '1',
                minWidth: '300px',
                padding: '20px',
                background: '#f8f9fa',
                borderRadius: '8px',
                border: '2px solid #c60100'
              }}>
                <h3 style={{ marginBottom: '15px', color: '#c60100' }}>今日</h3>
                <div style={{ fontSize: '16px', lineHeight: '2' }}>
                  <div>
                    <span style={{ color: '#666' }}>举报 </span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
                      {todayStats.totalCount}
                    </span>
                    <span style={{ color: '#666' }}> 条</span>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>成功 </span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>
                      {todayStats.successCount}
                    </span>
                    <span style={{ color: '#666' }}> 条</span>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>失败 </span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc3545' }}>
                      {todayStats.failCount}
                    </span>
                    <span style={{ color: '#666' }}> 条</span>
                  </div>
                </div>
              </div>
            )}

            {/* 昨日统计 */}
            {yesterdayStats && (
              <div style={{
                flex: '1',
                minWidth: '300px',
                padding: '20px',
                background: '#f8f9fa',
                borderRadius: '8px',
                border: '2px solid #ddd'
              }}>
                <h3 style={{ marginBottom: '15px', color: '#666' }}>昨日</h3>
                <div style={{ fontSize: '16px', lineHeight: '2' }}>
                  <div>
                    <span style={{ color: '#666' }}>举报 </span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
                      {yesterdayStats.totalCount}
                    </span>
                    <span style={{ color: '#666' }}> 条</span>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>成功 </span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>
                      {yesterdayStats.successCount}
                    </span>
                    <span style={{ color: '#666' }}> 条</span>
                  </div>
                  <div>
                    <span style={{ color: '#666' }}>失败 </span>
                    <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc3545' }}>
                      {yesterdayStats.failCount}
                    </span>
                    <span style={{ color: '#666' }}> 条</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!statsLoading && !todayStats && !yesterdayStats && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
            点击"开始统计"按钮获取举报统计数据
          </div>
        )}
      </div>

      {/* 举报结果详情 */}
      <div className="card">
        <h2>举报结果详情</h2>
        <button
          className="btn btn-primary"
          onClick={() => loadResults(1)}
          disabled={loading}
          style={{ marginTop: '15px', marginBottom: '15px' }}
        >
          {loading ? '加载中...' : '刷新'}
        </button>

        <div style={{ position: 'relative', minHeight: '400px' }}>
          {!loading && results.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '120px' }}>状态</th>
                  <th style={{ width: '150px' }}>用户名</th>
                  <th>评论内容</th>
                  <th style={{ width: '180px' }}>时间</th>
                </tr>
              </thead>
              <tbody>
                {results.map(item => (
                  <tr key={item.pmid}>
                    <td>
                      {item.isSuccess ? (
                        <span style={{ color: '#28a745', fontWeight: 'bold' }}>✓ 举报成功</span>
                      ) : (
                        <span style={{ color: '#666' }}>已受理</span>
                      )}
                    </td>
                    <td>{item.nickName}</td>
                    <td style={{ maxWidth: '600px', wordBreak: 'break-word' }}>
                      {item.content}
                    </td>
                    <td style={{ fontSize: '13px', color: '#666' }}>
                      {formatTime(item.createTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
              暂无举报结果
            </div>
          )}

          {loading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(255, 255, 255, 0.9)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '400px',
              zIndex: 10
            }}>
              <div style={{
                width: '50px',
                height: '50px',
                border: '4px solid #f3f3f3',
                borderTop: '4px solid #c60100',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
              <div style={{ marginTop: '20px', color: '#666', fontSize: '14px' }}>
                加载中...
              </div>
            </div>
          )}
        </div>

        {/* 翻页按钮 */}
        {pageInfo && (
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px' }}>
            <button
              className="btn btn-primary"
              onClick={() => loadResults(page - 1)}
              disabled={page <= 1 || loading}
            >
              上一页
            </button>
            <span style={{ fontSize: '14px', color: '#666' }}>
              第 {pageInfo.pageNum} 页 / 共 {pageInfo.totalPage} 页 · 共 {pageInfo.total} 条
            </span>
            <button
              className="btn btn-primary"
              onClick={() => loadResults(page + 1)}
              disabled={pageInfo.isEnd === 1 || loading}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ReportResultsPage
