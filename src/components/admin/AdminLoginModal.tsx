import React from 'react';
import {X,Shield} from 'lucide-react';
import type {User} from '../../services/session';
export const AdminLoginModal:React.FC<{isOpen:boolean;onClose:()=>void;onLoginSuccess:(user:User)=>void}>=({isOpen,onClose})=>!isOpen?null:(
 <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"><section role="dialog" aria-modal="true" aria-labelledby="staff-login-title" className="bg-white rounded-2xl max-w-md w-full p-7 relative"><button aria-label="Close" onClick={onClose} className="absolute top-3 right-3"><X/></button><Shield className="text-teal-800 mb-4"/><h2 id="staff-login-title" className="text-xl font-bold">ProInspect Staff Portal</h2><p className="my-4">Continue through Cloudflare Access using your authorised staff email. Your ProInspect role controls which records and actions you can access.</p><a href="/admin" className="block text-center bg-teal-800 text-white rounded-lg py-3">Continue to secure staff sign-in</a></section></div>
);
