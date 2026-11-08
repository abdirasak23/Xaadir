# Supabase Edge Functions

Set these project secrets in **Supabase Dashboard → Edge Functions → Secrets** (function deployment itself can be done in the dashboard; no CLI is required):

- `EDGE_FUNCTION_SECRET` — shared secret for admin-only functions; set the same value in the Next.js server environment.
- `QR_SIGNING_SECRET` — at least 32 random characters used to sign rotating QR tokens.

Supabase automatically supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. Never put the service role key in client-side code.

Deploy or update each standalone function from this directory (or paste its `index.ts` into the Dashboard editor):

```powershell
supabase functions deploy create-company
supabase functions deploy create-company-hr
supabase functions deploy create-staff
supabase functions deploy invite-staff
supabase functions deploy qr-token
supabase functions deploy manual-attendance
supabase functions deploy checkin
supabase functions deploy password-recovery
```

The admin functions require the `x-admin-secret` header. `qr-token` is public but requires the branch's live QR key in its request body. `checkin` is intended for the Flutter app and authenticates the staff access token itself.

`password-recovery` must keep **Verify JWT enabled**. HR code issuance and HR recovery require the server-only `x-admin-secret`. Staff password reset can be called directly from Flutter through `Supabase.functions.invoke("password-recovery", ...)` using the normal Supabase project URL and anon/publishable key; never put `EDGE_FUNCTION_SECRET` or a service-role key in Flutter. Send this body:

```json
{
  "action": "reset",
  "account_type": "staff",
  "email": "staff@example.com",
  "code": "CODE_ISSUED_BY_HR",
  "password": "NewPassword123",
  "password_confirm": "NewPassword123"
}
```

The staff code is generated in the HR panel, expires after 30 minutes, and is single-use. Run `supabase/staff-password-recovery.sql` before enabling this flow. The function validates the code, applies the recovery rate limit, updates the password using the service role, and returns `{ "ok": true }` on success.

For dashboard-only deployment, create/update each function using the matching `supabase/functions/<name>/index.ts` file and configure the same project secrets above.

`create-company` creates the company row and its confirmed Supabase Auth HR user. The initial password is `Xd` plus the phone number's last four digits; only Supabase Auth's password hash is persisted. The plaintext temporary password is returned once to the authenticated developer panel so it can be shared with the HR contact.

`create-company-hr` allows a signed-in HR member to create another HR login for the same active company. It verifies the creating HR membership, creates a separate confirmed Supabase Auth account with a random temporary password, links it to the company, and marks it to require a password change at first sign-in. The temporary password is returned once to the server route and shown to the HR user for secure sharing.
