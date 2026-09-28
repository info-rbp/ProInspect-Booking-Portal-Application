import React, { useState } from 'react';
import { Building2, Loader2, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type {
  ClientOrganisationRole,
  ClientPortalDashboard,
} from '../../types/clientPortal';
import {
  activateClientOrganisation,
  completeClientOnboarding,
  inviteClientMember,
  updateClientMember,
} from '../../services/api';

const inputClass =
  'w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 outline-none focus:border-[#00B5B8]';

export function ClientAccount({
  dashboard,
  onRefresh,
}: {
  dashboard: ClientPortalDashboard;
  onRefresh: () => Promise<void> | void;
}) {
  const [orgName, setOrgName] = useState(dashboard.organisation.name);
  const [entityType, setEntityType] = useState(dashboard.organisation.entityType);
  const [abn, setAbn] = useState(dashboard.organisation.abn || '');
  const [acn, setAcn] = useState(dashboard.organisation.acn || '');
  const [billingEmail, setBillingEmail] = useState(
    dashboard.organisation.billingEmail || dashboard.profile.email
  );
  const [phone, setPhone] = useState(
    dashboard.organisation.phone || dashboard.profile.phone || ''
  );
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<Exclude<ClientOrganisationRole, 'owner'>>('member');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage =
    dashboard.membership.role === 'owner' || dashboard.membership.role === 'admin';
  const isOwner = dashboard.membership.role === 'owner';

  const saveOrganisation = async () => {
    setBusy('organisation');
    setMessage(null);
    try {
      await completeClientOnboarding({
        displayName: dashboard.profile.displayName,
        phone,
        organisationName: orgName,
        entityType,
        abn,
        acn,
        billingEmail,
      });
      await onRefresh();
      setMessage('Organisation details updated.');
    } catch (err: any) {
      setMessage(err?.message || 'Unable to update organisation.');
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    setBusy('invite');
    setMessage(null);
    try {
      await inviteClientMember({
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail('');
      await onRefresh();
      setMessage('Organisation member invitation created.');
    } catch (err: any) {
      setMessage(err?.message || 'Unable to invite member.');
    } finally {
      setBusy(null);
    }
  };

  const switchOrganisation = async (organisationId: string) => {
    setBusy(organisationId);
    setMessage(null);
    try {
      await activateClientOrganisation(organisationId);
      await onRefresh();
    } catch (err: any) {
      setMessage(err?.message || 'Unable to switch organisation.');
    } finally {
      setBusy(null);
    }
  };

  const changeMember = async (
    membershipId: string,
    changes: { role?: 'admin' | 'member' | 'viewer'; status?: 'active' | 'revoked' }
  ) => {
    setBusy(membershipId);
    setMessage(null);
    try {
      await updateClientMember(membershipId, changes);
      await onRefresh();
    } catch (err: any) {
      setMessage(err?.message || 'Unable to update member.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1A2B4A]">
          Account & Organisation
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage your client entity, organisation access and authorised portal users.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
          {message}
        </div>
      )}

      {dashboard.organisations.length > 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[#007F82]" />
            <h2 className="font-bold text-[#1A2B4A]">Your organisations</h2>
          </div>
          <div className="mt-4 space-y-2">
            {dashboard.organisations.map(({ organisation, role }) => (
              <div
                key={organisation.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
              >
                <div>
                  <div className="font-semibold text-sm text-[#1A2B4A]">{organisation.name}</div>
                  <div className="text-xs text-slate-500 capitalize">{role}</div>
                </div>
                {organisation.id === dashboard.organisation.id ? (
                  <span className="text-xs font-bold text-[#006D70]">Active</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchOrganisation(organisation.id)}
                    disabled={busy === organisation.id}
                    className="text-xs font-bold text-[#006D70]"
                  >
                    {busy === organisation.id ? 'Switching…' : 'Switch'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#007F82]" />
          <h2 className="font-bold text-[#1A2B4A]">Organisation details</h2>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-600 mb-1">Organisation / ownership name</label>
            <input disabled={!canManage} className={inputClass} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Entity type</label>
            <select disabled={!canManage} className={inputClass} value={entityType} onChange={(e) => setEntityType(e.target.value as typeof entityType)}>
              <option value="individual">Individual</option>
              <option value="company">Company</option>
              <option value="trust">Trust</option>
              <option value="partnership">Partnership</option>
              <option value="strata">Strata company</option>
              <option value="agency">Agency / business</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Billing email</label>
            <input disabled={!canManage} className={inputClass} value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">ABN</label>
            <input disabled={!canManage} className={inputClass} value={abn} onChange={(e) => setAbn(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">ACN</label>
            <input disabled={!canManage} className={inputClass} value={acn} onChange={(e) => setAcn(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Phone</label>
            <input disabled={!canManage} className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        {canManage && (
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={busy === 'organisation'}
              onClick={saveOrganisation}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#007F82] text-white text-sm font-bold disabled:opacity-50"
            >
              {busy === 'organisation' && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Organisation
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-[#007F82]" />
          <h2 className="font-bold text-[#1A2B4A]">Portal users</h2>
        </div>
        <div className="mt-4 divide-y divide-slate-100">
          {dashboard.members.map((member) => (
            <div key={member.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-sm text-[#1A2B4A]">{member.displayName || member.email}</div>
                <div className="text-xs text-slate-500">{member.email} · {member.status}</div>
              </div>
              <div className="flex items-center gap-2">
                {isOwner && member.role !== 'owner' ? (
                  <>
                    <select
                      value={member.role}
                      disabled={busy === member.id}
                      onChange={(e) =>
                        changeMember(member.id, {
                          role: e.target.value as 'admin' | 'member' | 'viewer',
                        })
                      }
                      className="h-9 px-2 text-xs border border-slate-300 rounded-lg"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    {member.status !== 'revoked' && (
                      <button
                        type="button"
                        disabled={busy === member.id}
                        onClick={() => changeMember(member.id, { status: 'revoked' })}
                        className="text-xs font-bold text-rose-600"
                      >
                        Revoke
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-xs font-bold capitalize text-slate-600">{member.role}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {canManage && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <h3 className="text-sm font-bold text-[#1A2B4A]">Invite another user</h3>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_130px_auto] gap-2">
              <input className={inputClass} type="email" placeholder="user@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <select className={inputClass} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Exclude<ClientOrganisationRole, 'owner'>)}>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="button"
                disabled={!inviteEmail || busy === 'invite'}
                onClick={invite}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A2B4A] text-white text-sm font-bold disabled:opacity-50"
              >
                {busy === 'invite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Invite
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              The invitation is claimed automatically when that email signs in with a verified Google/Firebase account.
            </p>
          </div>
        )}
      </div>

      <button type="button" onClick={() => onRefresh()} className="inline-flex items-center gap-2 text-xs font-bold text-[#006D70]">
        <RefreshCw className="w-4 h-4" /> Refresh portal data
      </button>
    </div>
  );
}
