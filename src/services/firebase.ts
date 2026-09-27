import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
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

export async function logoutAdmin() {
  await signOut(auth);
}
