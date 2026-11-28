import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { prewarmGoogleMapsApi } from './utils/googleMapsLoader'

prewarmGoogleMapsApi('ko')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
