import React, { ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

export class SimpleErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    error: ""
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg my-4 shadow-sm">
            <h3 className="text-red-800 font-bold text-sm flex items-center gap-2">
                ⚠️ Render Failed
            </h3>
            <p className="text-red-600 text-xs mt-2 font-mono bg-white p-2 rounded border border-red-100 whitespace-pre-wrap">
                {this.state.error}
            </p>
            <button 
                className="mt-3 px-3 py-1.5 bg-white border border-red-200 text-red-700 text-xs font-bold rounded hover:bg-red-50 transition-colors"
                onClick={this.handleReset}
            >
                Retry
            </button>
        </div>
      );
    }

    return this.props.children || null;
  }
}