document.addEventListener('DOMContentLoaded', () => {

  const loginView = document.getElementById('loginView');
  const dashView = document.getElementById('dashView');
  const topbarUser = document.getElementById('topbarUser');
  const authError = document.getElementById('authError');

  /* =========================================================
     AUTH
     A real deployment would use Google Identity Services to get
     a signed ID token, send it to your backend, verify it there
     (never trust it in the browser alone), and only then start
     a server-side session. Here we simulate the "who is this
     Google account" step and check it against the authorized
     list, entirely client-side, for demo purposes only.
     ========================================================= */
  function tryLogin(email) {
    email = (email || '').trim();
    if (!email) return;
    if (ccIsAuthorized(email)) {
      ccSetSession({ email, name: email.split('@')[0], signedInAt: new Date().toISOString() });
      authError.style.display = 'none';
      renderAuthState();
    } else {
      authError.style.display = 'block';
    }
  }

  document.getElementById('demoSignIn').addEventListener('click', () => {
    const email = prompt('Demo Google sign-in\n\nEnter the Google account email to simulate signing in with:');
    if (email !== null) tryLogin(email);
  });

  function signOut() {
    ccClearSession();
    renderAuthState();
  }

  function renderAuthState() {
    const session = ccGetSession();
    if (session && ccIsAuthorized(session.email)) {
      loginView.style.display = 'none';
      dashView.style.display = 'block';
      topbarUser.innerHTML = `
        <div class="admin-user">
          <div class="avatar">${session.email.charAt(0).toUpperCase()}</div>
          <span>${session.email}</span>
        </div>
        <button class="btn btn-ghost btn-sm" id="signOutBtn" style="margin-left:10px;">Sign out</button>`;
      document.getElementById('signOutBtn').addEventListener('click', signOut);
      renderDiscounts();
      renderBlackouts();
      renderBookings();
    } else {
      loginView.style.display = 'block';
      dashView.style.display = 'none';
      topbarUser.innerHTML = '';
    }
  }
  renderAuthState();

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

  document.getElementById('discountSave').addEventListener('click', () => {
    const code = document.getElementById('dCode').value.trim().toUpperCase();
    const value = parseFloat(document.getElementById('dValue').value);
    if (!code) { alert('Please enter a code.'); return; }
    if (isNaN(value) || value <= 0) { alert('Please enter a discount value greater than 0.'); return; }

    const id = document.getElementById('discountId').value || ccUid();
    const maxUsesRaw = document.getElementById('dMaxUses').value;
    const existing = ccGetDiscounts().find(d => d.id === id);

    const discount = {
      id,
      code,
      type: document.getElementById('dType').value,
      value,
      daysAllowed: Array.from(document.querySelectorAll('#dayPicker .day-chip.on')).map(c => parseInt(c.dataset.day, 10)),
      maxUses: maxUsesRaw ? parseInt(maxUsesRaw, 10) : null,
      usedCount: existing ? existing.usedCount : 0,
      expiry: document.getElementById('dExpiry').value || null,
      active: document.getElementById('dActive').checked,
      note: document.getElementById('dNote').value.trim()
    };
    ccUpsertDiscount(discount);
    closeDiscountModal();
    renderDiscounts();
  });

  function renderDiscounts() {
    const list = ccGetDiscounts();
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
      const d = ccGetDiscounts().find(x => x.id === btn.dataset.edit);
      openDiscountModal(d);
    }));
    wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
      if (confirm('Delete this discount code? This can\'t be undone.')) {
        ccDeleteDiscount(btn.dataset.del);
        renderDiscounts();
      }
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

  document.getElementById('blackoutSave').addEventListener('click', () => {
    const date = document.getElementById('bDate').value;
    if (!date) { alert('Please choose a date.'); return; }
    const allDay = bAllDay.checked;
    if (!allDay && (!document.getElementById('bStart').value || !document.getElementById('bEnd').value)) {
      alert('Please set both a start and end time.'); return;
    }
    const b = {
      id: document.getElementById('blackoutId').value || ccUid(),
      date, allDay,
      start: allDay ? null : document.getElementById('bStart').value,
      end: allDay ? null : document.getElementById('bEnd').value,
      reason: document.getElementById('bReason').value.trim()
    };
    ccUpsertBlackout(b);
    closeBlackoutModal();
    renderBlackouts();
  });

  function renderBlackouts() {
    const list = ccGetBlackouts().slice().sort((a, b) => a.date.localeCompare(b.date));
    const wrap = document.getElementById('blackoutTableWrap');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state">No blocked dates or times. Everything is bookable.</div>';
      return;
    }
    const rows = list.map(b => `
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
      const b = ccGetBlackouts().find(x => x.id === btn.dataset.edit);
      openBlackoutModal(b);
    }));
    wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
      if (confirm('Remove this block? The date/time will become bookable again.')) {
        ccDeleteBlackout(btn.dataset.del);
        renderBlackouts();
      }
    }));
  }

  /* =========================================================
     BOOKINGS
     ========================================================= */
  function renderBookings() {
    const list = ccGetBookings();
    const wrap = document.getElementById('bookingTableWrap');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state">No bookings yet. They\'ll show up here as customers book online.</div>';
      return;
    }
    const rows = list.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.name)}</strong><div class="muted" style="font-size:12px;">${escapeHtml(b.email)}</div></td>
        <td class="muted">${b.service}<br><span style="font-size:12px;">${escapeHtml(b.carType)}</span></td>
        <td class="muted">${b.date}<br><span style="font-size:12px;">${b.time}</span></td>
        <td class="muted">${b.discountCode ? `<span class="badge pct">${b.discountCode}</span>` : '—'}</td>
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
    wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
      if (confirm('Remove this booking?')) {
        ccDeleteBooking(btn.dataset.del);
        renderBookings();
      }
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
