import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'

function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/users')
      setUsers(res.data)
    } catch (error) {
      toast.error('加载用户失败: ' + error.message)
    }
    setLoading(false)
  }

  const fetchUserInfo = async (euid) => {
    setLoading(true)
    try {
      const res = await axios.post('/api/fetch-user-info', { euid })
      if (res.data.success) {
        toast.success('抓取成功！')
        await loadUsers()
      }
    } catch (error) {
      toast.error('抓取失败: ' + error.message)
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="card">
        <h2>用户管理</h2>
        <button className="btn btn-primary" onClick={loadUsers} disabled={loading} style={{ marginBottom: '15px' }}>
          {loading ? '加载中...' : '刷新'}
        </button>

        <table>
          <thead>
            <tr>
              <th>用户ID</th>
              <th>用户名</th>
              <th>回帖数</th>
              <th>推荐数</th>
              <th>发帖数</th>
              <th>声望值</th>
              <th>最后更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.euid}>
                <td>{user.euid}</td>
                <td>{user.username || '-'}</td>
                <td>{user.replyCount || '-'}</td>
                <td>{user.recommendCount || '-'}</td>
                <td>{user.postCount || '-'}</td>
                <td>{user.reputation || '-'}</td>
                <td style={{ fontSize: '12px', color: '#666' }}>
                  {user.lastUpdate ? new Date(user.lastUpdate).toLocaleString('zh-CN') : '-'}
                </td>
                <td>
                  <button
                    className="btn btn-primary"
                    onClick={() => fetchUserInfo(user.euid)}
                    disabled={loading}
                  >
                    {loading ? '抓取中...' : '抓取信息'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
            暂无用户，请先在配置页面添加用户ID
          </div>
        )}
      </div>
    </div>
  )
}

export default UsersPage
