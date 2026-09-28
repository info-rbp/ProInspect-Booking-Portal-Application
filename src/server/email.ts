import type {
  BookingRecord,
  BookingReadinessStatus,
  ConfirmationEmailStatus,
} from '../types/booking.js';
import type { DocumentRequestRecord } from '../types/documentRequest.js';

export interface ConfirmationEmailResult {
  status: ConfirmationEmailStatus;
  providerMessageId?: string;
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fullAddress(booking: BookingRecord): string {
  return [
    booking.property.unit ? `${booking.property.unit}, ${booking.property.streetAddress}` : booking.property.streetAddress,
    `${booking.property.suburb} ${booking.property.state} ${booking.property.postcode}`,
  ].join(', ');
}

function readinessCopy(status: BookingReadinessStatus): {
  label: string;
  explanation: string;
} {
  if (status === 'pending_notice') {
    return {
      label: 'Pending tenant notice',
      explanation:
        'The appointment has been reserved, but the tenant entry notice is still pending. Please ensure the required notice is issued before attendance.',
    };
  }

  if (status === 'access_action_required') {
    return {
      label: 'Access action required',
      explanation:
        'The appointment has been reserved, but the current access information requires action before ProInspect can attend.',
    };
  }

  return {
    label: 'Ready for attendance',
    explanation: 'The supplied access information is currently marked ready for attendance.',
  };
}

export function bookingEmailIsConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() &&
      process.env.BOOKING_EMAIL_FROM?.trim()
  );
}

export async function sendBookingConfirmationEmail(params: {
  booking: BookingRecord;
  managementUrl: string;
}): Promise<ConfirmationEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BOOKING_EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    return { status: 'not_configured' };
  }

  const { booking, managementUrl } = params;
  const readiness = readinessCopy(booking.readinessStatus || 'ready');
  const address = fullAddress(booking);
  const categoryLabel =
    booking.serviceCategory === 'strata-building'
      ? 'Strata / Building'
      : booking.serviceCategory
        ? booking.serviceCategory.charAt(0).toUpperCase() + booking.serviceCategory.slice(1)
        : 'Legacy / uncategorised';

  const subject = `ProInspect booking confirmed – ${booking.bookingReference}`;
  const text = [
    'Your ProInspect booking is confirmed.',
    '',
    `Reference: ${booking.bookingReference}`,
    `Service: ${booking.serviceName}`,
    `Category: ${categoryLabel}`,
    `Property: ${address}`,
    `Appointment: ${booking.appointment.dateString} at ${booking.appointment.timeString} AWST`,
    `Access status: ${readiness.label}`,
    readiness.explanation,
    '',
    `Manage booking: ${managementUrl}`,
    '',
    'For assistance, reply to this email or contact info@proinspect.systems.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:640px;margin:0 auto;">
      <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
        <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect</div>
        <h1 style="font-size:24px;margin:6px 0 0;color:#1A2B4A;">Booking confirmed</h1>
      </div>

      <p>Your appointment has been reserved in the ProInspect scheduling system.</p>

      <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Reference</td><td style="padding:10px 14px;">${escapeHtml(booking.bookingReference)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Service</td><td style="padding:10px 14px;">${escapeHtml(booking.serviceName)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Category</td><td style="padding:10px 14px;">${escapeHtml(categoryLabel)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Property</td><td style="padding:10px 14px;">${escapeHtml(address)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Appointment</td><td style="padding:10px 14px;">${escapeHtml(booking.appointment.dateString)} at ${escapeHtml(booking.appointment.timeString)} AWST</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Access status</td><td style="padding:10px 14px;">${escapeHtml(readiness.label)}</td></tr>
      </table>

      <div style="padding:14px 16px;background:#eefafa;border:1px solid #b7ecec;border-radius:8px;margin:16px 0;">
        <strong>${escapeHtml(readiness.label)}</strong><br />
        <span style="font-size:14px;color:#334155;">${escapeHtml(readiness.explanation)}</span>
      </div>

      <p style="margin:24px 0;">
        <a href="${escapeHtml(managementUrl)}" style="display:inline-block;background:#007F82;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">View or manage booking</a>
      </p>

      <p style="font-size:13px;color:#64748b;">
        This secure link provides access to the booking summary. Do not forward it to people who should not have access to the booking.
      </p>

      <p style="font-size:13px;color:#64748b;">
        Need help? Contact <a href="mailto:info@proinspect.systems">info@proinspect.systems</a>.
      </p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [booking.property.customerEmail],
        subject,
        html,
        text,
        ...(process.env.BOOKING_EMAIL_REPLY_TO?.trim()
          ? { reply_to: process.env.BOOKING_EMAIL_REPLY_TO.trim() }
          : {}),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      return {
        status: 'failed',
        error:
          body.error?.message ||
          body.message ||
          `Email provider returned status ${response.status}.`,
      };
    }

    return {
      status: 'sent',
      providerMessageId: body.id,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown email delivery error.',
    };
  }
}


function documentRequestAddress(request: DocumentRequestRecord): string {
  return [
    request.details.unit
      ? `${request.details.unit}, ${request.details.streetAddress}`
      : request.details.streetAddress,
    `${request.details.suburb} ${request.details.state} ${request.details.postcode}`,
  ].join(', ');
}

async function sendResendEmail(input: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<ConfirmationEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BOOKING_EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    return { status: 'not_configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(process.env.BOOKING_EMAIL_REPLY_TO?.trim()
          ? { reply_to: process.env.BOOKING_EMAIL_REPLY_TO.trim() }
          : {}),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      return {
        status: 'failed',
        error:
          body.error?.message ||
          body.message ||
          `Email provider returned status ${response.status}.`,
      };
    }

    return {
      status: 'sent',
      providerMessageId: body.id,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown email delivery error.',
    };
  }
}

