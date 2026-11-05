import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

if (window.isSecureContext) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} else {
  // crypto.randomUUID, crypto.subtle and Web Locks exist only in secure contexts.
  container.textContent =
    'Combat Map needs a secure context: open it over https, or on http://localhost when developing.'
}
