import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './assets/global.css'
import RootLayout from './Layout'
import App from './App'
import { SiteGate } from './components/SiteGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initializeLogger } from './lib/logger'

initializeLogger()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RootLayout>
        <SiteGate><App /></SiteGate>
      </RootLayout>
    </ErrorBoundary>
  </StrictMode>,
)

