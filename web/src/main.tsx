import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import '@xterm/xterm/css/xterm.css'

if (import.meta.env.DEV) document.title = 'dev-OpenFox'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
