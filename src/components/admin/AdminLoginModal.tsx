import React, { useState } from 'react';
import { signInWithGoogle, getCachedAccessToken } from '../../services/firebase';
import { syncServerOAuthToken } from '../../services/api';
import { Shield, X, AlertCircle, Loader2 } from 'lucide-react';
import { User } from 'firebase/auth';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await signInWithGoogle();
      if (result.accessToken) {
        await syncServerOAuthToken(result.accessToken);
      }
      onLoginSuccess(result.user);
      onClose();
    } catch (err: any) {
      console.error('Login failed:', err);
      setError(err?.message || 'Authentication was cancelled or failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-fadeIn relative">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center space-y-3 pb-4 border-b border-slate-100">
          <div className="w-12 h-12 bg-sky-100 text-[#0284C7] rounded-xl flex items-center justify-center mx-auto">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#0A2540]">ProInspect Staff Portal</h2>
            <p className="text-xs text-slate-500 mt-1">
              Sign in with your authorized Google Workspace account to access operational work orders and calendar synchronization.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        <div className="py-6 flex flex-col items-center justify-center">
          {/* Official Google Sign-In Button format per Workspace Skill */}
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm py-3 px-4 rounded-xl border border-slate-300 shadow-xs hover:shadow transition-all cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 text-[#0284C7] animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
            <span>Sign in with Google</span>
          </button>
        </div>

        <div className="text-center text-[11px] text-slate-400">
          Authorized administrator email: <br />
          <strong className="text-slate-600 font-mono">info@remotebusinesspartner.com.au</strong>
        </div>
      </div>
    </div>
  );
};
