-- =============================================================
-- Capptastical Cleaning — Supabase schema
-- -------------------------------------------------------------
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste all of this → Run).
-- Safe to re-run: it drops and recreates its own objects first.
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- clean slate (safe re-run) ----------
drop function if exists create_booking(text, text, text, text, text, date, time, numeric, text);
drop function if exists get_taken_slots(date);
drop function if exists validate_and_apply_discount(text, date, boolean);
drop function if exists am_i_admin();
drop function if exists is_admin();
drop table if exists bookings;
drop table if exists blackout_dates;
drop table if exists discount_codes;
drop table if exists admin_users;

-- =============================================================
-- TABLES
-- =============================================================

create table admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  type text not null check (type in ('percent', 'fixed')),
  value numeric not null check (value > 0),
  days_allowed int[] not null default '{}',   -- 0=Sun .. 6=Sat, empty = any day
  max_uses int check (max_uses is null or max_uses > 0),
  used_count int not null default 0,
  expiry date,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table blackout_dates (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz not null default now(),
  constraint partial_needs_times check (
    all_day or (start_time is not null and end_time is not null and start_time < end_time)
  )
);

-- NOTE: this assumes a single wash bay (one booking per date+time).
-- If you run multiple bays in parallel, drop the unique constraint
-- below and add a `bay` column / capacity check instead.
create table bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  car_type text not null,
  service text not null,
  date date not null,
  "time" time not null,
  discount_code text,
  price_original numeric not null,
  price_final numeric not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (date, "time")
);

create index bookings_date_idx on bookings (date);
create index blackout_dates_date_idx on blackout_dates (date);

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

alter table admin_users enable row level security;
alter table discount_codes enable row level security;
alter table blackout_dates enable row level security;
alter table bookings enable row level security;

-- is_admin(): true if the currently signed-in Supabase Auth user's
-- verified email is in admin_users. security definer so it can read
-- admin_users regardless of the caller's own row-level permissions.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from admin_users a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- am_i_admin(): callable from the client to check "am I staff?"
-- without needing direct SELECT rights on admin_users.
create or replace function am_i_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select is_admin();
$$;
grant execute on function am_i_admin() to authenticated;

-- ---------- admin_users policies ----------
-- Only admins can view or manage the staff list (bootstrap the very
-- first admin manually via the SQL editor — see README).
create policy "admins can view admin list"
  on admin_users for select
  using (is_admin());

create policy "admins can manage admin list"
  on admin_users for all
  using (is_admin())
  with check (is_admin());

-- ---------- discount_codes policies ----------
-- No direct public SELECT — codes are validated through the
-- validate_and_apply_discount() function below so the full code
-- list is never exposed to customers. Admins get full CRUD.
create policy "admins manage discount codes"
  on discount_codes for all
  using (is_admin())
  with check (is_admin());

-- ---------- blackout_dates policies ----------
-- Public can read (needed to grey out the booking calendar).
-- Only admins can create/edit/delete.
create policy "anyone can view blackout dates"
  on blackout_dates for select
  using (true);

create policy "admins manage blackout dates"
  on blackout_dates for all
  using (is_admin())
  with check (is_admin());

-- ---------- bookings policies ----------
-- Public can INSERT (via create_booking() below, not directly —
-- but the base policy is still needed for the function to work).
-- No public SELECT/UPDATE/DELETE, so customers can't browse or
-- edit each other's bookings. Admins get full access.
create policy "admins view bookings"
  on bookings for select
  using (is_admin());

create policy "admins update bookings"
  on bookings for update
  using (is_admin())
  with check (is_admin());

create policy "admins delete bookings"
  on bookings for delete
  using (is_admin());

-- =============================================================
-- SERVER-SIDE FUNCTIONS
-- (all business logic that must not be trusted to the browser)
-- =============================================================