export async function sendDocumentRequestEmails(
  request: DocumentRequestRecord
): Promise<{
  customer: ConfirmationEmailResult;
  internal: ConfirmationEmailResult;
}> {
  const address = documentRequestAddress(request);
  const categoryLabel =
    request.documentCategory === 'strata-building'
      ? 'Strata / Building'
      : request.documentCategory.charAt(0).toUpperCase() +
        request.documentCategory.slice(1);

  const customerText = [
    'Your ProInspect document request has been received.',
    '',
    `Reference: ${request.requestReference}`,
    `Document: ${request.documentName}`,
    `Category: ${categoryLabel}`,
    `Property: ${address}`,
    `Scheduled fee: $${request.priceExGst} + GST`,
    '',
    'ProInspect will review the supplied details before the document is prepared or distributed.',
    '',
    'For assistance, reply to this email or contact info@proinspect.systems.',
  ].join('\n');

  const customerHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:640px;margin:0 auto;">
      <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
        <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect</div>
        <h1 style="font-size:24px;margin:6px 0 0;color:#1A2B4A;">Document request received</h1>
      </div>
      <p>Your request has been recorded for review by ProInspect.</p>
      <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Reference</td><td style="padding:10px 14px;">${escapeHtml(request.requestReference)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Document</td><td style="padding:10px 14px;">${escapeHtml(request.documentName)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Category</td><td style="padding:10px 14px;">${escapeHtml(categoryLabel)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Property</td><td style="padding:10px 14px;">${escapeHtml(address)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Scheduled fee</td><td style="padding:10px 14px;">$${request.priceExGst} + GST</td></tr>
      </table>
      <p style="font-size:14px;color:#334155;">ProInspect will review the supplied details before the document is prepared or distributed.</p>
      <p style="font-size:13px;color:#64748b;">Need help? Contact <a href="mailto:info@proinspect.systems">info@proinspect.systems</a>.</p>
    </div>
  `;

  const internalText = [
    'New ProInspect document request.',
    '',
    `Reference: ${request.requestReference}`,
    `Document: ${request.documentName}`,
    `Category: ${categoryLabel}`,
    `Property: ${address}`,
    `Contact: ${request.details.customerName}`,
    `Email: ${request.details.customerEmail}`,
    `Phone: ${request.details.customerPhone}`,
    request.details.clientName ? `Client/agency: ${request.details.clientName}` : '',
    request.details.clientReference ? `Reference: ${request.details.clientReference}` : '',
    request.details.notes ? `Instructions: ${request.details.notes}` : '',
    `Scheduled fee: $${request.priceExGst} + GST`,
  ].filter(Boolean).join('\n');

  const internalHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:700px;margin:0 auto;">
      <h1 style="font-size:22px;">New document request</h1>
      <p><strong>${escapeHtml(request.requestReference)}</strong></p>
      <p><strong>Document:</strong> ${escapeHtml(request.documentName)}</p>
      <p><strong>Category:</strong> ${escapeHtml(categoryLabel)}</p>
      <p><strong>Property:</strong> ${escapeHtml(address)}</p>
      <p><strong>Contact:</strong> ${escapeHtml(request.details.customerName)} · ${escapeHtml(request.details.customerEmail)} · ${escapeHtml(request.details.customerPhone)}</p>
      ${request.details.clientName ? `<p><strong>Client/agency:</strong> ${escapeHtml(request.details.clientName)}</p>` : ''}
      ${request.details.clientReference ? `<p><strong>Client reference:</strong> ${escapeHtml(request.details.clientReference)}</p>` : ''}
      ${request.details.notes ? `<p><strong>Instructions:</strong><br />${escapeHtml(request.details.notes)}</p>` : ''}
      <p><strong>Scheduled fee:</strong> $${request.priceExGst} + GST</p>
    </div>
  `;

  const notifyTo =
    process.env.DOCUMENT_REQUEST_NOTIFY_TO?.trim() || 'info@proinspect.systems';

  const [customer, internal] = await Promise.all([
    sendResendEmail({
      to: [request.details.customerEmail],
      subject: `ProInspect document request received – ${request.requestReference}`,
      html: customerHtml,
      text: customerText,
    }),
    sendResendEmail({
      to: [notifyTo],
      subject: `New document request – ${request.requestReference}`,
      html: internalHtml,
      text: internalText,
    }),
  ]);

  return { customer, internal };
}


export async function sendClientPortalInvitationEmail(params: {
  email: string;
  organisationName: string;
  invitedByName: string;
  role: string;
  signInUrl: string;
}): Promise<ConfirmationEmailResult> {
  const roleLabel =
    params.role.charAt(0).toUpperCase() + params.role.slice(1).toLowerCase();

  const text = [
    'You have been invited to the ProInspect Client Portal.',
    '',
    `Organisation: ${params.organisationName}`,
    `Portal role: ${roleLabel}`,
    `Invited by: ${params.invitedByName}`,
    '',
    `Sign in: ${params.signInUrl}`,
    '',
    'Use this same email address when signing in so the invitation can be linked to your account.',
    '',
    'For assistance, contact info@proinspect.systems.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:640px;margin:0 auto;">
      <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
        <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect</div>
        <h1 style="font-size:24px;margin:6px 0 0;color:#1A2B4A;">Client Portal invitation</h1>
      </div>

      <p>You have been invited to access the ProInspect Client Portal for <strong>${escapeHtml(params.organisationName)}</strong>.</p>

      <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Organisation</td><td style="padding:10px 14px;">${escapeHtml(params.organisationName)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Portal role</td><td style="padding:10px 14px;">${escapeHtml(roleLabel)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Invited by</td><td style="padding:10px 14px;">${escapeHtml(params.invitedByName)}</td></tr>
      </table>

      <p style="margin:24px 0;">
        <a href="${escapeHtml(params.signInUrl)}" style="display:inline-block;background:#007F82;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">Open Client Portal</a>
      </p>

      <p style="font-size:13px;color:#64748b;">
        Sign in using <strong>${escapeHtml(params.email)}</strong>. The invitation is linked to this email address and will be activated when the verified account signs in.
      </p>

      <p style="font-size:13px;color:#64748b;">
        Need help? Contact <a href="mailto:info@proinspect.systems">info@proinspect.systems</a>.
      </p>
    </div>
  `;

  return sendResendEmail({
    to: [params.email],
    subject: `ProInspect Client Portal invitation – ${params.organisationName}`,
    html,
    text,
  });
}


export async function sendClientPortalRequestNotification(params: {
  requestId: string;
  requestType: 'document' | 'maintenance' | 'general';
  title: string;
  organisationName: string;
  submittedByName: string;
  submittedByEmail: string;
  propertyAddress?: string;
  priority?: string;
  staffUrl: string;
}): Promise<ConfirmationEmailResult> {
  const typeLabel =
    params.requestType === 'maintenance'
      ? 'Maintenance request'
      : params.requestType === 'document'
        ? 'Document request'
        : 'Client request';

  const notifyTo =
    process.env.DOCUMENT_REQUEST_NOTIFY_TO?.trim() || 'info@proinspect.systems';

  const text = [
    `New ProInspect Client Portal ${typeLabel.toLowerCase()}.`,
    '',
    `Request: ${params.requestId}`,
    `Organisation: ${params.organisationName}`,
    `Submitted by: ${params.submittedByName} <${params.submittedByEmail}>`,
    params.propertyAddress ? `Property: ${params.propertyAddress}` : '',
    params.priority ? `Priority: ${params.priority}` : '',
    `Title: ${params.title}`,
    '',
    `Staff Portal: ${params.staffUrl}`,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1A2B4A;line-height:1.5;max-width:700px;margin:0 auto;">
      <div style="border-bottom:4px solid #00B5B8;padding:20px 0 16px;">
        <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#007F82;">ProInspect</div>
        <h1 style="font-size:22px;margin:6px 0 0;">New ${escapeHtml(typeLabel)}</h1>
      </div>
      <table role="presentation" style="border-collapse:collapse;width:100%;margin:20px 0;background:#f8fafc;border:1px solid #e2e8f0;">
        <tr><td style="padding:10px 14px;font-weight:700;width:34%;">Request</td><td style="padding:10px 14px;">${escapeHtml(params.requestId)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Organisation</td><td style="padding:10px 14px;">${escapeHtml(params.organisationName)}</td></tr>
        <tr><td style="padding:10px 14px;font-weight:700;">Submitted by</td><td style="padding:10px 14px;">${escapeHtml(params.submittedByName)} · ${escapeHtml(params.submittedByEmail)}</td></tr>
        ${params.propertyAddress ? `<tr><td style="padding:10px 14px;font-weight:700;">Property</td><td style="padding:10px 14px;">${escapeHtml(params.propertyAddress)}</td></tr>` : ''}
        ${params.priority ? `<tr><td style="padding:10px 14px;font-weight:700;">Priority</td><td style="padding:10px 14px;">${escapeHtml(params.priority)}</td></tr>` : ''}
        <tr><td style="padding:10px 14px;font-weight:700;">Title</td><td style="padding:10px 14px;">${escapeHtml(params.title)}</td></tr>
      </table>
      <p><a href="${escapeHtml(params.staffUrl)}" style="display:inline-block;background:#007F82;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:8px;">Open ProInspect</a></p>
    </div>
  `;

  return sendResendEmail({
    to: [notifyTo],
    subject: `New Client Portal ${typeLabel.toLowerCase()} – ${params.organisationName}`,
    html,
    text,
  });
}
