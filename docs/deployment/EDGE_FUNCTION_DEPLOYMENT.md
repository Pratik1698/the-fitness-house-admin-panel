# THE FITNESS HOUSE — EDGE FUNCTION DEPLOYMENT GUIDE
**Project Reference:** `xfagvgypgboplonokntk`
**Runtime:** Supabase Edge Runtime (Deno)
**Security Standard:** Strict Authorization, Security Definer Scoping, Audited Privileges

---

## 1. Overview of Edge Functions

The Fitness House Admin Panel includes two audited Supabase Edge Functions in `supabase/functions/`:

| Function Name | Source Directory | Primary Purpose | Security Gate |
| :--- | :--- | :--- | :--- |
| **`invite-staff`** | `supabase/functions/invite-staff/` | Manages staff invitation lifecycle (`invite`, `resend`, `revoke`, `accept`), dispatches invite emails via Supabase GoTrue, records audit entries. | Admin caller required for `invite`/`resend`/`revoke`; Authenticated staff required for `accept`. |
| **`manage-staff-session`** | `supabase/functions/manage-staff-session/` | Manages staff account status (`deactivate_and_revoke`, `reactivate`) and invalidates active refresh tokens via Supabase Admin API. | Strictly active administrator required (`is_admin() = true`). |

---

## 2. Secrets & Environment Variables

> [!IMPORTANT]
> The Supabase Edge Runtime automatically provisions the following default environment variables in every deployed function. **Never expose or print their values.**

### Standard Runtime Environment Variables
1. **`SUPABASE_URL`**: The hosted project URL (`https://xfagvgypgboplonokntk.supabase.co`). Automatically injected.
2. **`SUPABASE_ANON_KEY`**: The project public anon key. Automatically injected.
3. **`SUPABASE_SERVICE_ROLE_KEY`**: The privileged administrative key. Automatically injected into the Edge Runtime environment.

### Optional Custom Secrets
If external notification gateways or SMTP services are added in the future, set them via CLI:
```powershell
# Format for setting custom secrets (example names only; never print values)
supabase secrets set CUSTOM_VARIABLE_NAME=value --project-ref xfagvgypgboplonokntk
```
Currently, both functions rely exclusively on standard injected Supabase credentials.

---

## 3. Allowed CORS Origins

Both functions implement strict CORS handling. Approved frontend origins:
- `http://localhost:5173` (Local development)
- `http://127.0.0.1:5173` (Local IP development)
- `https://the-fitness-house-admin-panel.vercel.app` (Production web app)

*Any unlisted origin defaults safely to `http://127.0.0.1:5173` for redirect links.*

---

## 4. Deployment Commands

Execute deployment from the project root `D:\The_Fitness_house_admin_Panel`:

### 4.1 Deploy Function: `invite-staff`
```powershell
supabase functions deploy invite-staff --project-ref xfagvgypgboplonokntk
```

### 4.2 Deploy Function: `manage-staff-session`
```powershell
supabase functions deploy manage-staff-session --project-ref xfagvgypgboplonokntk
```

---

## 5. Deployment Verification Commands

After deployment, test that both functions respond correctly to preflight CORS and enforce authentication gates.

### Test 1: CORS Preflight Check (`invite-staff`)
```powershell
Invoke-WebRequest -Uri "https://xfagvgypgboplonokntk.supabase.co/functions/v1/invite-staff" `
  -Method OPTIONS `
  -Headers @{
    "Origin" = "https://the-fitness-house-admin-panel.vercel.app";
    "Access-Control-Request-Method" = "POST";
  }
```
- **Expected Status:** `200 OK`
- **Expected Header:** `Access-Control-Allow-Origin: *`

### Test 2: Unauthenticated Rejection (`invite-staff`)
```powershell
Invoke-RestMethod -Uri "https://xfagvgypgboplonokntk.supabase.co/functions/v1/invite-staff" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"action":"invite","email":"test@example.com"}' `
  -SkipHttpErrorCheck -StatusCodeVariable statusCode
```
- **Expected Status:** `401 Unauthorized`
- **Expected Body:** `{"error":"Missing authorization header"}`

### Test 3: Unauthenticated Rejection (`manage-staff-session`)
```powershell
Invoke-RestMethod -Uri "https://xfagvgypgboplonokntk.supabase.co/functions/v1/manage-staff-session" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"action":"deactivate_and_revoke","targetUserId":"449e7fbc-42a0-42a0-970a-40186c14b653"}' `
  -SkipHttpErrorCheck -StatusCodeVariable statusCode
```
- **Expected Status:** `401 Unauthorized`
- **Expected Body:** `{"error":"Missing authorization header"}`

---

## 6. Edge Function Rollback

If a function regression occurs:
Functions can be redeployed instantly to a known stable git commit using the identical `supabase functions deploy` command.
