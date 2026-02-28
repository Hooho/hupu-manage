import { useState, useEffect } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'

function ConfigPage() {
  const [config, setConfig] = useState({
    cookie: '',
    euids: []
  })
  const [newEuid, setNewEuid] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const res = await axios.get('/api/config')
      setConfig(res.data)
    } catch (error) {
      console.error('加载配置失败:', error)
    }
  }

  const saveConfig = async () => {
    setLoading(true)
    try {
      await axios.post('/api/config', config)
      toast.success('配置保存成功')
    } catch (error) {
      toast.error('保存失败: ' + error.message)
    }
    setLoading(false)
  }

  const addEuid = () => {
    if (!newEuid.trim()) {
      toast.error('请输入用户ID')
      return
    }
    if (config.euids.includes(newEuid)) {
      toast.error('该用户ID已存在')
      return
    }
    setConfig({
      ...config,
      euids: [...config.euids, newEuid]
    })
    setNewEuid('')
    toast.success('用户ID已添加')
  }

  const removeEuid = (euid) => {
    setConfig({
      ...config,
      euids: config.euids.filter(e => e !== euid)
    })
  }

  return (
    <div>
      <div className="card">
        <h2>系统配置</h2>

        <div className="form-group">
          <label>Cookie</label>
          <textarea
            rows="4"
            value={config.cookie}
            onChange={(e) => setConfig({ ...config, cookie: e.target.value })}
            placeholder="请输入虎扑网站的 Cookie"
          />
          <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
            在浏览器开发者工具中复制 Cookie 值
          </small>
        </div>

        <div className="form-group">
          <label>用户ID列表 (euid)</label>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <input
              type="text"
              value={newEuid}
              onChange={(e) => setNewEuid(e.target.value)}
              placeholder="输入用户ID"
              onKeyPress={(e) => e.key === 'Enter' && addEuid()}
            />
            <button className="btn btn-primary" onClick={addEuid}>
              添加
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {config.euids.map(euid => (
              <div
                key={euid}
                style={{
                  padding: '8px 12px',
                  background: '#e9ecef',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>{euid}</span>
                <button
                  onClick={() => removeEuid(euid)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#dc3545',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" onClick={saveConfig} disabled={loading}>
          {loading ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  )
}

export default ConfigPage
