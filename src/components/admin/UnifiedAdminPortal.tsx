import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import type { InspectionService } from '../../types/booking';
import { AdminDashboard } from './AdminDashboard';
import { AdminPortal } from './AdminPortal';
import { LayoutDashboard, ShieldCheck } from 'lucide-react';

interface UnifiedAdminPortalProps {
  currentUser: User | null;
  onLogout: () => void;
  onBackToBooking: () => void;
  onServicesChanged?: (services: InspectionService[]) => void;
}

export const UnifiedAdminPortal: React.FC<UnifiedAdminPortalProps> = (props) => {
  const [workspace, setWorkspace] = useState<'operations' | 'platform'>('operations');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setWorkspace('operations')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${workspace === 'operations' ? 'bg-[#006D70] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <LayoutDashboard className="w-4 h-4" /> Operations & workflows
        </button>
        <button type="button" onClick={() => setWorkspace('platform')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold ${workspace === 'platform' ? 'bg-[#006D70] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <ShieldCheck className="w-4 h-4" /> Platform administration
        </button>
      </div>
      {workspace === 'operations' ? <AdminDashboard {...props} /> : <AdminPortal {...props} />}
    </div>
  );
};
