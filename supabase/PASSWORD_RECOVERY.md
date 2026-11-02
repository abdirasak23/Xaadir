# Password recovery rollout

1. Run `supabase/password-recovery.sql` in the Supabase SQL Editor. It creates the one-time HR-code store and atomic rate-limit/code-consumption functions. The tables are service-role only.
2. Deploy the function: `supabase functions deploy password-recovery`.
3. Confirm the Edge Function has `EDGE_FUNCTION_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` configured. The web server also needs `EDGE_FUNCTION_SECRET`; the secret is never sent to the browser.
4. Deploy the Next.js app. A signed-in developer admin can issue an HR reset code from the Companies table. Codes are displayed once, expire in 30 minutes, and issuing a new code invalidates prior codes for that HR account.

HRs reset from `/forgot-password` using their email and one-time code. The web page is HR-only. The Flutter app can use the staff recovery API when its reset screen is implemented:

```http
POST /api/auth/recover
Content-Type: application/json

{
  "account_type": "staff",
  "email": "staff@example.com",
  "code": "CURRENT_INVITE_CODE",
  "password": "NewStrongPassword123",
  "password_confirm": "NewStrongPassword123"
}
```

Use `account_type: "hr"` and the developer-issued code for HR accounts. Passwords must be at least 12 characters with uppercase, lowercase, and a number. The endpoint returns `{ "ok": true }` when successful; failures use a generic recovery error. Staff recovery clears the invite code after success, so HR must issue a fresh invitation code for another staff reset. The endpoint limits attempts to five per normalized email/account type per 15-minute window.
