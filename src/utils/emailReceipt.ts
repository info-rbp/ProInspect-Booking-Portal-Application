/**
 * Professional HTML Email Receipt & Calendar Invite Generator
 * ProInspect Systems - Western Australia Property Inspections
 */

import { BookingRecord } from '../types/booking';

/**
 * Format dates into iCal UTC format: YYYYMMDDTHHmmssZ
 */
function formatToUtcIcsDate(dateInput: string | Date): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Generates direct Google Calendar add-to-calendar URL
 */
export function generateGoogleCalendarUrl(booking: BookingRecord): string {
  const unitText = booking.property.unit ? `${booking.property.unit}, ` : '';
  const fullAddress = `${unitText}${booking.property.streetAddress}, ${booking.property.suburb} ${booking.property.state || 'WA'} ${booking.property.postcode}`;
  const title = `${booking.serviceName} | ${fullAddress}`;

  const startUtc = formatToUtcIcsDate(booking.appointment.start);
  const endUtc = formatToUtcIcsDate(booking.appointment.end);
  const dates = `${startUtc}/${endUtc}`;

  const detailsLines: string[] = [
    `PROINSPECT BOOKING REFERENCE: ${booking.bookingReference}`,
    `Service: ${booking.serviceName}`,
    `Scheduled: ${booking.appointment.dateString} at ${booking.appointment.timeString} AWST`,
    `Property: ${fullAddress}`,
    `Contact: ${booking.property.customerName} (${booking.property.customerPhone})`,
    `Access: ${booking.access.method.replace('_', ' ').toUpperCase()}`,
  ];

  if (booking.access.method === 'tenant' && booking.access.tenant) {
    detailsLines.push(`Tenant: ${booking.access.tenant.tenantName} - ${booking.access.tenant.tenantPhone}`);
    if (booking.access.tenant.noticeIssued) {
      detailsLines.push(`Notice: ${booking.access.tenant.noticeIssued === 'yes' ? 'Issued' : 'Pending'}`);
    }
  }

  if (booking.access.specialInstructions) {
    detailsLines.push(`Special Instructions: ${booking.access.specialInstructions}`);
  }

  detailsLines.push('');
  detailsLines.push('ProInspect Systems • Western Australia');
  detailsLines.push('https://proinspect.systems | info@remotebusinesspartner.com.au');

  const details = detailsLines.join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: dates,
    details: details,
    location: fullAddress,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generates RFC 5545 compliant iCalendar (.ics) string for Outlook, Apple Calendar, etc.
 */
export function generateIcsCalendarContent(booking: BookingRecord): string {
  const unitText = booking.property.unit ? `${booking.property.unit}, ` : '';
  const fullAddress = `${unitText}${booking.property.streetAddress}, ${booking.property.suburb} ${booking.property.state || 'WA'} ${booking.property.postcode}`;
  const title = `${booking.serviceName} | ${fullAddress}`;

  const startUtc = formatToUtcIcsDate(booking.appointment.start);
  const endUtc = formatToUtcIcsDate(booking.appointment.end);
  const nowUtc = formatToUtcIcsDate(new Date());

  const description = [
    `BOOKING REFERENCE: ${booking.bookingReference}`,
    `Service: ${booking.serviceName}`,
    `Property: ${fullAddress}`,
    `Customer: ${booking.property.customerName} (${booking.property.customerPhone})`,
    `Access Method: ${booking.access.method}`,
    booking.access.specialInstructions ? `Special Instructions: ${booking.access.specialInstructions}` : '',
    'ProInspect Systems WA - https://proinspect.systems',
  ]
    .filter(Boolean)
    .join('\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ProInspect Systems//Booking Hub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${booking.bookingReference}@proinspect.systems`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${fullAddress}`,
    'STATUS:CONFIRMED',
    'ORGANIZER;CN=ProInspect Systems:mailto:info@remotebusinesspartner.com.au',
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=${booking.property.customerName}:mailto:${booking.property.customerEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Generates a complete, professional, responsive HTML email receipt with inline CSS.
 */
export function generateEmailReceiptHtml(booking: BookingRecord): string {
  const googleCalendarUrl = generateGoogleCalendarUrl(booking);

  const unitPrefix = booking.property.unit ? `${booking.property.unit}, ` : '';
  const fullAddress = `${unitPrefix}${booking.property.streetAddress}, ${booking.property.suburb} ${booking.property.state || 'WA'} ${booking.property.postcode}`;

  const accessMethodLabels: Record<string, string> = {
    tenant: 'Tenant will provide access',
    meet_onsite: 'Meet someone onsite',
    keys_agency: 'Keys held at agency',
    keys_proinspect: 'Keys held by ProInspect',
    lockbox: 'Lockbox on site',
    vacant: 'Property is vacant / open access',
    other: 'Other arrangement',
  };

  const accessLabel = accessMethodLabels[booking.access.method] || booking.access.method;

  // Build Access details rows
  let accessRowsHtml = `
    <tr>
      <td style="padding: 8px 0; color: #64748B; font-size: 13px; font-weight: 500; width: 140px;">Access Method:</td>
      <td style="padding: 8px 0; color: #0F172A; font-size: 14px; font-weight: 600;">${accessLabel}</td>
    </tr>
  `;

  if (booking.access.method === 'tenant' && booking.access.tenant) {
    accessRowsHtml += `
      <tr>
        <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Tenant Contact:</td>
        <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.access.tenant.tenantName} (${booking.access.tenant.tenantPhone})</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Entry Notice:</td>
        <td style="padding: 6px 0; color: #059669; font-size: 13px; font-weight: 600;">
          ${booking.access.tenant.noticeIssued === 'yes' ? 'Notice Issued' : 'Pending'}${booking.access.tenant.noticeDate ? ` on ${booking.access.tenant.noticeDate}` : ''}
        </td>
      </tr>
    `;
    if (booking.access.tenant.accessRestrictions) {
      accessRowsHtml += `
        <tr>
          <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Restrictions:</td>
          <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.access.tenant.accessRestrictions}</td>
        </tr>
      `;
    }
  } else if (booking.access.method === 'meet_onsite' && booking.access.meetOnsite) {
    accessRowsHtml += `
      <tr>
        <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Onsite Contact:</td>
        <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.access.meetOnsite.contactName} (${booking.access.meetOnsite.contactPhone}) - ${booking.access.meetOnsite.relationship}</td>
      </tr>
    `;
  } else if (booking.access.method === 'keys_agency' && booking.access.agencyKeys) {
    accessRowsHtml += `
      <tr>
        <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Agency:</td>
        <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.access.agencyKeys.agencyName}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Pickup Address:</td>
        <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.access.agencyKeys.collectionAddress}</td>
      </tr>
    `;
  } else if (booking.access.method === 'lockbox' && booking.access.lockbox) {
    accessRowsHtml += `
      <tr>
        <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Lockbox Location:</td>
        <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.access.lockbox.location}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Lockbox Code:</td>
        <td style="padding: 6px 0; color: #0F172A; font-size: 13px; font-family: monospace; font-weight: bold;">•••• (Secured in Work Order)</td>
      </tr>
    `;
  }

  const specialInstructionsSection = booking.access.specialInstructions
    ? `
      <div style="margin-top: 20px; padding: 14px 16px; background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px;">
        <div style="font-size: 11px; font-weight: 700; color: #B45309; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">
          Special Attendance & Property Notes
        </div>
        <div style="font-size: 13px; color: #78350F; line-height: 1.5; white-space: pre-line;">
          ${booking.access.specialInstructions}
        </div>
      </div>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ProInspect Booking Confirmation - ${booking.bookingReference}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
    Your ProInspect property inspection is confirmed for ${booking.appointment.dateString} at ${booking.appointment.timeString} AWST. Reference: ${booking.bookingReference}.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F1F5F9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08); border: 1px solid #E2E8F0;">
          
          <!-- Brand Header -->
          <tr>
            <td style="background-color: #0A2540; padding: 24px 32px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <div style="display: inline-block; vertical-align: middle;">
                      <div style="font-size: 22px; font-weight: 900; letter-spacing: -0.5px; color: #FFFFFF; line-height: 1;">
                        PRO<span style="color: #38BDF8;">INSPECT</span>
                      </div>
                      <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #94A3B8; margin-top: 3px;">
                        Property Inspections &bull; Western Australia
                      </div>
                    </div>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; padding: 4px 10px; background-color: rgba(56, 189, 248, 0.15); color: #38BDF8; font-size: 11px; font-weight: 700; border-radius: 9999px; border: 1px solid rgba(56, 189, 248, 0.3);">
                      Confirmed Booking
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Banner Intro -->
          <tr>
            <td style="padding: 28px 32px 16px 32px; background-color: #FFFFFF;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #0A2540; letter-spacing: -0.3px;">
                Inspection Appointment Confirmed
              </h1>
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #475569; line-height: 1.5;">
                Thank you for scheduling with ProInspect. Your appointment has been reserved in our operational calendar.
              </p>
            </td>
          </tr>

          <!-- Booking Reference Card -->
          <tr>
            <td style="padding: 0 32px 20px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 14px 18px;">
                <tr>
                  <td>
                    <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px;">
                      ProInspect Booking Reference
                    </div>
                    <div style="font-size: 20px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 800; color: #0A2540; margin-top: 2px;">
                      ${booking.bookingReference}
                    </div>
                  </td>
                  <td align="right">
                    <span style="font-size: 12px; font-weight: 700; color: #0284C7; text-decoration: none;">
                      Western Australia (AWST)
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Appointment Hero Box -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0A2540; border-radius: 10px; padding: 22px; color: #FFFFFF;">
                <tr>
                  <td>
                    <div style="font-size: 12px; font-weight: 700; color: #38BDF8; text-transform: uppercase; letter-spacing: 0.5px;">
                      Scheduled Inspection
                    </div>
                    <div style="font-size: 18px; font-weight: 800; color: #FFFFFF; margin: 4px 0 12px 0;">
                      ${booking.serviceName}
                    </div>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="color: #E2E8F0; font-size: 14px; font-weight: 600; padding-right: 16px;">
                          📅 ${booking.appointment.dateString}
                        </td>
                        <td style="color: #E2E8F0; font-size: 14px; font-weight: 600;">
                          ⏰ ${booking.appointment.timeString} AWST (${booking.appointment.durationMinutes} mins)
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Primary Call to Action: Calendar Invite Links -->
          <tr>
            <td style="padding: 0 32px 24px 32px;" align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 8px;">
                    <a href="${googleCalendarUrl}" target="_blank" rel="noopener noreferrer" style="display: block; width: 100%; max-width: 320px; background-color: #0284C7; color: #FFFFFF; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.25);">
                      📅 Add to Google Calendar
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <span style="font-size: 11px; color: #64748B;">
                      A calendar invitation has also been dispatched to <strong>${booking.property.customerEmail}</strong>.
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Property & Customer Details -->
          <tr>
            <td style="padding: 0 32px 20px 32px;">
              <div style="border-top: 1px solid #E2E8F0; padding-top: 18px; margin-bottom: 12px;">
                <h3 style="margin: 0; font-size: 13px; font-weight: 800; color: #0A2540; text-transform: uppercase; letter-spacing: 0.5px;">
                  Property & Contact Details
                </h3>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding: 6px 0; color: #64748B; font-size: 13px; width: 140px;">Property Address:</td>
                  <td style="padding: 6px 0; color: #0F172A; font-size: 14px; font-weight: 700;">${fullAddress}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Property Type:</td>
                  <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.property.propertyType}</td>
                </tr>
                ${booking.property.clientName ? `
                <tr>
                  <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Managing Agency:</td>
                  <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.property.clientName} ${booking.property.clientReference ? `(Ref: ${booking.property.clientReference})` : ''}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Booked By:</td>
                  <td style="padding: 6px 0; color: #0F172A; font-size: 13px; font-weight: 600;">${booking.property.customerName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748B; font-size: 13px;">Contact Phone:</td>
                  <td style="padding: 6px 0; color: #0F172A; font-size: 13px;">${booking.property.customerPhone}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Access Arrangements -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <div style="border-top: 1px solid #E2E8F0; padding-top: 18px; margin-bottom: 12px;">
                <h3 style="margin: 0; font-size: 13px; font-weight: 800; color: #0A2540; text-transform: uppercase; letter-spacing: 0.5px;">
                  Access Arrangements
                </h3>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${accessRowsHtml}
              </table>

              ${specialInstructionsSection}
            </td>
          </tr>

          <!-- Operational Assistance -->
          <tr>
            <td style="padding: 20px 32px; background-color: #F8FAFC; border-top: 1px solid #E2E8F0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size: 12px; color: #475569; line-height: 1.5;">
                    <strong>Need to modify your appointment?</strong><br>
                    Please reference booking <strong>${booking.bookingReference}</strong> and contact our team at
                    <a href="mailto:info@remotebusinesspartner.com.au" style="color: #0284C7; font-weight: 600; text-decoration: none;">info@remotebusinesspartner.com.au</a>.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0A2540; padding: 24px 32px; text-align: center; color: #94A3B8; font-size: 11px; line-height: 1.6;">
              <div style="font-weight: 700; color: #FFFFFF; font-size: 12px; margin-bottom: 4px;">
                ProInspect Systems Western Australia
              </div>
              <div>Perth Metropolitan &bull; Commercial &bull; Residential Tenancies</div>
              <div style="margin: 8px 0;">
                <a href="https://proinspect.systems" target="_blank" style="color: #38BDF8; text-decoration: none;">proinspect.systems</a> &bull;
                <a href="mailto:info@remotebusinesspartner.com.au" style="color: #38BDF8; text-decoration: none;">info@remotebusinesspartner.com.au</a>
              </div>
              <div style="color: #64748B; font-size: 10px; margin-top: 8px;">
                &copy; ${new Date().getFullYear()} ProInspect Systems. ABN 48 629 192 481. All rights reserved.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
