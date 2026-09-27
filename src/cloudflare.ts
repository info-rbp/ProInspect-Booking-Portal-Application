import { Container, getContainer } from '@cloudflare/containers';
import { env } from 'cloudflare:workers';

function stringBinding(name: string): string {
  const bindings = env as unknown as Record<string, unknown>;
  const value = bindings[name];
  return typeof value === 'string' ? value : '';
}

const REQUIRED_RUNTIME_BINDINGS = [
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_CALENDAR_ID',
  'GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON',
] as const;

function missingRuntimeBindings(): string[] {
  return REQUIRED_RUNTIME_BINDINGS.filter((name) => !stringBinding(name));
}

export class ProInspectContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';
  enableInternet = true;
  pingEndpoint = 'localhost/api/health';

  envVars = {
    NODE_ENV: 'production',
    PORT: '8080',
    FIREBASE_PROJECT_ID: stringBinding('FIREBASE_PROJECT_ID'),
    FIRESTORE_DATABASE_ID: stringBinding('FIRESTORE_DATABASE_ID'),
    FIREBASE_SERVICE_ACCOUNT_JSON: stringBinding('FIREBASE_SERVICE_ACCOUNT_JSON'),
    ADMIN_EMAILS: stringBinding('ADMIN_EMAILS'),
    GOOGLE_CALENDAR_ID: stringBinding('GOOGLE_CALENDAR_ID'),
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: stringBinding(
      'GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON'
    ),
  };
}

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    const missing = missingRuntimeBindings();
    if (missing.length > 0) {
      console.error('Cloudflare runtime configuration is incomplete:', missing);
      return Response.json(
        {
          error: 'Deployment configuration is incomplete.',
          missing,
        },
        { status: 503 }
      );
    }

    const container = getContainer(
      workerEnv.PROINSPECT_CONTAINER,
      'proinspect-production'
    );

    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
