# Capptastical Cleaning — website

A 4-page car wash site: Home, About, Booking (calendar + discount codes),
and an Admin panel — backed by **Supabase** (Postgres + Auth + Row Level
Security). Real Google sign-in, real database, no localStorage.

```
index.html          Home page
about.html           About page
booking.html          Booking flow (details → date/time → discount → confirm)
admin.html             Staff sign-in (Google) + dashboard
css/styles.css          All styling, shared across pages
js/supabase-config.js    Your project URL + anon key go here
js/db.js                  Data layer — every function calls Supabase
js/main.js                 Floating "Book a wash" bubble
js/booking.js                Booking flow logic
js/admin.js                   Admin dashboard logic
supabase/schema.sql            Run this once in your Supabase project
```

## How the pieces fit together

- **Database**: Postgres tables `discount_codes`, `blackout_dates`,
  `bookings`, `admin_users` — created by `supabase/schema.sql`.
- **Authorization**: Row Level Security policies on every table mean the
  database itself refuses writes from anyone who isn't a verified admin —
  it's not just a hidden button in the UI.
- **Business logic that shouldn't be trusted to the browser** (discount
  validity, blackout checks, slot availability, final price) runs inside
  Postgres functions (`validate_and_apply_discount`, `create_booking`), not
  in `js/booking.js`. The browser just calls them and shows the result.
- **Sign-in**: Supabase Auth handles the real Google OAuth redirect and
  token verification. The app only asks Supabase "is this verified user an
  admin?" — it never trusts an email the browser hands it directly.

## Setup — do these in order

### 1. Create your Supabase project
1. Go to [supabase.com](https://supabase.com) → New project.
2. Once it's ready, go to **Project Settings → API** and copy the
   **Project URL** and **anon public** key.
3. Paste them into `js/supabase-config.js`:
   ```js
   const SUPABASE_URL = 'https://your-project-ref.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-public-key';
   ```
   The anon key is *meant* to be public/shipped in front-end code — it's
   safe because RLS locks down every table. Never put the **service_role**
   key anywhere in this front-end code; it bypasses RLS entirely.

### 2. Run the database schema
1. In your Supabase project, open **SQL Editor → New query**.
2. Paste in the entire contents of `supabase/schema.sql` and click **Run**.
3. This creates all four tables, their RLS policies, the server-side
   functions, and seeds a couple of sample discount codes and blackout
   dates so you can try things immediately.

### 3. Set up Google sign-in
1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** (Web application type).
2. Add your Supabase callback URL as an authorized redirect URI — find the
   exact URL in Supabase under **Authentication → Providers → Google**
   (it looks like `https://your-project-ref.supabase.co/auth/v1/callback`).
3. Copy the **Client ID** and **Client Secret** from Google into Supabase's
   **Authentication → Providers → Google** screen, and enable that provider.
4. In **Authentication → URL Configuration**, add the URL(s) where you'll
   host this site (e.g. `https://yourdomain.com/admin.html`, and
   `http://localhost:PORT/admin.html` for local testing) to the allowed
   redirect list.

### 4. Add your first admin
RLS deliberately blocks the app itself from creating the very first admin
(otherwise anyone could grant themselves access). Add yourself directly:
1. Sign in once on `admin.html` with the Google account you want to use —
   you'll land on the "not on the staff list" screen. That's expected.
2. In Supabase **SQL Editor**, run:
   ```sql
   insert into admin_users (email, display_name)
   values ('you@yourdomain.com', 'Your Name');
   ```
   (use the exact email you signed in with).
3. Reload `admin.html` and sign in again — you're in. From here, add any
   other staff from the **Staff** tab in the dashboard instead of SQL.

### 5. Host the site
Any static host works (Netlify, Vercel, GitHub Pages, Cloudflare Pages,
your own server) — there's no build step. Just make sure the URL you host
it at is also added to Supabase's redirect allow-list from step 3.4, or
Google sign-in will fail with a redirect mismatch error.

## Try it out

- Book a wash on `booking.html`. Sample codes from the seed data:
  **WELCOME10** (10% off, any day), **MIDWEEK5** ($5 off, Tue/Wed only),
  **SUMMER25** (25% off, capped at 50 uses, expires 1 Sep 2026).
- On `admin.html`, sign in with your admin Google account to manage
  discount codes, block off dates/times, view bookings, and manage staff.

## Notes & known simplifications

- **Single wash bay**: `bookings` has a `unique (date, time)` constraint, so
  only one booking can exist per slot. If you run multiple bays in
  parallel, remove that constraint and add a `bay`/capacity concept instead
  (both in the table and inside the `create_booking` function).
- **Services, car types, and time slots** are still defined as static lists
  in `js/db.js` (`CC_SERVICES`, `CC_CAR_TYPES`, `CC_ALL_SLOTS`) rather than
  database tables — simple to edit by hand, but if you want admins to
  manage these from the UI too, they'd need their own tables + RLS
  policies, following the same pattern as `discount_codes`.
- **Emails/SMS**: nothing currently sends a confirmation email or text —
  the confirmation is only shown on-screen. Supabase can trigger a
  [Database Webhook](https://supabase.com/docs/guides/database/webhooks) on
  new rows in `bookings` to call an email service (e.g. Resend, Postmark)
  if you want that.
- **Cancellations**: there's no "cancel my booking" flow for customers yet —
  admins can delete a booking from the dashboard, which frees the slot.
- Keep `supabase/schema.sql` around — it's your source of truth for the
  database structure if you ever need to recreate or audit it.
