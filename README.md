# Capptastical Cleaning — website prototype

A 4-page front-end prototype for a local car wash: Home, About, Booking (with
discount codes and a calendar), and an Admin panel (discount codes, blackout
dates/times, and bookings).

## What's here

```
index.html      Home page
about.html      About page
booking.html    Booking flow (details → date/time → discount code → confirm)
admin.html      Staff sign-in + dashboard
css/styles.css  All styling, shared across pages
js/data.js      Data layer (currently backed by localStorage — see below)
js/main.js      Floating "Book a wash" bubble
js/booking.js   Booking flow logic
js/admin.js     Admin dashboard logic
```

Open `index.html` in a browser to try it. No build step, no server required —
that's also its biggest limitation, explained below.

## Try it out

- Book a wash on `booking.html`. Try discount code **WELCOME10** (10% off,
  any day), **MIDWEEK5** ($5 off, Tuesdays & Wednesdays only), or
  **SUMMER25** (25% off, limited to 50 uses, expires 1 Sep 2026).
- Open `admin.html` and use "Sign in with Google (demo)" with
  `owner@capptasticalcleaning.com.au` to get in, or any other address to see
  what an unauthorized sign-in looks like.
- In the admin dashboard you can create/edit/delete discount codes, block off
  dates or time windows, and see bookings as they come in.

## Important — this is a front-end prototype, not a production system

You asked for information to be **securely stored** and for discounts to be
**editable only by authorized users**, ideally in a **database**, plus **real
Google sign-in**. A static HTML/CSS/JS site *cannot* do any of that safely on
its own — anything that runs entirely in the customer's browser can be read
and edited by that customer. Specifically, right now:

- **Data storage**: `js/data.js` uses the browser's `localStorage` as a stand-in
  database, purely so the demo works with no backend. It is **not shared**
  between customers or devices, **not encrypted**, and anyone using the site
  could open dev tools and edit it directly — including granting themselves
  admin rights or free discounts.
- **Admin sign-in**: The "Sign in with Google (demo)" button just asks you to
  type an email address and checks it against a list — it does **not**
  actually verify you own that Google account. There's a stub in the code
  (`js/admin.js`) marking exactly where real verification needs to happen.
- **Discount code checks happen in the browser**, so a technically-minded
  customer could currently bypass validation logic client-side.

None of this is a small tweak — it's the difference between a prototype and a
real product, and it needs a backend. Here's the concrete path:

### 1. Add a real backend + database
Move everything in `js/data.js` behind an API instead of `localStorage`:
- **Simplest path**: [Firebase](https://firebase.google.com/) (Firestore +
  Firebase Auth) or [Supabase](https://supabase.com/) (Postgres + Auth) — both
  give you a hosted database, authentication, and security rules without
  standing up your own server.
- **More control**: a small Node.js/Express (or similar) API in front of a
  Postgres/MySQL database, deployed somewhere like Render, Railway, or Fly.io.

Either way, the browser should only ever talk to *your* API — never write
discounts, blackout dates, or bookings straight into its own storage.

### 2. Real "Sign in with Google"
1. Create an OAuth Client ID in the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add the [Google Identity Services](https://developers.google.com/identity/gsi/web)
   script and render the real button in place of the demo button in
   `admin.html`.
3. Send the ID token Google gives you to your backend.
4. **On the server**, verify that token with Google's library, check the
   email against your authorized-staff list stored in your database (not in
   client-side JS), then start a proper server-side session (e.g. an
   HttpOnly, Secure session cookie). Never trust an email address that only
   the browser has told you about.

### 3. Enforce authorization on the server, not just the UI
Anyone can open dev tools and call your admin functions directly, so every
create/edit/delete for discount codes and blackout dates must be re-checked
server-side against the signed-in, verified staff session — the UI hiding a
button is not access control.

### 4. General hardening for a real launch
- Serve everything over HTTPS.
- Rate-limit and validate all form submissions server-side (never trust
  client-side validation alone).
- Store only the customer data you need (this prototype: name, email, phone,
  car type, date/time, discount code — no payment details are collected here).
- If you add payments later, use a provider like Stripe and never handle
  raw card numbers on your own server.
- Keep dependencies (backend framework, DB driver, auth libraries) patched.
- Regular backups of the booking/discount database.

## Customizing content

- Business name, hours, address, phone, and email appear in the header/footer
  of each page and in `index.html`'s info strip — search-and-replace as
  needed.
- Wash packages and pricing live in `js/data.js` under `CC_SERVICES`.
- Car types live in `js/data.js` under `CC_CAR_TYPES`.
- Available booking time slots live in `js/data.js` under `CC_ALL_SLOTS`.
- The authorized-admin email allowlist is seeded in `js/data.js` under
  `ccSeed()` — replace with real staff emails once real sign-in is wired up.
