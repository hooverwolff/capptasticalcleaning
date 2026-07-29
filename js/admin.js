document.addEventListener('DOMContentLoaded', () => {

  const loginView = document.getElementById('loginView');
  const unauthorizedView = document.getElementById('unauthorizedView');
  const dashView = document.getElementById('dashView');
  const topbarUser = document.getElementById('topbarUser');
  const loginStatus = document.getElementById('loginStatus');

  /* =========================================================
     AUTH
     Real flow: Supabase Auth handles the Google OAuth redirect
     and verifies the token — we never see or trust a raw email
     the browser hands us. Once signed in, we ask the database
     (via the am_i_admin() function, itself governed by RLS)
     whether this verified user is staff.
     ========================================================= */
  document.getElementById('googleSignIn').addEventListener('click', async () => {
    loginStatus.textContent = 'Redirecting to Google…';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href.split('#')[0] }
    });
    if (error) {
      loginStatus.textContent = 'Couldn\u2019t start Google sign-in: ' + error.message;
    }
  });

  document.getElementById('unauthorizedSignOut').addEventListener('click', async () => {
    await supabase.auth.signOut();
    render();
  });

  async function render() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      loginView.style.display = 'block';
      unauthorizedView.style.display = 'none';
      dashView.style.display = 'none';
      topbarUser.innerHTML = '';
      return;
    }

    const isAdmin = await ccAmIAdmin();
    if (!isAdmin) {
      loginView.style.display = 'none';
      unauthorizedView.style.display = 'block';
      dashView.style.display = 'none';
      document.getElementById('unauthorizedEmail').textContent = session.user.email;
      topbarUser.innerHTML = '';
      return;
    }

    loginView.style.display = 'none';
    unauthorizedView.style.display = 'none';
    dashView.style.display = 'block';
    topbarUser.innerHTML = `
      <div class="admin-user">
        <div class="avatar">${session.user.email.charAt(0).toUpperCase()}</div>
        <span>${session.user.email}</span>
      </div>
      <button class="btn btn-ghost btn-sm" id="signOutBtn" style="margin-left:10px;">Sign out</button>`;
    document.getElementById('signOutBtn').addEventListener('click', async () => {
      await supabase.auth.signOut();
      render();
    });

    loadDiscounts();
    loadBlackouts();
    loadBookings();
    loadStaff();
  }

  // Supabase fires this on load (restoring a session), after the
  // Google redirect, and on sign-out — one handler keeps the UI in sync.
  supabase.auth.onAuthStateChange(() => render());
  render();

  /* =========================================================
     TABS
     ========================================================= */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  function showError(wrapId, message) {
    document.getElementById(wrapId).innerHTML = `<div class="empty-state" style="border-color:#F3D2D2; color:#C24545;">${escapeHtml(message)}</div>`;
  }

  /* =========================================================
     DISCOUNTS
     ========================================================= */
  const discountBackdrop = document.getElementById('discountModalBackdrop');

  function openDiscountModal(discount) {
    document.getElementById('discountModalTitle').textContent = discount ? 'Edit discount code' : 'New discount code';
    document.getElementById('discountId').value = discount ? discount.id : '';
    document.getElementById('dCode').value = discount ? discount.code : '';
    document.getElementById('dNote').value = discount ? (discount.note || '') : '';
    document.getElementById('dType').value = discount ? discount.type : 'percent';
    document.getElementById('dValue').value = discount ? discount.value : '';
    document.getElementById('dMaxUses').value = discount && discount.maxUses !== null ? discount.maxUses : '';
    document.getElementById('dExpiry').value = discount && discount.expiry ? discount.expiry : '';
    document.getElementById('dActive').checked = discount ? !!discount.active : true;
    document.querySelectorAll('#dayPicker .day-chip').forEach(chip => {
      const d = parseInt(chip.dataset.day, 10);
      chip.classList.toggle('on', discount ? (discount.daysAllowed || []).includes(d) : false);
    });
    discountBackdrop.classList.add('open');
  }
  function closeDiscountModal() { discountBackdrop.classList.remove('open'); }

  document.getElementById('newDiscountBtn').addEventListener('click', () => openDiscountModal(null));
  document.getElementById('discountCancel').addEventListener('click', closeDiscountModal);
  document.querySelectorAll('#dayPicker .day-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('on'));
  });

  document.getElementById('discountSave').addEventListener('click', async () => {
    const code = document.getElementById('dCode').value.trim().toUpperCase();
    const value = parseFloat(document.getElementById('dValue').value);
    if (!code) { alert('Please enter a code.'); return; }
    if (isNaN(value) || value <= 0) { alert('Please enter a discount value greater than 0.'); return; }

    const saveBtn = document.getElementById('discountSave');
    const maxUsesRaw = document.getElementById('dMaxUses').value;
    const discount = {
      id: document.getElementById('discountId').value || null,
      code,
      type: document.getElementById('dType').value,
      value,
      daysAllowed: Array.from(document.querySelectorAll('#dayPicker .day-chip.on')).map(c => parseInt(c.dataset.day, 10)),
      maxUses: maxUsesRaw ? parseInt(maxUsesRaw, 10) : null,
      expiry: document.getElementById('dExpiry').value || null,
      active: document.getElementById('dActive').checked,
      note: document.getElementById('dNote').value.trim()
    };
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      await ccUpsertDiscount(discount);
      closeDiscountModal();
      loadDiscounts();
    } catch (e) {
      alert('Couldn\u2019t save that code: ' + e.message);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save code';
    }
  });

  async function loadDiscounts() {
    const wrap = document.getElementById('discountTableWrap');
    wrap.innerHTML = '<div class="empty-state">Loading discount codes…</div>';
    try {
      renderDiscounts(await ccGetDiscounts());
    } catch (e) {
      showError('discountTableWrap', 'Couldn\u2019t load discount codes: ' + e.message);
    }
  }

  function renderDiscounts(list) {
    const wrap = document.getElementById('discountTableWrap');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state">No discount codes yet. Create one to get started.</div>';
      return;
    }
    const rows = list.map(d => {
      const days = d.daysAllowed && d.daysAllowed.length ? d.daysAllowed.map(n => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][n]).join(', ') : 'Any day';
      const uses = d.maxUses !== null ? `${d.usedCount} / ${d.maxUses}` : `${d.usedCount} / ∞`;
      const valLabel = d.type === 'percent' ? `${d.value}%` : `$${d.value}`;
      return `
        <tr>
          <td><strong>${escapeHtml(d.code)}</strong>${d.note ? `<div class="muted" style="font-size:12px;">${escapeHtml(d.note)}</div>` : ''}</td>
          <td><span class="badge ${d.type === 'percent' ? 'pct' : 'fixed'}">${valLabel} off</span></td>
          <td class="muted">${days}</td>
          <td class="muted">${uses}</td>
          <td class="muted">${d.expiry || 'Never'}</td>
          <td><span class="badge ${d.active ? 'on' : 'off'}">${d.active ? 'Active' : 'Inactive'}</span></td>
          <td>
            <div class="row-actions">
              <button data-edit="${d.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
              <button class="del" data-del="${d.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>
            </div>
          </td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Code</th><th>Discount</th><th>Days</th><th>Uses</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    wrap.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      openDiscountModal(list.find(x => x.id === btn.dataset.edit));
    }));
    wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this discount code? This can\'t be undone.')) return;
      try { await ccDeleteDiscount(btn.dataset.del); loadDiscounts(); }
      catch (e) { alert('Couldn\u2019t delete: ' + e.message); }
    }));
  }

  /* =========================================================
     BLACKOUTS
     ========================================================= */
  const blackoutBackdrop = document.getElementById('blackoutModalBackdrop');
  const bAllDay = document.getElementById('bAllDay');
  const bTimeRow = document.getElementById('bTimeRow');
  bAllDay.addEventListener('change', () => { bTimeRow.style.display = bAllDay.checked ? 'none' : 'grid'; });

  function openBlackoutModal(b) {
    document.getElementById('blackoutId').value = b ? b.id : '';
    document.getElementById('bDate').value = b ? b.date : '';
    bAllDay.checked = b ? b.allDay : true;
    bTimeRow.style.display = bAllDay.checked ? 'none' : 'grid';
    document.getElementById('bStart').value = b && b.start ? b.start : '';
    document.getElementById('bEnd').value = b && b.end ? b.end : '';
    document.getElementById('bReason').value = b ? (b.reason || '') : '';
    blackoutBackdrop.classList.add('open');
  }
  function closeBlackoutModal() { blackoutBackdrop.classList.remove('open'); }

  document.getElementById('newBlackoutBtn').addEventListener('click', () => openBlackoutModal(null));
  document.getElementById('blackoutCancel').addEventListener('click', closeBlackoutModal);

  document.getElementById('blackoutSave').addEventListener('click', async () => {
    const date = document.getElementById('bDate').value;
    if (!date) { alert('Please choose a date.'); return; }
    const allDay = bAllDay.checked;
    if (!allDay && (!document.getElementById('bStart').value || !document.getElementById('bEnd').value)) {
      alert('Please set both a start and end time.'); return;
    }
    const saveBtn = document.getElementById('blackoutSave');
    const b = {
      id: document.getElementById('blackoutId').value || null,
      date, allDay,
      start: allDay ? null : document.getElementById('bStart').value,
      end: allDay ? null : document.getElementById('bEnd').value,
      reason: document.getElementById('bReason').value.trim()
    };
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      await ccUpsertBlackout(b);
      closeBlackoutModal();
      loadBlackouts();
    } catch (e) {
      alert('Couldn\u2019t save: ' + e.message);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = 'Save';
    }
  });

  async function loadBlackouts() {
    const wrap = document.getElementById('blackoutTableWrap');
    wrap.innerHTML = '<div class="empty-state">Loading availability…</div>';
    try {
      renderBlackouts(await ccGetBlackouts());
    } catch (e) {
      showError('blackoutTableWrap', 'Couldn\u2019t load availability: ' + e.message);
    }
  }

  function renderBlackouts(list) {
    const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date));
    const wrap = document.getElementById('blackoutTableWrap');
    if (!sorted.length) {
      wrap.innerHTML = '<div class="empty-state">No blocked dates or times. Everything is bookable.</div>';
      return;
    }
    const rows = sorted.map(b => `
      <tr>
        <td><strong>${b.date}</strong></td>
        <td>${b.allDay ? '<span class="badge off">Full day</span>' : `<span class="badge pct">${b.start}–${b.end}</span>`}</td>
        <td class="muted">${b.reason ? escapeHtml(b.reason) : '—'}</td>
        <td>
          <div class="row-actions">
            <button data-edit="${b.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button class="del" data-del="${b.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>
          </div>
        </td>
      </tr>`).join('');
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Date</th><th>Blocked</th><th>Reason</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    wrap.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      openBlackoutModal(sorted.find(x => x.id === btn.dataset.edit));
    }));
    wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Remove this block? The date/time will become bookable again.')) return;
      try { await ccDeleteBlackout(btn.dataset.del); loadBlackouts(); }
      catch (e) { alert('Couldn\u2019t delete: ' + e.message); }
    }));
  }

  /* =========================================================
     BOOKINGS
     ========================================================= */
  async function loadBookings() {
    const wrap = document.getElementById('bookingTableWrap');
    wrap.innerHTML = '<div class="empty-state">Loading bookings…</div>';
    try {
      renderBookings(await ccGetBookings());
    } catch (e) {
      showError('bookingTableWrap', 'Couldn\u2019t load bookings: ' + e.message);
    }
  }

  function renderBookings(list) {
    const wrap = document.getElementById('bookingTableWrap');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state">No bookings yet. They\'ll show up here as customers book online.</div>';
      return;
    }
    const rows = list.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.name)}</strong><div class="muted" style="font-size:12px;">${escapeHtml(b.email)}</div></td>
        <td class="muted">${escapeHtml(b.service)}<br><span style="font-size:12px;">${escapeHtml(b.carType)}</span></td>
        <td class="muted">${b.date}<br><span style="font-size:12px;">${b.time}</span></td>
        <td class="muted">${b.discountCode ? `<span class="badge pct">${escapeHtml(b.discountCode)}</span>` : '—'}</td>
        <td><strong>$${b.priceFinal.toFixed(2)}</strong></td>
        <td>
          <div class="row-actions">
            <button class="del" data-del="${b.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>
          </div>
        </td>
      </tr>`).join('');
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Customer</th><th>Service</th><th>When</th><th>Code</th><th>Total</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Remove this booking?')) return;
      try { await ccDeleteBooking(btn.dataset.del); loadBookings(); }
      catch (e) { alert('Couldn\u2019t delete: ' + e.message); }
    }));
  }

  /* =========================================================
     STAFF
     ========================================================= */
  document.getElementById('addAdminBtn').addEventListener('click', async () => {
    const email = document.getElementById('newAdminEmail').value.trim();
    const name = document.getElementById('newAdminName').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Enter a valid email address.'); return; }
    const btn = document.getElementById('addAdminBtn');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      await ccAddAdmin(email, name);
      document.getElementById('newAdminEmail').value = '';
      document.getElementById('newAdminName').value = '';
      loadStaff();
    } catch (e) {
      alert('Couldn\u2019t add that staff member: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Add staff member';
    }
  });

  async function loadStaff() {
    const wrap = document.getElementById('staffTableWrap');
    wrap.innerHTML = '<div class="empty-state">Loading staff…</div>';
    try {
      renderStaff(await ccGetAdmins());
    } catch (e) {
      showError('staffTableWrap', 'Couldn\u2019t load staff: ' + e.message);
    }
  }

  async function renderStaff(list) {
    const { data: { session } } = await supabase.auth.getSession();
    const myEmail = session ? session.user.email.toLowerCase() : null;
    const wrap = document.getElementById('staffTableWrap');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state">No staff on the list yet.</div>';
      return;
    }
    const rows = list.map(a => `
      <tr>
        <td><strong>${escapeHtml(a.email)}</strong>${a.email.toLowerCase() === myEmail ? ' <span class="badge on">You</span>' : ''}</td>
        <td class="muted">${escapeHtml(a.display_name || '—')}</td>
        <td class="muted">${new Date(a.created_at).toLocaleDateString()}</td>
        <td>
          <div class="row-actions">
            <button class="del" data-del="${a.id}" aria-label="Remove" ${a.email.toLowerCase() === myEmail ? 'disabled title="You can\'t remove yourself"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>
          </div>
        </td>
      </tr>`).join('');
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Email</th><th>Name</th><th>Added</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    wrap.querySelectorAll('[data-del]:not([disabled])').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Remove this person\'s admin access?')) return;
      try { await ccDeleteAdmin(btn.dataset.del); loadStaff(); }
      catch (e) { alert('Couldn\u2019t remove: ' + e.message); }
    }));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  // Close modals on backdrop click
  [discountBackdrop, blackoutBackdrop].forEach(bd => {
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); });
  });
});
