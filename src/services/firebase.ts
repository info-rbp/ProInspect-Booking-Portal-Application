import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function initAuthListener(
  onSuccess?: (user: User) => void,
  onFailure?: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user) onSuccess?.(user);
    else onFailure?.();
  });
}

export async function signInWithGoogle(): Promise<{ user: User }> {
  const result = await signInWithPopup(auth, googleProvider);
  return { user: result.user };
}

export async function getAdminIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

const TENANT_EMAIL_STORAGE_KEY = 'proinspectTenantEmail';

export function tenantEmailLinkIsActive(): boolean {
  return isSignInWithEmailLink(auth, window.location.href);
}

export async function sendTenantSignInLink(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('Email address is required.');

  await sendSignInLinkToEmail(auth, normalized, {
    url: `${window.location.origin}/tenant/complete-signin`,
    handleCodeInApp: true,
  });

  window.localStorage.setItem(TENANT_EMAIL_STORAGE_KEY, normalized);
}

export async function completeTenantSignIn(email?: string): Promise<{ user: User }> {
  if (!tenantEmailLinkIsActive()) {
    throw new Error('This sign-in link is invalid or has expired.');
  }

  const storedEmail = window.localStorage.getItem(TENANT_EMAIL_STORAGE_KEY) || '';
  const resolvedEmail = (email || storedEmail).trim().toLowerCase();

  if (!resolvedEmail) {
    throw new Error('Enter the email address that received this sign-in link.');
  }

  const result = await signInWithEmailLink(auth, resolvedEmail, window.location.href);
  window.localStorage.removeItem(TENANT_EMAIL_STORAGE_KEY);
  return { user: result.user };
}

export async function getCurrentIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function logoutAdmin() {
  await signOut(auth);
}

export async function logoutTenant() {
  await signOut(auth);
}
