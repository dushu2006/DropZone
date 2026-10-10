import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not log private component state or provider responses. */
  }
  render() {
    return this.state.failed ? (
      <main className="auth-page">
        <section className="auth-card">
          <h1>This page could not load</h1>
          <p>
            Your records have not been replaced with sample data. Check your
            connection and reload. Unsaved form input may need to be entered
            again.
          </p>
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Reload DropZone
          </button>
          <a href="/app">Return to events</a>
        </section>
      </main>
    ) : (
      this.props.children
    );
  }
}
