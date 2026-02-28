import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'

function HomePage() {
  const [config, setConfig] = useState({ euids: [] })
  const [users, setUsers] = useState([])
  const [activeEuid, setActiveEuid] = useState(null)
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [processing, setProcessing] = useState(false)
  const [interval, setInterval] = useState(3000)
  const [viewedItems, setViewedItems] = useState(new Set())

  useEffect(() => {
    loadConfig()
    // 加载已浏览的项目
    const viewed = localStorage.getItem('viewedItems')
    if (viewed) {
      setViewedItems(new Set(JSON.parse(viewed)))
    }
  }, [])

  useEffect(() => {
    if (activeEuid) {
      // 切换用户时始终从第一页开始
      loadUserData(activeEuid, 1)
    }
  }, [activeEuid])

  // 保存当前浏览的用户到 localStorage
  useEffect(() => {
    if (activeEuid) {
      localStorage.setItem('lastActiveEuid', activeEuid)
    }
  }, [activeEuid])

  const loadConfig = async () => {
    try {
      const [configRes, usersRes] = await Promise.all([
        axios.get('/api/config'),
        axios.get('/api/users')
      ])
      setConfig(configRes.data)
      setUsers(usersRes.data)

      // 优先恢复上次浏览的用户，否则使用第一个用户
      const lastEuid = localStorage.getItem('lastActiveEuid')
      if (lastEuid && configRes.data.euids.includes(lastEuid)) {
        setActiveEuid(lastEuid)
      } else if (configRes.data.euids && configRes.data.euids.length > 0) {
        setActiveEuid(configRes.data.euids[0])
      }
    } catch (error) {
      console.error('加载配置失败:', error)
    }
  }

  const loadUserData = async (euid, page = null) => {
    setLoading(true)
    try {
      const params = page ? `?page=${page}` : ''
      const res = await axios.get(`/api/replies/${euid}${params}`)
      setUserData(res.data)
    } catch (error) {
      toast.error('加载数据失败: ' + error.message)
    }
    setLoading(false)
  }

  const loadPage = async (page) => {
    if (!activeEuid) return
    await loadUserData(activeEuid, page)

    // 保存浏览进度
    if (userData) {
      await axios.post('/api/save-progress', {
        euid: activeEuid,
        page,
        maxTime: userData.maxTime
      })
    }
  }

  const switchUser = (euid) => {
    setActiveEuid(euid)
    setSelected(new Set())
  }

  const getUserName = (euid) => {
    const user = users.find(u => u.euid === euid)
    return user?.username || `用户 ${euid}`
  }

  const markAsViewed = (pid) => {
    const newViewed = new Set(viewedItems)
    newViewed.add(pid)
    setViewedItems(newViewed)
    localStorage.setItem('viewedItems', JSON.stringify([...newViewed]))
  }

  const toggleSelect = (id) => {
    const newSelected = new Set(selected)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelected(newSelected)
  }

  const toggleSelectAll = () => {
    if (!userData) return
    const allPids = userData.replies.map(r => r.pid)
    if (selected.size === allPids.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allPids))
    }
  }

  const handleReport = async (item) => {
    try {
      const reportRes = await axios.post('/api/report', {
        tid: item.tid,
        pid: item.pid,
        topicId: item.topicId
      })

      // 保存操作记录，包含状态
      await axios.post('/api/save-operation', {
        id: item.pid,
        content: item.content,
        userid: item.puid,
        username: item.username,
        status: reportRes.data.status || 'success'
      })

      markAsViewed(item.pid)
      toast.success('举报成功')
    } catch (error) {
      // 保存失败记录
      await axios.post('/api/save-operation', {
        id: item.pid,
        content: item.content,
        userid: item.puid,
        username: item.username,
        status: 'failed',
        error: error.message
      })
      toast.error('操作失败: ' + error.message)
    }
  }

  const handleBatchReport = async () => {
    if (selected.size === 0) {
      toast.error('请先选择要操作的数据')
      return
    }

    if (!confirm(`确定要批量举报 ${selected.size} 条数据吗？`)) {
      return
    }

    setProcessing(true)
    const selectedItems = userData.replies.filter(item => selected.has(item.pid))

    let successCount = 0
    let failCount = 0

    for (let i = 0; i < selectedItems.length; i++) {
      try {
        await handleReport(selectedItems[i])
        successCount++
        console.log(`已处理 ${i + 1}/${selectedItems.length}`)
        if (i < selectedItems.length - 1) {
          await new Promise(resolve => setTimeout(resolve, interval))
        }
      } catch (error) {
        failCount++
        console.error('处理失败:', error)
      }
    }

    setProcessing(false)
    setSelected(new Set())

    if (failCount === 0) {
      toast.success(`批量操作完成，成功 ${successCount} 条`)
    } else {
      toast.error(`批量操作完成，成功 ${successCount} 条，失败 ${failCount} 条`)
    }
  }

  if (config.euids.length === 0) {
    return (
      <div className="card">
        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
          暂无数据，请先在配置页面添加用户
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Tab 切换 */}
      <div className="card" style={{ marginBottom: '20px', padding: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {config.euids.map(euid => (
            <button
              key={euid}
              onClick={() => switchUser(euid)}
              className={`tab-button ${activeEuid === euid ? 'active' : ''}`}
            >
              {getUserName(euid)}
            </button>
          ))}
        </div>
      </div>

      {/* 用户信息卡片 */}
      {userData && userData.userInfo && (
        <div className="user-info-card">
          <div>
            <h3>{userData.userInfo.username || `用户 ${userData.euid}`}</h3>
            <div className="stats">
              <span>ID: {userData.euid}</span>
              {userData.userInfo.replyCount && (
                <span>回帖: {userData.userInfo.replyCount}</span>
              )}
              {userData.userInfo.recommendCount && (
                <span>推荐: {userData.userInfo.recommendCount}</span>
              )}
              {userData.userInfo.postCount && (
                <span>发帖: {userData.userInfo.postCount}</span>
              )}
              {userData.userInfo.reputation && (
                <span>声望: {userData.userInfo.reputation}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 操作栏 */}
      <div className="card">
        <h2>回帖列表</h2>
        <div style={{ marginTop: '15px', marginBottom: '15px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => activeEuid && loadUserData(activeEuid, 1)}
            disabled={loading}
          >
            {loading ? '加载中...' : '刷新数据'}
          </button>
          <button
            className="btn btn-danger"
            onClick={handleBatchReport}
            disabled={processing || selected.size === 0}
          >
            {processing ? '处理中...' : `批量举报 (${selected.size})`}
          </button>
          <label style={{ marginLeft: '20px' }}>
            间隔时间(ms):
            <input
              type="number"
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              style={{ width: '100px', marginLeft: '10px' }}
              min="1000"
            />
          </label>
        </div>

        {/* 数据表格 */}
        <div style={{ position: 'relative', minHeight: '400px' }}>
          {userData && userData.replies && !loading && (
            <table>
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={userData.replies.length > 0 && userData.replies.every(r => selected.has(r.pid))}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>内容</th>
                  <th style={{ width: '150px' }}>时间</th>
                  <th style={{ width: '100px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {userData.replies.map(item => (
                  <tr
                    key={item.pid}
                    style={{
                      background: viewedItems.has(item.pid) ? '#f0f0f0' : 'white',
                      opacity: viewedItems.has(item.pid) ? 0.7 : 1
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={selected.has(item.pid)}
                        onChange={() => toggleSelect(item.pid)}
                      />
                    </td>
                    <td style={{ maxWidth: '600px', wordBreak: 'break-word' }}>
                      {viewedItems.has(item.pid) && (
                        <span style={{ color: '#28a745', marginRight: '5px', fontWeight: 'bold' }}>✓</span>
                      )}
                      {item.content}
                    </td>
                    <td>{item.formatTime}</td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleReport(item)}
                        disabled={viewedItems.has(item.pid)}
                      >
                        {viewedItems.has(item.pid) ? '已处理' : '举报'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {userData && userData.replies.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
              该用户暂无数据
            </div>
          )}

          {!userData && !loading && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
              请选择一个用户查看数据
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
        {userData && (
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px' }}>
            <button
              className="btn btn-primary"
              onClick={() => loadPage(userData.page - 1)}
              disabled={userData.page <= 1 || loading}
            >
              上一页
            </button>
            <span style={{ fontSize: '14px', color: '#666' }}>
              第 {userData.page} 页 · 共 {userData.replies.length} 条
            </span>
            <button
              className="btn btn-primary"
              onClick={() => loadPage(userData.page + 1)}
              disabled={!userData.hasNext || loading}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default HomePage
