import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './fixes.css';
import App from './App.jsx';
import { AppProvider } from './context/AppContext.jsx';
import { applyStoredTheme } from './lib/theme.js';

applyStoredTheme(); // set data-theme before first paint to avoid a flash

// iOS Safari zooms the page into any focused field under 16px and never zooms
// back out, which leaves the header (account face included) enlarged and pushed
// aside. maximum-scale=1 stops only that auto-zoom on iOS, where pinch zoom
// still works; elsewhere it would block pinch zoom, so other browsers keep the
// plain viewport. iPadOS reports itself as a Mac with touch points.
if (/iP(hone|od|ad)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp && !/maximum-scale/.test(vp.content)) vp.content += ', maximum-scale=1';
}

import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#222', color: '#f88', fontFamily: 'monospace' }}>
          <h2>Something went wrong.</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children; 
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
