"""One-time, idempotent source migration confined to reviewed browser surfaces.
No cloud APIs, credentials, deployment or database writes are used.
"""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SESSION = ROOT / 'src/services/session'
for file in (ROOT / 'src').rglob('*.tsx'):
    text = file.read_text()
    relative = os.path.relpath(SESSION, file.parent).replace(os.sep, '/')
    if not relative.startswith('.'): relative = './' + relative
    text = text.replace("from 'firebase/auth'", "from '" + relative + "'")
    text = text.replace('Google Calendar', 'ProInspect calendar').replace('Google Workspace account', 'authorised staff identity').replace('Google Maps', 'Manual address entry')
    file.write_text(text)
file=ROOT/'src/App.tsx'
text=file.read_text().replace("if (pathname === '/signin') return 'signin';", "if (pathname === '/signin') return 'client';")
file.write_text(text)
file=ROOT/'src/components/tenant/TenantPortal.tsx'
text=file.read_text()
start='    if (authUser || !tenantEmailLinkIsActive()) return;'
end='  }, []);'
if start in text:
    a=text.index(start);b=text.index(end,a)
    text=text[:a]+'    if (!authUser && tenantEmailLinkIsActive()) setNeedsCompletionEmail(true);\n'+text[b:]
file.write_text(text)
file=ROOT/'src/types/booking.ts'
text=file.read_text().replace("export type ConfirmationEmailStatus = 'sent' | 'failed' | 'not_configured';", "export type ConfirmationEmailStatus = 'queued' | 'sent' | 'failed' | 'not_configured';")
file.write_text(text)
file=ROOT/'src/components/wizard/StepConfirmation.tsx'
text=file.read_text()
anchor='      {/* Booking Reference Box */}'
addition='      {booking.managementToken && <a className="block text-center font-bold text-teal-800 underline" href={`/api/bookings/manage/${encodeURIComponent(booking.managementToken)}/calendar`}>Add this appointment to your calendar</a>}\n'
if addition not in text:
    if anchor not in text: raise RuntimeError('Confirmation anchor changed')
    text=text.replace(anchor,addition+anchor)
file.write_text(text)
print('Browser sources adapted to Cloudflare sessions and native scheduling.')
