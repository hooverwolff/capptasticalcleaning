/* ===========================================================
   Capptastical Cleaning — data layer
   -----------------------------------------------------------
   IMPORTANT — READ ME:
   This file uses the browser's localStorage as a stand-in for
   a real database so the site is fully demoable without a
   server. localStorage lives only in one browser on one device
   and is NOT secure or shared between customers/admins.

   Before going live, swap the functions in this file for real
   API calls to a backend + database. See README.md in this
   folder for a concrete plan (Firebase, or Node + Postgres).
   =========================================================== */

const DB_KEYS = {
  discounts: 'cc_discounts',
  blackouts: 'cc_blackouts',
  bookings: 'cc_bookings',
  admins: 'cc_admin_allowlist',
  session: 'cc_admin_session'
};

function ccLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Data load failed for', key, e);
    return fallback;
  }
}

function ccSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Data save failed for', key, e);
    return false;
  }
}

function ccUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- Seed data (first run only) ---------------- */
function ccSeed() {
  if (!localStorage.getItem(DB_KEYS.discounts)) {
    ccSave(DB_KEYS.discounts, [
      {
        id: ccUid(), code: 'WELCOME10', type: 'percent', value: 10,
        daysAllowed: [], maxUses: null, usedCount: 0,
        expiry: null, active: true, note: 'New customer welcome offer'
      },
      {
        id: ccUid(), code: 'MIDWEEK5', type: 'fixed', value: 5,
        daysAllowed: [2, 3], maxUses: null, usedCount: 0,
        expiry: null, active: true, note: 'Tuesdays & Wednesdays only'
      },
      {
        id: ccUid(), code: 'SUMMER25', type: 'percent', value: 25,
        daysAllowed: [], maxUses: 50, usedCount: 12,
        expiry: '2026-09-01', active: true, note: 'Limited summer promo'
      }
    ]);
  }
  if (!localStorage.getItem(DB_KEYS.blackouts)) {
    ccSave(DB_KEYS.blackouts, [
      { id: ccUid(), date: ccFmtDate(ccAddDays(new Date(), 6)), allDay: true, start: null, end: null, reason: 'Staff training day' },
      { id: ccUid(), date: ccFmtDate(ccAddDays(new Date(), 3)), allDay: false, start: '12:00', end: '14:00', reason: 'Equipment servicing' }
    ]);
  }
  if (!localStorage.getItem(DB_KEYS.bookings)) {
    ccSave(DB_KEYS.bookings, []);
  }
  if (!localStorage.getItem(DB_KEYS.admins)) {
    // Demo authorized admins. Replace with your real staff emails.
    ccSave(DB_KEYS.admins, [
      'owner@capptasticalcleaning.com.au',
      'manager@capptasticalcleaning.com.au'
    ]);
  }
}
ccSeed();

/* ---------------- Date helpers ---------------- */
function ccFmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function ccAddDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}
function ccToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ---------------- Discounts ---------------- */
function ccGetDiscounts() { return ccLoad(DB_KEYS.discounts, []); }
function ccSaveDiscounts(list) { return ccSave(DB_KEYS.discounts, list); }

function ccUpsertDiscount(discount) {
  const list = ccGetDiscounts();
  const idx = list.findIndex(d => d.id === discount.id);
  if (idx >= 0) list[idx] = discount; else list.push(discount);
  ccSaveDiscounts(list);
}
function ccDeleteDiscount(id) {
  ccSaveDiscounts(ccGetDiscounts().filter(d => d.id !== id));
}

/**
 * Validate a discount code against a chosen booking date.
 * Returns { ok:true, discount } or { ok:false, reason }
 */
