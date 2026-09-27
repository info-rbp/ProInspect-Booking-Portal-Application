import type {
  BookingRecord,
  BookingReadinessStatus,
  ConfirmationEmailStatus,
} from '../types/booking.js';

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

  const subject = `ProInspect booking confirmed – ${booking.bookingReference}`;
  const text = [
    'Your ProInspect booking is confirmed.',
    '',
    `Reference: ${booking.bookingReference}`,
    `Service: ${booking.serviceName}`,
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
