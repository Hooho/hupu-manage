import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import HomePage from './pages/HomePage'
import ConfigPage from './pages/ConfigPage'
import UsersPage from './pages/UsersPage'
import ReportResultsPage from './pages/ReportResultsPage'

function App() {
  const location = useLocation()

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#fff',
            color: '#333',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          },
          success: {
            iconTheme: {
              primary: '#c60100',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#c60100',
              secondary: '#fff',
            },
          },
        }}
      />
      <header className="header">
        <div className="header-content">
          <img
            src="/imgs/hupu-logo.png"
            alt="虎扑篮球"
            className="logo"
          />
          <h1 className="site-title">虎扑评论管理工具</h1>
        </div>
      </header>

      <div className="container">
        <nav className="nav">
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
            首页
          </Link>
          <Link to="/report-results" className={location.pathname === '/report-results' ? 'active' : ''}>
            举报结果
          </Link>
          <Link to="/config" className={location.pathname === '/config' ? 'active' : ''}>
            配置
          </Link>
          <Link to="/users" className={location.pathname === '/users' ? 'active' : ''}>
            用户管理
          </Link>
        </nav>

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/report-results" element={<ReportResultsPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/users" element={<UsersPage />} />
        </Routes>
      </div>
    </>
  )
}

export default App