function ccValidateDiscount(code, dateStr) {
  const list = ccGetDiscounts();
  const d = list.find(x => x.code.trim().toUpperCase() === code.trim().toUpperCase());
  if (!d) return { ok: false, reason: 'That code doesn\u2019t exist. Double-check the spelling.' };
  if (!d.active) return { ok: false, reason: 'That code is no longer active.' };
  if (d.expiry) {
    const exp = new Date(d.expiry + 'T23:59:59');
    if (new Date() > exp) return { ok: false, reason: 'That code expired on ' + d.expiry + '.' };
  }
  if (d.maxUses !== null && d.usedCount >= d.maxUses) {
    return { ok: false, reason: 'That code has reached its usage limit.' };
  }
  if (d.daysAllowed && d.daysAllowed.length > 0 && dateStr) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    if (!d.daysAllowed.includes(dow)) {
      const names = d.daysAllowed.map(n => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n]).join(', ');
      return { ok: false, reason: `That code only works for bookings on: ${names}.` };
    }
  }
  return { ok: true, discount: d };
}

function ccApplyDiscountUsage(discountId) {
  const list = ccGetDiscounts();
  const idx = list.findIndex(d => d.id === discountId);
  if (idx >= 0) {
    list[idx].usedCount = (list[idx].usedCount || 0) + 1;
    ccSaveDiscounts(list);
  }
}

function ccCalcPrice(basePrice, discount) {
  if (!discount) return basePrice;
  let final = discount.type === 'percent'
    ? basePrice - (basePrice * discount.value / 100)
    : basePrice - discount.value;
  return Math.max(0, Math.round(final * 100) / 100);
}

/* ---------------- Blackouts ---------------- */
function ccGetBlackouts() { return ccLoad(DB_KEYS.blackouts, []); }
function ccSaveBlackouts(list) { return ccSave(DB_KEYS.blackouts, list); }
function ccUpsertBlackout(b) {
  const list = ccGetBlackouts();
  const idx = list.findIndex(x => x.id === b.id);
  if (idx >= 0) list[idx] = b; else list.push(b);
  ccSaveBlackouts(list);
}
function ccDeleteBlackout(id) {
  ccSaveBlackouts(ccGetBlackouts().filter(b => b.id !== id));
}
function ccIsDateBlacked(dateStr) {
  return ccGetBlackouts().some(b => b.date === dateStr && b.allDay);
}
function ccBlackedSlotsForDate(dateStr) {
  return ccGetBlackouts().filter(b => b.date === dateStr && !b.allDay);
}

const CC_ALL_SLOTS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

function ccIsSlotBlacked(dateStr, slot) {
  const partials = ccBlackedSlotsForDate(dateStr);
  return partials.some(b => slot >= b.start && slot < b.end);
}

/* ---------------- Bookings ---------------- */
function ccGetBookings() { return ccLoad(DB_KEYS.bookings, []); }
function ccSaveBookings(list) { return ccSave(DB_KEYS.bookings, list); }
function ccAddBooking(b) {
  const list = ccGetBookings();
  list.unshift(b);
  ccSaveBookings(list);
}
function ccDeleteBooking(id) {
  ccSaveBookings(ccGetBookings().filter(b => b.id !== id));
}
function ccIsSlotTaken(dateStr, slot) {
  return ccGetBookings().some(b => b.date === dateStr && b.time === slot && b.status !== 'cancelled');
}

/* ---------------- Services ---------------- */
const CC_SERVICES = [
  { id: 'basic', name: 'Basic Wash', price: 25, blurb: 'Exterior rinse, foam wash & dry.' },
  { id: 'deluxe', name: 'Deluxe Wash', price: 45, blurb: 'Basic wash plus wheels, tyre shine & interior vacuum.' },
  { id: 'valet', name: 'Full Valet', price: 85, blurb: 'Deluxe wash plus interior detail, seats & windows inside-out.' }
];
const CC_CAR_TYPES = ['Small / Hatchback', 'Sedan', 'SUV / 4WD', 'Van / Ute', 'Large / Truck'];

/* ---------------- Admin allowlist & session ---------------- */
function ccGetAdmins() { return ccLoad(DB_KEYS.admins, []); }
function ccIsAuthorized(email) {
  return ccGetAdmins().map(e => e.toLowerCase()).includes((email || '').toLowerCase());
}
function ccGetSession() { return ccLoad(DB_KEYS.session, null); }
function ccSetSession(session) { ccSave(DB_KEYS.session, session); }
function ccClearSession() { localStorage.removeItem(DB_KEYS.session); }
