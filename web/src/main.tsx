import React from 'react'
import ReactDOM from 'react-dom/client'
import { Router } from 'wouter'
import App from './App'
import { appBasePath } from './lib/basePath'
import './styles/globals.css'
import '@xterm/xterm/css/xterm.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router base={appBasePath}>
      <App />
    </Router>
  </React.StrictMode>,
)
