import React, { useState } from 'react';
import type { User } from '../../services/session';
import { Building2, Loader2, LogOut } from 'lucide-react';
import { completeClientOnboarding } from '../../services/api';
import type { ClientType } from '../../types/tenant';

export const ClientOnboarding: React.FC<{
  user: User;
  onComplete: () => void;
  onLogout: () => void;
}> = ({ user, onComplete, onLogout }) => {
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [clientName, setClientName] = useState('');
  const [clientType, setClientType] = useState<ClientType>('landlord');
  const [phone, setPhone] = useState(user.phoneNumber || '');
  const [billingEmail, setBillingEmail] = useState(user.email || '');
  const [abn, setAbn] = useState('');
  const [acn, setAcn] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await completeClientOnboarding({
        displayName,
        clientName,
        clientType,
        phone: phone || undefined,
        billingEmail: billingEmail || undefined,
        abn: abn || undefined,
        acn: acn || undefined,
        externalReference: externalReference || undefined,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete onboarding.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="w-11 h-11 rounded-xl bg-[#F0FBFB] text-[#006D70] flex items-center justify-center">
          <Building2 className="w-5 h-5" />
        </div>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-[#007F82]">Client Portal</p>
        <h1 className="mt-2 text-2xl font-extrabold text-[#1A2B4A]">Set up your client account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your verified sign-in is not yet linked to a ProInspect client. Create the canonical client account that will own your portal access.
        </p>

        {error && <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Your name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Client / organisation name</span>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Client type</span>
            <select value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5">
              <option value="landlord">Landlord / owner</option>
              <option value="agency">Property agency</option>
              <option value="commercial_landlord">Commercial landlord</option>
              <option value="strata_company">Strata company</option>
              <option value="asset_manager">Asset manager</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Billing email</span>
            <input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-bold text-slate-700">ABN (optional)</span>
              <input value={abn} onChange={(e) => setAbn(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-700">ACN (optional)</span>
              <input value={acn} onChange={(e) => setAcn(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">External / portfolio reference (optional)</span>
            <input value={externalReference} onChange={(e) => setExternalReference(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button type="submit" disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#006D70] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Create client account
            </button>
            <button type="button" onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-slate-500">
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
