# Supabase Edge Functions

Set these project secrets in **Supabase Dashboard → Edge Functions → Secrets** (function deployment itself can be done in the dashboard; no CLI is required):

- `EDGE_FUNCTION_SECRET` — shared secret for admin-only functions; set the same value in the Next.js server environment.
- `QR_SIGNING_SECRET` — at least 32 random characters used to sign rotating QR tokens.

Supabase automatically supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. Never put the service role key in client-side code.

Deploy or update each standalone function from this directory (or paste its `index.ts` into the Dashboard editor):

```powershell
supabase functions deploy create-company
supabase functions deploy create-staff
supabase functions deploy invite-staff
supabase functions deploy qr-token
supabase functions deploy manual-attendance
supabase functions deploy checkin
```

The admin functions require the `x-admin-secret` header. `qr-token` is public but requires the branch's live QR key in its request body. `checkin` is intended for the Flutter app and authenticates the staff access token itself.

For dashboard-only deployment, create/update each function using the matching `supabase/functions/<name>/index.ts` file and configure the same project secrets above.

`create-company` creates the company row and its confirmed Supabase Auth HR user. The initial password is `Xd` plus the phone number's last four digits; only Supabase Auth's password hash is persisted. The plaintext temporary password is returned once to the authenticated developer panel so it can be shared with the HR contact.
