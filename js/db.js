/* ===========================================================
   Capptastical Cleaning — data layer (Supabase-backed)
   -----------------------------------------------------------
   Every function here talks to Supabase (Postgres + Row Level
   Security + the functions defined in supabase/schema.sql).
   Discount validation, price calculation, and blackout/overlap
   checks all happen ON THE SERVER inside create_booking() and
   validate_and_apply_discount() — this file just calls them.
   Requires js/supabase-config.js to be loaded first.
   =========================================================== */

/* ---------------- Static reference data ---------------- */
const CC_SERVICES = [
  { id: 'basic', name: 'Basic Wash', price: 25, blurb: 'Exterior rinse, foam wash & dry.' },
  { id: 'deluxe', name: 'Deluxe Wash', price: 45, blurb: 'Basic wash plus wheels, tyre shine & interior vacuum.' },
  { id: 'valet', name: 'Full Valet', price: 85, blurb: 'Deluxe wash plus interior detail, seats & windows inside-out.' }
];
const CC_CAR_TYPES = ['Small / Hatchback', 'Sedan', 'SUV / 4WD', 'Van / Ute', 'Large / Truck'];
const CC_ALL_SLOTS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

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
function ccUid() {
  return (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
}

/* ---------------- Error helper ---------------- */
function ccThrowIfError(error, context) {
  if (error) {
    console.error(`[Capptastical Cleaning] ${context}:`, error);
    throw new Error(error.message || `Something went wrong (${context}).`);
  }
}

/* =========================================================
   DISCOUNTS
   Admins get full CRUD (RLS: admins manage discount codes).
   Customers never read the table directly — validation goes
   through the validate_and_apply_discount() Postgres function,
   which returns only ok/reason (or ok/type/value on success),
   never the rest of the code list.
   ========================================================= */
async function ccGetDiscounts() {
  const { data, error } = await supabase.from('discount_codes').select('*').order('created_at', { ascending: false });
  ccThrowIfError(error, 'loading discount codes');
  return data.map(ccDiscountFromRow);
}

function ccDiscountFromRow(row) {
  return {
    id: row.id, code: row.code, type: row.type, value: Number(row.value),
    daysAllowed: row.days_allowed || [], maxUses: row.max_uses, usedCount: row.used_count,
    expiry: row.expiry, active: row.active, note: row.note || ''
  };
}

async function ccUpsertDiscount(discount) {
  const row = {
    code: discount.code, type: discount.type, value: discount.value,
    days_allowed: discount.daysAllowed || [], max_uses: discount.maxUses,
    expiry: discount.expiry, active: discount.active, note: discount.note || null
  };
  let error;
  if (discount.id) {
    ({ error } = await supabase.from('discount_codes').update(row).eq('id', discount.id));
  } else {
    ({ error } = await supabase.from('discount_codes').insert(row));
  }
  ccThrowIfError(error, 'saving discount code');
}

async function ccDeleteDiscount(id) {
  const { error } = await supabase.from('discount_codes').delete().eq('id', id);
  ccThrowIfError(error, 'deleting discount code');
}

/**
 * Validate a discount code against a chosen booking date.
 * Runs entirely server-side. Does NOT mark it used — that only
 * happens for real inside create_booking() at confirm time, so
 * abandoned bookings don't burn a limited-use code.
 */
async function ccValidateDiscount(code, dateStr) {
  const { data, error } = await supabase.rpc('validate_and_apply_discount', {
    p_code: code, p_date: dateStr, p_apply: false
  });
  ccThrowIfError(error, 'checking discount code');
  if (!data.ok) return { ok: false, reason: data.reason };
  return { ok: true, discount: { code: data.code, type: data.type, value: Number(data.value) } };
}

function ccCalcPrice(basePrice, discount) {
  if (!discount) return basePrice;
  const final = discount.type === 'percent'
    ? basePrice - (basePrice * discount.value / 100)
    : basePrice - discount.value;
  return Math.max(0, Math.round(final * 100) / 100);
}

/* =========================================================
   BLACKOUT DATES / TIMES
   Public SELECT is allowed (customers need this to see an
   accurate calendar); only admins can write.
   ========================================================= */
async function ccGetBlackouts() {
  const { data, error } = await supabase.from('blackout_dates').select('*').order('date', { ascending: true });
  ccThrowIfError(error, 'loading availability');
  return data.map(row => ({
    id: row.id, date: row.date, allDay: row.all_day,
    start: row.start_time ? row.start_time.slice(0, 5) : null,
    end: row.end_time ? row.end_time.slice(0, 5) : null,
    reason: row.reason || ''
  }));
}

async function ccUpsertBlackout(b) {
  const row = { date: b.date, all_day: b.allDay, start_time: b.allDay ? null : b.start, end_time: b.allDay ? null : b.end, reason: b.reason || null };
  let error;
  if (b.id) {
    ({ error } = await supabase.from('blackout_dates').update(row).eq('id', b.id));
  } else {
    ({ error } = await supabase.from('blackout_dates').insert(row));
  }
  ccThrowIfError(error, 'saving blocked time');
}

async function ccDeleteBlackout(id) {
  const { error } = await supabase.from('blackout_dates').delete().eq('id', id);
  ccThrowIfError(error, 'deleting blocked time');
}

/* Pure helpers that operate on an already-fetched blackout list
   (fetch once per calendar render, then check many dates/slots
   against it without a network round trip per cell). */
function ccIsDateBlackedFromList(list, dateStr) {
  return list.some(b => b.date === dateStr && b.allDay);
}
function ccBlackedSlotsForDateFromList(list, dateStr) {
  return list.filter(b => b.date === dateStr && !b.allDay);
}
function ccIsSlotBlackedFromList(list, dateStr, slot) {
  return ccBlackedSlotsForDateFromList(list, dateStr).some(b => slot >= b.start && slot < b.end);
}

/* =========================================================
   BOOKINGS
   Customers can only create bookings, via the create_booking()
   function (never a direct table insert), so every check —
   blackout, slot availability, discount validity, final price —
   is re-verified on the server. Only admins can list/edit/delete.
   ========================================================= */
async function ccGetTakenSlots(dateStr) {
  const { data, error } = await supabase.rpc('get_taken_slots', { p_date: dateStr });
  ccThrowIfError(error, 'checking availability');
  return (data || []).map(r => r.slot_time.slice(0, 5));
}

/**
 * Creates the booking server-side. Returns { ok, id, priceFinal }
 * on success or { ok:false, reason } if something changed (slot
 * taken, code expired, date blacked out) between the UI check and
 * this call.
 */
async function ccCreateBooking(details) {
  const { data, error } = await supabase.rpc('create_booking', {
    p_name: details.name, p_email: details.email, p_phone: details.phone,
    p_car_type: details.carType, p_service: details.service,
    p_date: details.date, p_time: details.time,
    p_price_original: details.priceOriginal,
    p_discount_code: details.discountCode || null
  });
  ccThrowIfError(error, 'creating booking');
  if (!data.ok) return { ok: false, reason: data.reason };
  return { ok: true, id: data.id, priceFinal: Number(data.price_final) };
}

async function ccGetBookings() {
  const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false });
  ccThrowIfError(error, 'loading bookings');
  return data.map(row => ({
    id: row.id, name: row.name, email: row.email, phone: row.phone, carType: row.car_type,
    service: row.service, date: row.date, time: row.time.slice(0, 5),
    discountCode: row.discount_code, priceOriginal: Number(row.price_original), priceFinal: Number(row.price_final),
    status: row.status, createdAt: row.created_at
  }));
}

async function ccDeleteBooking(id) {
  const { error } = await supabase.from('bookings').delete().eq('id', id);
  ccThrowIfError(error, 'deleting booking');
}

/* =========================================================
   ADMIN / AUTH
   Real sign-in is handled by Supabase Auth (Google OAuth) in
   admin.js. These helpers check/manage the admin_users table,
   which RLS restricts to admins-only.
   ========================================================= */
async function ccAmIAdmin() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return false;
  const { data, error } = await supabase.rpc('am_i_admin');
  if (error) { console.error('[Capptastical Cleaning] admin check failed:', error); return false; }
  return !!data;
}

async function ccGetAdmins() {
  const { data, error } = await supabase.from('admin_users').select('*').order('created_at', { ascending: true });
  ccThrowIfError(error, 'loading staff list');
  return data;
}

async function ccAddAdmin(email, displayName) {
  const { error } = await supabase.from('admin_users').insert({ email: email.trim().toLowerCase(), display_name: displayName || null });
  ccThrowIfError(error, 'adding staff member');
}

async function ccDeleteAdmin(id) {
  const { error } = await supabase.from('admin_users').delete().eq('id', id);
  ccThrowIfError(error, 'removing staff member');
}
