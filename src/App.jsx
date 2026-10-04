import { Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Topbar from './components/Topbar'
import HomePage from './pages/HomePage'
import ConfigPage from './pages/ConfigPage'
import ReportResultsPage from './pages/ReportResultsPage'

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
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/results" element={<ReportResultsPage />} />
        <Route path="/settings" element={<ConfigPage />} />
      </Routes>
    </div>
  )
}

export default App
