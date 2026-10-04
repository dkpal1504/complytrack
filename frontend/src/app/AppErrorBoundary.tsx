import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";

interface State {
  error: Error | null;
}

/**
 * The last line of defence.
 *
 * A render error in one screen must not blank the whole application: this
 * catches it, shows the user something honest and gives them a way back.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as a console error rather than a silent swallow, so the browser
    // console still tells a developer what happened.
    console.error("ComplyTrack render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <h1 className="text-2xl font-semibold text-ink">Something went wrong</h1>
        <p className="max-w-lg text-sm text-ink-muted">
          The screen could not be displayed. Nothing you had saved has been lost — the
          change is recorded on the server as soon as you submit it.
        </p>
        <pre className="max-w-full overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface-muted p-3 text-left text-xs text-ink-muted">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button variant="secondary" icon="refresh" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
          <Button
            variant="primary"
            icon="home"
            onClick={() => {
              this.setState({ error: null });
              window.location.assign("/");
            }}
          >
            Back to the start
          </Button>
        </div>
      </div>
    );
  }
}
