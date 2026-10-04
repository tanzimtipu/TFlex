// Phase 101 (chunk 2) - React error boundary that captures a renderer render
// crash and forwards it to the main-process bug-report service.
//
// Capture only: the fallback renders `null` (no recovery UI, no dialog). The
// bridge is optional, so a missing preload never throws from the boundary.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureRendererBug } from "./installGlobalHandlers";

interface BugReportErrorBoundaryProps {
  children: ReactNode;
}

interface BugReportErrorBoundaryState {
  failed: boolean;
}

export class BugReportErrorBoundary extends Component<
  BugReportErrorBoundaryProps,
  BugReportErrorBoundaryState
> {
  state: BugReportErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): BugReportErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    captureRendererBug({
      level: "error",
      category: "renderer-boundary",
      component: "renderer",
      message: error.message,
      errorName: error.name,
      stackTrace: error.stack,
      handled: true,
    });
  }

  render(): ReactNode {
    if (this.state.failed) {
      return null;
    }
    return this.props.children;
  }
}
