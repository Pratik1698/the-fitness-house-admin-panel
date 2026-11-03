# THE FITNESS HOUSE — AUTH ACCOUNT RECREATION GUIDE
**Target System:** Hosted Supabase Auth (`xfagvgypgboplonokntk`)
**Security Standard:** Zero Hardcoded Secrets, Dynamic Email-Based Identity Binding

---

## 1. Authoritative Production Identities

The following identities have been explicitly confirmed for production:
1. **Primary Administrator:** `pravinjoshi2707@gmail.com`
2. **Operational Staff:** `pratikp5598@gmail.com`

---

## 2. Core Security Rules

> [!CAUTION]
> **STRICT CREDENTIAL SAFETY RULES:**
> 1. **NO Hardcoded Passwords:** Never write passwords or password hashes in SQL or script files.
> 2. **NO Hardcoded UUID Dependencies:** GoTrue generates new random UUIDs upon user creation. All profile linking must dynamically query by `lower(trim(email))`.
> 3. **NO Service-Role Keys in Scripts:** Never expose `SUPABASE_SERVICE_ROLE_KEY`.

---

## 3. Account Specifications

| Attribute | Primary Administrator | Operational Staff |
| :--- | :--- | :--- |
| **Email Address** | `pravinjoshi2707@gmail.com` | `pratikp5598@gmail.com` |
| **Full Name** | The Fitness House Admin | Pratik Joshi |
| **Assigned Role** | `admin` | `staff` |
| **Account Status** | `is_active = true` | `is_active = true` |
| **Creation Method** | Dashboard User Creation + Seed Link | Phase 5 Invitation Lifecycle |

---

## 4. Step-by-Step Recreation Workflow

### Step 1: Create Administrator in Supabase Auth
1. Open the **Supabase Dashboard** -> Select Project `xfagvgypgboplonokntk` -> Navigate to **Authentication** -> **Users**.
2. Click **Add User** -> **Create User**.
3. Enter:
   - **Email:** `pravinjoshi2707@gmail.com`
   - **Password:** Generate a strong temporary password (provide directly to owner through secure channel).
   - **Auto Confirm User:** Checked (Yes).
4. Click **Create User**. GoTrue assigns a new random UUID.

### Step 2: Bootstrap Administrator Profile & Baseline Seed
Once user `pravinjoshi2707@gmail.com` exists in `auth.users`, link their profile using either of the following methods:

#### Recommended Method: Supabase Dashboard SQL Editor
1. Open **Supabase Dashboard** -> Project `xfagvgypgboplonokntk` -> **SQL Editor**.
2. Open and copy the entire contents of `supabase/seed.sql`.
3. Click **Run**.
This establishes gym info, membership packages, reminder settings, and links the active admin profile in a single transaction with zero migration risk.

#### CLI Alternative (Verified CLI 3.0.0 Syntax)
Run from project root:
```powershell
npx supabase db push --remote --include-seed
```
*(Note: Supabase CLI 3.0.0 uses `--include-seed`; the `--seed` flag is invalid).*

#### Standalone Profile Bootstrap SQL
Alternatively, to link only the administrator profile without running the full seed:
```sql
-- Bootstrap Primary Administrator Profile by Confirmed Email
INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    is_active,
    deactivated_at
)
SELECT
    id,
    email,
    'The Fitness House Admin',
    'admin',
    true,
    NULL
FROM auth.users
WHERE lower(trim(email)) = 'pravinjoshi2707@gmail.com'
ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    is_active = true,
    deactivated_at = NULL,
    updated_at = clock_timestamp();
```

### Step 3: Admin Invites Staff (Phase 5 Secure Workflow)
1. Log into the Fitness House Admin Panel as `pravinjoshi2707@gmail.com`.
2. Navigate to **Staff Management** -> Click **Invite Staff Member**.
3. Enter:
   - **Full Name:** `Pratik Joshi`
   - **Email:** `pratikp5598@gmail.com`
4. Click **Send Invitation**.
   - Invokes `create_staff_invitation()` RPC.
   - Dispatches an official Supabase invitation email.
   - Records an entry in `public.security_audit_logs`.

### Step 4: Staff Accepts Invitation
1. Staff member opens the invitation link in their email.
2. They set their password and sign in.
3. Upon acceptance:
   - Trigger `fn_on_auth_user_created()` binds their `auth_user_id`.
   - `accept_staff_invitation()` updates `is_active = true`.
   - Role is strictly locked to `staff`.
