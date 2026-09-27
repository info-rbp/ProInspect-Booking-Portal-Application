import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import path from 'path';

type AppletFirebaseConfig = {
  projectId: string;
  firestoreDatabaseId?: string;
};

function loadAppletFirebaseConfig(): AppletFirebaseConfig {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  return JSON.parse(readFileSync(configPath, 'utf8')) as AppletFirebaseConfig;
}

function parseServiceAccountSecret() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  const parsed = JSON.parse(raw);
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

const appletConfig = loadAppletFirebaseConfig();
const serviceAccount = parseServiceAccountSecret();

const adminApp =
  getApps()[0] ||
  initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID || appletConfig.projectId,
  });

const firestoreDatabaseId =
  process.env.FIRESTORE_DATABASE_ID ||
  appletConfig.firestoreDatabaseId ||
  '(default)';

export const adminDb = getFirestore(adminApp, firestoreDatabaseId);
adminDb.settings({ ignoreUndefinedProperties: true });

export const adminAuth = getAuth(adminApp);

export function getFirebaseRuntimeInfo() {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || appletConfig.projectId,
    firestoreDatabaseId,
    credentialMode: serviceAccount ? 'service-account-secret' : 'application-default-credentials',
  };
}