-- Validate a discount code against a booking date. If p_apply is
-- true, atomically increments its usage counter (only once it's
-- confirmed valid), preventing a race where two people redeem the
-- last use of a limited code at the same time.
create or replace function validate_and_apply_discount(
  p_code text,
  p_date date,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d discount_codes%rowtype;
  dow int;
begin
  select * into d from discount_codes where upper(code) = upper(trim(p_code));

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'That code doesn''t exist.');
  end if;
  if not d.active then
    return jsonb_build_object('ok', false, 'reason', 'That code is no longer active.');
  end if;
  if d.expiry is not null and p_date > d.expiry then
    return jsonb_build_object('ok', false, 'reason', 'That code expired on ' || to_char(d.expiry, 'YYYY-MM-DD') || '.');
  end if;
  if d.max_uses is not null and d.used_count >= d.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'That code has reached its usage limit.');
  end if;

  dow := extract(dow from p_date);
  if array_length(d.days_allowed, 1) is not null and not (dow = any(d.days_allowed)) then
    return jsonb_build_object('ok', false, 'reason', 'That code isn''t valid for the selected day.');
  end if;

  if p_apply then
    update discount_codes
      set used_count = used_count + 1
      where id = d.id and (max_uses is null or used_count < max_uses);
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'That code was just used up. Please try another.');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', d.code, 'type', d.type, 'value', d.value);
end;
$$;
grant execute on function validate_and_apply_discount(text, date, boolean) to anon, authenticated;

-- Public, privacy-safe read of which time slots are already taken
-- on a given date (no customer details exposed).
create or replace function get_taken_slots(p_date date)
returns table (slot_time time)
language sql
security definer
set search_path = public
stable
as $$
  select "time" from bookings where date = p_date and status <> 'cancelled';
$$;
grant execute on function get_taken_slots(date) to anon, authenticated;

-- Creates a booking with every check re-run on the server: blackout
-- dates/times, slot availability, and discount validity — so a
-- tampered client request can't book a blocked slot or invent a
-- discount. Price is calculated here, not trusted from the client.
create or replace function create_booking(
  p_name text,
  p_email text,
  p_phone text,
  p_car_type text,
  p_service text,
  p_date date,
  p_time time,
  p_price_original numeric,
  p_discount_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  discount_result jsonb;
  final_price numeric := p_price_original;
  new_id uuid;
begin
  if exists (select 1 from blackout_dates where date = p_date and all_day) then
    return jsonb_build_object('ok', false, 'reason', 'That date isn''t available.');
  end if;

  if exists (
    select 1 from blackout_dates
    where date = p_date and not all_day
      and p_time >= start_time and p_time < end_time
  ) then
    return jsonb_build_object('ok', false, 'reason', 'That time isn''t available.');
  end if;

  if exists (select 1 from bookings where date = p_date and "time" = p_time and status <> 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'That time slot was just taken. Please choose another.');
  end if;

  if p_discount_code is not null and length(trim(p_discount_code)) > 0 then
    discount_result := validate_and_apply_discount(p_discount_code, p_date, true);
    if not (discount_result ->> 'ok')::boolean then
      return jsonb_build_object('ok', false, 'reason', discount_result ->> 'reason');
    end if;
    if (discount_result ->> 'type') = 'percent' then
      final_price := p_price_original - (p_price_original * (discount_result ->> 'value')::numeric / 100);
    else
      final_price := p_price_original - (discount_result ->> 'value')::numeric;
    end if;
    final_price := greatest(0, round(final_price, 2));
  end if;

  insert into bookings (name, email, phone, car_type, service, date, "time", discount_code, price_original, price_final, status)
  values (p_name, p_email, p_phone, p_car_type, p_service, p_date, p_time,
          case when p_discount_code is not null and length(trim(p_discount_code)) > 0 then upper(trim(p_discount_code)) else null end,
          p_price_original, final_price, 'confirmed')
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id, 'price_final', final_price);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'That time slot was just taken. Please choose another.');
end;
$$;
grant execute on function create_booking(text, text, text, text, text, date, time, numeric, text) to anon, authenticated;

-- =============================================================
-- SEED DATA (safe to delete/edit — just sample rows to try out)
-- =============================================================

insert into discount_codes (code, type, value, days_allowed, max_uses, used_count, expiry, active, note) values
  ('WELCOME10', 'percent', 10, '{}', null, 0, null, true, 'New customer welcome offer'),
  ('MIDWEEK5', 'fixed', 5, '{2,3}', null, 0, null, true, 'Tuesdays & Wednesdays only'),
  ('SUMMER25', 'percent', 25, '{}', 50, 12, '2026-09-01', true, 'Limited summer promo');

insert into blackout_dates (date, all_day, start_time, end_time, reason) values
  (current_date + 6, true, null, null, 'Staff training day'),
  (current_date + 3, false, '12:00', '14:00', 'Equipment servicing');

-- =============================================================
-- BOOTSTRAP YOUR FIRST ADMIN
-- Replace the email below with your real Google account email,
-- then run just this one line (RLS blocks the app itself from
-- creating the very first admin — see README "First admin" step).
-- =============================================================
-- insert into admin_users (email, display_name) values ('you@yourdomain.com', 'Your Name');
