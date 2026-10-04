import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import axios from 'axios'
import Topbar from './components/Topbar'
import HomePage from './pages/HomePage'
import ConfigPage from './pages/ConfigPage'
import ReportResultsPage from './pages/ReportResultsPage'

function TodayBanner() {
  const [board, setBoard] = useState([])
  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const r = await axios.get('/api/scheduler/board')
        if (mounted) setBoard(r.data.tasks || [])
      } catch {}
    }
    load()
    const t = setInterval(load, 10000)
    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [])

  const items = []
  board.forEach((t) => {
    if (t.running) {
      items.push({
        type: 'running',
        text: `⏳ ${t.name} 正在执行`
      })
    } else if (t.ranToday) {
      items.push({
        type: t.todayRun.success ? 'success' : 'error',
        text: `${t.todayRun.success ? '✓' : '✗'} 今日 ${t.todayRun.at} · ${t.name} ${t.todayRun.success ? '已跑完' : '失败'}`
      })
    }
  })
  if (items.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        marginBottom: 16
      }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--r-sm)',
            fontSize: 'var(--fs-13)',
            background:
              it.type === 'success'
                ? 'var(--success-bg)'
                : it.type === 'error'
                ? 'var(--danger-bg)'
                : it.type === 'running'
                ? 'var(--accent-bg)'
                : 'var(--bg-2)',
            color:
              it.type === 'success'
                ? 'var(--success)'
                : it.type === 'error'
                ? 'var(--danger)'
                : it.type === 'running'
                ? 'var(--accent)'
                : 'var(--text)'
          }}
        >
          {it.text}
        </div>
      ))}
    </div>
  )
}

function App() {
  return (
    <div className="container">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2500,
          style: {
            background: '#1c1c1b',
            color: '#fff',
            fontSize: '13px',
            padding: '9px 16px',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
          }
        }}
      />
      <Topbar />
      <TodayBanner />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/results" element={<ReportResultsPage />} />
        <Route path="/settings" element={<ConfigPage />} />
      </Routes>
    </div>
  )
}

export default App
