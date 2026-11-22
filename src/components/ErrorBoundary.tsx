import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { FirestoreErrorInfo } from '../firebase';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  firestoreInfo: FirestoreErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      firestoreInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let firestoreInfo: FirestoreErrorInfo | null = null;
    try {
      const parsed = JSON.parse(error.message) as Partial<FirestoreErrorInfo>;
      if (parsed && typeof parsed.error === 'string' && 'operationType' in parsed) {
        firestoreInfo = parsed as FirestoreErrorInfo;
      }
    } catch {
      // Standard React error
    }
    return {
      hasError: true,
      message: firestoreInfo ? firestoreInfo.error : error.message || 'Terjadi kesalahan tidak terduga.',
      firestoreInfo,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, message: '', firestoreInfo: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { firestoreInfo, message } = this.state;

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">
                Terjadi Gangguan Aplikasi
              </h1>
              <p className="text-xs text-slate-500">
                {firestoreInfo
                  ? 'Sinkronisasi database cloud mengalami kendala izin atau koneksi.'
                  : 'Aplikasi mengalami kesalahan saat memuat tampilan.'}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 text-xs text-slate-700 space-y-1">
            <p className="font-semibold text-slate-900">Detail Pesan:</p>
            <p className="font-mono break-words text-[11px] text-rose-700">{message}</p>
            {firestoreInfo?.path && (
              <p className="text-[11px] text-slate-500">
                Path: <span className="font-mono">{firestoreInfo.path}</span> ({firestoreInfo.operationType})
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={this.handleReload}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Muat Ulang Aplikasi</span>
          </button>
        </div>
      </div>
    );
  }
}
