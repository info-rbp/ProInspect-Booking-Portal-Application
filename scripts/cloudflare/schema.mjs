import { readFileSync, writeFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../../src/cloudflare/collections.ts',import.meta.url),'utf8');
const names=[...source.split('] as const')[0].matchAll(/'([^']+)'/g)].map(x=>x[1]);
const lines=[`-- Cloudflare D1 migration. Canonical IDs and payloads are preserved.
-- Each domain has its own table; generated relational columns remain queryable.
-- No application secrets or production data are included.
CREATE TABLE _document_versions (collection TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(collection,id));
CREATE TABLE _collection_versions (collection TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE _transaction_checks (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1));
`];
for(const name of names){
 lines.push(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data)='object'),
 property_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.propertyId')) VIRTUAL,
 client_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.clientId')) VIRTUAL,
 tenancy_id TEXT GENERATED ALWAYS AS (json_extract(data,'$.tenancyId')) VIRTUAL,
 created_at TEXT GENERATED ALWAYS AS (json_extract(data,'$.createdAt')) VIRTUAL,
 updated_at TEXT GENERATED ALWAYS AS (json_extract(data,'$.updatedAt')) VIRTUAL);
INSERT INTO _collection_versions(collection,version) VALUES('${name}',0);
CREATE INDEX "${name}_property" ON "${name}"(property_id);
CREATE INDEX "${name}_client" ON "${name}"(client_id);
CREATE INDEX "${name}_tenancy" ON "${name}"(tenancy_id);
CREATE INDEX "${name}_created" ON "${name}"(created_at);
CREATE INDEX "${name}_updated" ON "${name}"(updated_at);`);
 for(const action of ['INSERT','UPDATE','DELETE']){
  const row=action==='DELETE'?'OLD':'NEW';
  lines.push(`CREATE TRIGGER "${name}_${action.toLowerCase()}_version" AFTER ${action} ON "${name}" BEGIN
UPDATE _collection_versions SET version=version+1 WHERE collection='${name}';
INSERT INTO _document_versions(collection,id,version) VALUES('${name}',${row}.id,1)
ON CONFLICT(collection,id) DO UPDATE SET version=version+1;
END;`);
 }
 if(['auditEvents','sensitiveAuditEvents'].includes(name)){
  for(const action of ['UPDATE','DELETE']) lines.push(`CREATE TRIGGER "${name}_no_${action.toLowerCase()}" BEFORE ${action} ON "${name}" BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT'); END;`);
 }
}
lines.push(`CREATE UNIQUE INDEX bookings_reference ON bookings(json_extract(data,'$.bookingReference')) WHERE json_extract(data,'$.bookingReference') IS NOT NULL;
CREATE UNIQUE INDEX bookings_manage_token ON bookings(json_extract(data,'$.managementToken')) WHERE json_extract(data,'$.managementToken') IS NOT NULL;
CREATE INDEX bookings_date ON bookings(json_extract(data,'$.appointment.dateKey'));
CREATE INDEX bookings_start ON bookings(json_extract(data,'$.appointment.start'));
CREATE INDEX staff_email ON adminUsers(json_extract(data,'$.email'));
CREATE INDEX client_email ON clientUsers(json_extract(data,'$.emailLower'));
CREATE INDEX tenant_email ON tenantUsers(json_extract(data,'$.emailLower'));
CREATE INDEX native_events_resource ON nativeCalendarEvents(json_extract(data,'$.resourceId'),json_extract(data,'$.start'),json_extract(data,'$.end'));
CREATE TABLE auth_identities (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT, created_at INTEGER NOT NULL);
CREATE TABLE login_challenges (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('client','tenant')), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_identities(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE rate_windows (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count >= 0));
CREATE TABLE email_outbox (id TEXT PRIMARY KEY, encrypted_payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, provider_id TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX email_outbox_pending ON email_outbox(state,updated_at);
CREATE TABLE migration_runs (id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, result_sha256 TEXT, state TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE migration_objects (storage_path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, size INTEGER NOT NULL, bucket_class TEXT NOT NULL, verified_at INTEGER);
`);
const sql=lines.join('\n')+'\n';
const path=new URL('../../migrations/cloudflare/0001_platform.sql',import.meta.url);
if(process.argv.includes('--check')){
 const manifest=JSON.parse(readFileSync(new URL('../../migrations/cloudflare/manifest.json',import.meta.url),'utf8'));
 if(createHash('sha256').update(sql).digest('hex')!==manifest.sha256)throw new Error('Generated migration checksum differs from reviewed manifest');
 writeFileSync(path,sql);
}else writeFileSync(path,sql);
console.log(`Cloudflare schema: ${names.length} canonical domain tables`);
