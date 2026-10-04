import { outboundRecipients } from './emailBoundary.js';
import type { TenantRequest, TenantUserRecord } from '../types/tenant.js';
import type { TenantFormRequest } from '../types/tenantForms.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function emailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.TENANT_EMAIL_FROM?.trim() ||
    process.env.BOOKING_EMAIL_FROM?.trim();
  const replyTo =
    process.env.TENANT_EMAIL_REPLY_TO?.trim() ||
    process.env.BOOKING_EMAIL_REPLY_TO?.trim();

  return { apiKey, from, replyTo };
}

export function tenantPortalEmailIsConfigured(): boolean {
  const config = emailConfig();
  return Boolean(config.apiKey && config.from);
}

async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const { apiKey, from, replyTo } = emailConfig();
  if (!apiKey || !from) return;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: outboundRecipients([params.to]),
      subject: params.subject,
      text: params.text,
      html: params.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Tenant email delivery failed with status ${response.status}: ${body.slice(0, 300)}`);
  }
}

export async function sendTenantRequestReceiptEmail(params: {
  tenant: TenantUserRecord;
  request: TenantRequest;
  portalUrl: string;
}) {
  const { tenant, request, portalUrl } = params;
  const status = request.status.replaceAll('_', ' ');

  await sendEmail({
    to: tenant.email,
    subject: `ProInspect request received – ${request.reference}`,
    text: [
      `Hi ${tenant.displayName},`,
      '',
      'Your tenant portal request has been received.',
      `Reference: ${request.reference}`,
      `Request: ${request.title}`,
      `Status: ${status}`,
      '',
      `Tenant Portal: ${portalUrl}`,
      '',
      'ProInspect',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:640px;margin:0 auto;">
        <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect Tenant Portal</div>
          <h1 style="font-size:24px;margin:6px 0 0;">Request received</h1>
        </div>
        <p>Hi ${escapeHtml(tenant.displayName)},</p>
        <p>Your request has been received and is now recorded in the tenant portal.</p>
        <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
          <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Reference</td><td style="padding:10px 14px;">${escapeHtml(request.reference)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Request</td><td style="padding:10px 14px;">${escapeHtml(request.title)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Status</td><td style="padding:10px 14px;text-transform:capitalize;">${escapeHtml(status)}</td></tr>
        </table>
        <p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#007F82;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">Open Tenant Portal</a></p>
      </div>
    `,
  });
}

export async function sendTenantRequestStatusEmail(params: {
  tenant: TenantUserRecord;
  request: TenantRequest;
  portalUrl: string;
}) {
  const { tenant, request, portalUrl } = params;
  const status = request.status.replaceAll('_', ' ');

  await sendEmail({
    to: tenant.email,
    subject: `ProInspect request updated – ${request.reference}`,
    text: [
      `Hi ${tenant.displayName},`,
      '',
      `Your tenant request ${request.reference} has been updated.`,
      `Request: ${request.title}`,
      `Status: ${status}`,
      '',
      `Tenant Portal: ${portalUrl}`,
      '',
      'ProInspect',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:640px;margin:0 auto;">
        <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect Tenant Portal</div>
          <h1 style="font-size:24px;margin:6px 0 0;">Request updated</h1>
        </div>
        <p>Hi ${escapeHtml(tenant.displayName)},</p>
        <p>The status of your tenant request has changed.</p>
        <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
          <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Reference</td><td style="padding:10px 14px;">${escapeHtml(request.reference)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Request</td><td style="padding:10px 14px;">${escapeHtml(request.title)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Status</td><td style="padding:10px 14px;text-transform:capitalize;">${escapeHtml(status)}</td></tr>
        </table>
        <p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#007F82;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">View Request</a></p>
      </div>
    `,
  });
}


export async function sendTenantFormReceiptEmail(params: {
  tenant: TenantUserRecord;
  request: TenantFormRequest;
  portalUrl: string;
}) {
  const { tenant, request, portalUrl } = params;
  const formLabel = request.formCode.startsWith('BOND')
    ? request.formCode.replaceAll('-', ' ')
    : `Form ${request.formCode}`;

  await sendEmail({
    to: tenant.email,
    subject: `ProInspect tenancy form received – ${request.reference}`,
    text: [
      `Hi ${tenant.displayName},`,
      '',
      'Your tenancy form or bond request has been received.',
      `Reference: ${request.reference}`,
      `Workflow: ${formLabel} – ${request.formName}`,
      `Status: ${request.status.replaceAll('_', ' ')}`,
      ...(request.responseDueAt ? [`Response/action date: ${request.responseDueAt}`] : []),
      '',
      `Tenant Portal: ${portalUrl}`,
      '',
      'ProInspect',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:640px;margin:0 auto;">
        <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect Tenant Portal</div>
          <h1 style="font-size:24px;margin:6px 0 0;">Tenancy form received</h1>
        </div>
        <p>Hi ${escapeHtml(tenant.displayName)},</p>
        <p>Your tenancy form or bond request has been received and recorded.</p>
        <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
          <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Reference</td><td style="padding:10px 14px;">${escapeHtml(request.reference)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Workflow</td><td style="padding:10px 14px;">${escapeHtml(formLabel)} – ${escapeHtml(request.formName)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Status</td><td style="padding:10px 14px;text-transform:capitalize;">${escapeHtml(request.status.replaceAll('_', ' '))}</td></tr>
          ${request.responseDueAt ? `<tr><td style="padding:10px 14px;font-weight:700;">Response / action date</td><td style="padding:10px 14px;">${escapeHtml(request.responseDueAt)}</td></tr>` : ''}
        </table>
        <p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#007F82;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">Open Tenant Portal</a></p>
      </div>
    `,
  });
}

export async function sendTenantFormStatusEmail(params: {
  tenant: TenantUserRecord;
  request: TenantFormRequest;
  portalUrl: string;
}) {
  const { tenant, request, portalUrl } = params;
  const formLabel = request.formCode.startsWith('BOND')
    ? request.formCode.replaceAll('-', ' ')
    : `Form ${request.formCode}`;

  await sendEmail({
    to: tenant.email,
    subject: `ProInspect tenancy form updated – ${request.reference}`,
    text: [
      `Hi ${tenant.displayName},`,
      '',
      `Your tenancy form ${request.reference} has been updated.`,
      `Workflow: ${formLabel} – ${request.formName}`,
      `Status: ${request.status.replaceAll('_', ' ')}`,
      '',
      `Tenant Portal: ${portalUrl}`,
      '',
      'ProInspect',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:640px;margin:0 auto;">
        <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect Tenant Portal</div>
          <h1 style="font-size:24px;margin:6px 0 0;">Tenancy form updated</h1>
        </div>
        <p>Hi ${escapeHtml(tenant.displayName)},</p>
        <p>The status of your tenancy form or bond request has changed.</p>
        <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
          <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Reference</td><td style="padding:10px 14px;">${escapeHtml(request.reference)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Workflow</td><td style="padding:10px 14px;">${escapeHtml(formLabel)} – ${escapeHtml(request.formName)}</td></tr>
          <tr><td style="padding:10px 14px;font-weight:700;">Status</td><td style="padding:10px 14px;text-transform:capitalize;">${escapeHtml(request.status.replaceAll('_', ' '))}</td></tr>
        </table>
        <p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#007F82;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">View Tenant Portal</a></p>
      </div>
    `,
  });
}
