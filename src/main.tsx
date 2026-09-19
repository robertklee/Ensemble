import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { showError } from './store';
import './styles.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Ensemble render failure', error, info);
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal">
          <h1>Something needs a fresh start.</h1>
          <p>Your saved trip data has not been deleted.</p>
          <pre>{this.state.error}</pre>
          <button onClick={() => location.reload()}>Reload Ensemble</button>
        </main>
      );
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('Offline setup failed', error);
      showError(
        new Error(
          'Offline app loading could not be enabled. Your saved expenses are still available while this page is open.',
        ),
      );
    });
  });
}
