import React, { useState } from 'react';
import { ArrowLeft, Loader2, LogIn } from 'lucide-react';
import type { User } from 'firebase/auth';
import { signInWithGoogle } from '../../services/firebase';
import { verifyClientSession } from '../../services/api';

export const ClientSignIn: React.FC<{
  onSignedIn: (user: User) => void;
  onBack: () => void;
}> = ({ onSignedIn, onBack }) => {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const signIn=async()=>{
    setBusy(true); setError(null);
    try {
      const { user } = await signInWithGoogle();
      await verifyClientSession();
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally { setBusy(false); }
  };

  return <div className="max-w-lg mx-auto py-10">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 mb-5"><ArrowLeft className="w-4 h-4"/>Back</button>
    <div className="rounded-2xl border border-slate-200 bg-white p-7 sm:p-9">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#007F82]">ProInspect Client Portal</p>
      <h1 className="mt-2 text-2xl font-extrabold text-[#1A2B4A]">Client sign in</h1>
      <p className="mt-3 text-sm text-slate-600">Use the Google account whose verified email has been provisioned against your ProInspect client account.</p>
      {error && <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <button disabled={busy} onClick={signIn} className="mt-6 w-full h-12 rounded-lg bg-[#007F82] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50">
        {busy?<Loader2 className="w-4 h-4 animate-spin"/>:<LogIn className="w-4 h-4"/>}
        Sign in with Google
      </button>
    </div>
  </div>;
};
