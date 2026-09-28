import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, LogIn } from 'lucide-react';
import { signInWithGoogle } from '../../services/firebase';
import { verifyClientSession } from '../../services/api';
import type { User } from 'firebase/auth';

interface ClientSignInProps {
  onSignedIn: (user: User) => void;
  onBack: () => void;
}

export const ClientSignIn: React.FC<ClientSignInProps> = ({
  onSignedIn,
  onBack,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await signInWithGoogle();
      await verifyClientSession();
      onSignedIn(result.user);
    } catch (err: any) {
      setError(err?.message || 'Sign in could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-8 sm:py-14 animate-fadeIn">
      <div className="rounded-2xl border border-slate-200 bg-white p-7 sm:p-10 shadow-xs">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#F0FBFB] text-[#007F82] flex items-center justify-center mx-auto">
            <LogIn className="w-7 h-7" />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#007F82]">
            Client Portal
          </p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
            Sign in to ProInspect
          </h1>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Use the Google account associated with your ProInspect bookings. Existing bookings using the same verified email address will be linked to your portal automatically.
          </p>
        </div>

        {error && (
          <div className="mt-5 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={handleSignIn}
          className="mt-7 w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm py-3 px-4 rounded-xl border border-slate-300 shadow-xs hover:shadow transition-all disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 text-[#006D70] animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
          )}
          <span>Continue with Google</span>
        </button>

        <button
          type="button"
          onClick={onBack}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Client Hub
        </button>
      </div>
    </div>
  );
};
