document.addEventListener('DOMContentLoaded', () => {

  const state = {
    step: 1,
    serviceId: CC_SERVICES[0].id,
    name: '', email: '', phone: '', carType: '',
    date: null, time: null,
    discount: null,
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    blackouts: [] // cached for the currently-rendered calendar
  };

  /* ---------- populate selects ---------- */
  const svcSelect = document.getElementById('svcSelect');
  CC_SERVICES.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} — $${s.price} (${s.blurb})`;
    svcSelect.appendChild(opt);
  });
  svcSelect.addEventListener('change', () => { state.serviceId = svcSelect.value; renderSummary(); });

  const carSelect = document.getElementById('carType');
  CC_CAR_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    carSelect.appendChild(opt);
  });

  /* ---------- step navigation ---------- */
  const panels = { 1: document.getElementById('panel-1'), 2: document.getElementById('panel-2'), 3: document.getElementById('panel-3'), 4: document.getElementById('panel-4') };
  const nodes = document.querySelectorAll('.step-node');
  const railFill = document.getElementById('railFill');

  function goStep(n) {
    Object.values(panels).forEach(p => p.style.display = 'none');
    panels[n].style.display = 'block';
    state.step = n;
    nodes.forEach(node => {
      const s = parseInt(node.dataset.step, 10);
      node.classList.toggle('active', s === n);
      node.classList.toggle('done', s < n);
    });
    railFill.style.width = ((n - 1) / 3 * 100) + '%';
    window.scrollTo({ top: panels[n].offsetTop - 100, behavior: 'smooth' });
  }

  function setError(fieldId, show) {
    document.getElementById(fieldId).classList.toggle('invalid', show);
  }

  function withBusy(btn, label, fn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    return fn().finally(() => { btn.disabled = false; btn.textContent = original; });
  }

  function showFatalError(msg) {
    alert(msg + '\n\nIf this keeps happening, the site may not be connected to Supabase yet — check js/supabase-config.js.');
  }

  /* ---------- STEP 1 validation ---------- */
  document.getElementById('toStep2').addEventListener('click', async () => {
    state.name = document.getElementById('custName').value.trim();
    state.email = document.getElementById('custEmail').value.trim();
    state.phone = document.getElementById('custPhone').value.trim();
    state.carType = document.getElementById('carType').value;

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email);
    const phoneOk = /^[0-9()+\-\s]{7,}$/.test(state.phone);

    setError('fName', state.name.length < 2);
    setError('fEmail', !emailOk);
    setError('fPhone', !phoneOk);
    setError('fCar', !state.carType);

    if (state.name.length < 2 || !emailOk || !phoneOk || !state.carType) return;

    const btn = document.getElementById('toStep2');
    try {
      await withBusy(btn, 'Loading calendar…', () => renderCalendar());
      goStep(2);
      renderSummary();
    } catch (e) {
      showFatalError('Couldn\u2019t load the calendar right now.');
    }
  });

  /* ---------- STEP 2: calendar ---------- */
  const calGrid = document.getElementById('calGrid');
  const calLabel = document.getElementById('calLabel');
  const slotWrap = document.getElementById('slotWrap');
  const slotGrid = document.getElementById('slotGrid');
  const slotDateLabel = document.getElementById('slotDateLabel');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dowNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  async function renderCalendar() {
    // Blackouts are a small, admin-managed table — fetching the
    // whole list each time we open/change the calendar keeps it
    // simple and always current.
    state.blackouts = await ccGetBlackouts();

    calGrid.innerHTML = '';
    dowNames.forEach(d => {
      const el = document.createElement('div');
      el.className = 'dow'; el.textContent = d;
      calGrid.appendChild(el);
    });
    const first = new Date(state.calYear, state.calMonth, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    const today = ccToday();

    for (let i = 0; i < startDow; i++) {
      const blank = document.createElement('div');
      blank.className = 'cal-day blank';
      calGrid.appendChild(blank);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(state.calYear, state.calMonth, d);
      const dateStr = ccFmtDate(dateObj);
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      cell.textContent = d;
      const isPast = dateObj < today;
      const isBlacked = ccIsDateBlackedFromList(state.blackouts, dateStr);
      if (isPast || isBlacked) {
        cell.classList.add('disabled');
        cell.title = isBlacked ? 'Unavailable' : 'Past date';
      } else {
        cell.addEventListener('click', () => selectDate(dateStr, cell));
      }
      if (state.date === dateStr) cell.classList.add('selected');
      calGrid.appendChild(cell);
    }
    calLabel.textContent = `${monthNames[state.calMonth]} ${state.calYear}`;
  }

  document.getElementById('calPrev').addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar().catch(() => showFatalError('Couldn\u2019t load the calendar right now.'));
  });
  document.getElementById('calNext').addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar().catch(() => showFatalError('Couldn\u2019t load the calendar right now.'));
  });

  async function selectDate(dateStr, cell) {
    document.querySelectorAll('.cal-day.selected').forEach(el => el.classList.remove('selected'));
    cell.classList.add('selected');
    state.date = dateStr;
    state.time = null;
    slotDateLabel.textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    slotGrid.innerHTML = '<p style="font-size:13px; color:var(--slate);">Checking availability…</p>';
    slotWrap.style.display = 'block';
    try {
      const taken = await ccGetTakenSlots(dateStr);
      renderSlots(dateStr, taken);
    } catch (e) {
      showFatalError('Couldn\u2019t check availability for that date.');
    }
    renderSummary();
  }

  function renderSlots(dateStr, takenSlots) {
    slotGrid.innerHTML = '';
    CC_ALL_SLOTS.forEach(slot => {
      const btn = document.createElement('div');
      btn.className = 'slot';
      btn.textContent = formatTime(slot);
      const blacked = ccIsSlotBlackedFromList(state.blackouts, dateStr, slot);
      const taken = takenSlots.includes(slot);
      if (blacked || taken) {
        btn.classList.add('disabled');
        btn.title = blacked ? 'Unavailable' : 'Already booked';
      } else {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.slot.selected').forEach(el => el.classList.remove('selected'));
          btn.classList.add('selected');
          state.time = slot;
          renderSummary();
        });
      }
      if (state.time === slot) btn.classList.add('selected');
      slotGrid.appendChild(btn);
    });
  }

  function formatTime(t) {
    const [h, m] = t.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  document.getElementById('back1').addEventListener('click', () => goStep(1));
  document.getElementById('toStep3').addEventListener('click', () => {
    if (!state.date || !state.time) {
      alert('Please choose a date and time to continue.');
      return;
    }
    goStep(3);
  });

  /* ---------- STEP 3: discount ---------- */
  const promoInput = document.getElementById('promoInput');
  const promoMsg = document.getElementById('promoMsg');
  const promoChipWrap = document.getElementById('promoChipWrap');

  function renderPromoChip() {
    promoChipWrap.innerHTML = '';
    if (!state.discount) return;
    const chip = document.createElement('div');
    chip.className = 'promo-chip';
    const label = state.discount.type === 'percent' ? `${state.discount.value}% off` : `$${state.discount.value} off`;
    chip.innerHTML = `<span>${state.discount.code} · ${label}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.setAttribute('aria-label', 'Remove code');
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    removeBtn.addEventListener('click', () => { state.discount = null; renderPromoChip(); renderSummary(); promoMsg.classList.remove('show'); });
    chip.appendChild(removeBtn);
    promoChipWrap.appendChild(chip);
  }

  document.getElementById('applyPromo').addEventListener('click', async () => {
    const code = promoInput.value.trim();
    if (!code) return;
    const btn = document.getElementById('applyPromo');
    try {
      const result = await withBusy(btn, 'Checking…', () => ccValidateDiscount(code, state.date));
      promoMsg.classList.remove('ok', 'bad');
      promoMsg.classList.add('show');
      if (result.ok) {
        state.discount = result.discount;
        promoMsg.classList.add('ok');
        promoMsg.textContent = `"${result.discount.code}" applied — enjoy the savings.`;
      } else {
        state.discount = null;
        promoMsg.classList.add('bad');
        promoMsg.textContent = result.reason;
      }
      renderPromoChip();
      renderSummary();
    } catch (e) {
      showFatalError('Couldn\u2019t check that code right now.');
    }
  });

  document.getElementById('back2').addEventListener('click', () => goStep(2));
  document.getElementById('toStep4').addEventListener('click', () => {
    renderReview();
    goStep(4);
  });

  /* ---------- STEP 4: review + confirm ---------- */
  function renderReview() {
    const svc = CC_SERVICES.find(s => s.id === state.serviceId);
    const estimate = ccCalcPrice(svc.price, state.discount);
    const dateLabel = new Date(state.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    document.getElementById('reviewBlock').innerHTML = `
      <div class="confirm-details">
        <div><span>Package</span><strong>${svc.name}</strong></div>
        <div><span>Name</span><strong>${escapeHtml(state.name)}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(state.email)}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(state.phone)}</strong></div>
        <div><span>Car type</span><strong>${escapeHtml(state.carType)}</strong></div>
        <div><span>Date</span><strong>${dateLabel}</strong></div>
        <div><span>Time</span><strong>${formatTime(state.time)}</strong></div>
        <div><span>Discount</span><strong>${state.discount ? state.discount.code : '—'}</strong></div>
        <div><span>Estimated total</span><strong>$${estimate.toFixed(2)}</strong></div>
      </div>
      <p style="font-size:12px; margin-top:10px;">Final total is confirmed by the server on the next step — it may differ slightly if availability or a discount code changed in the last few seconds.</p>`;
  }

  document.getElementById('back3').addEventListener('click', () => goStep(3));
  document.getElementById('confirmBooking').addEventListener('click', async () => {
    const svc = CC_SERVICES.find(s => s.id === state.serviceId);
    const btn = document.getElementById('confirmBooking');
    try {
      const result = await withBusy(btn, 'Confirming…', () => ccCreateBooking({
        name: state.name, email: state.email, phone: state.phone, carType: state.carType,
        service: svc.name, date: state.date, time: state.time,
        priceOriginal: svc.price, discountCode: state.discount ? state.discount.code : null
      }));

      if (!result.ok) {
        alert(result.reason);
        // Whatever changed (slot taken / code no longer valid), send them
        // back to re-pick so the UI matches reality.
        state.discount = null;
        promoMsg.classList.remove('show');
        renderPromoChip();
        await renderCalendar();
        goStep(2);
        if (state.date) { const taken = await ccGetTakenSlots(state.date); renderSlots(state.date, taken); }
        return;
      }

      document.getElementById('doneDetails').innerHTML = `
        <div><span>Booking ref</span><strong>${result.id.slice(0, 8).toUpperCase()}</strong></div>
        <div><span>Package</span><strong>${svc.name}</strong></div>
        <div><span>Date &amp; time</span><strong>${new Date(state.date + 'T00:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}, ${formatTime(state.time)}</strong></div>
        <div><span>Total</span><strong>$${result.priceFinal.toFixed(2)}</strong></div>`;
      Object.values(panels).forEach(p => p.style.display = 'none');
      document.getElementById('panel-done').style.display = 'block';
      document.querySelector('.steps-track').style.display = 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      showFatalError('Couldn\u2019t confirm the booking right now.');
    }
  });

  /* ---------- summary sidebar ---------- */
  function renderSummary() {
    const svc = CC_SERVICES.find(s => s.id === state.serviceId);
    const body = document.getElementById('summaryBody');
    if (!svc) { body.innerHTML = '<p class="summary-empty">Fill in the form to see your total.</p>'; return; }
    const estimate = ccCalcPrice(svc.price, state.discount);
    let html = `<div class="summary-row"><span>${svc.name}</span><span>$${svc.price.toFixed(2)}</span></div>`;
    if (state.date) html += `<div class="summary-row"><span>Date</span><span>${new Date(state.date+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></div>`;
    if (state.time) html += `<div class="summary-row"><span>Time</span><span>${formatTime(state.time)}</span></div>`;
    if (state.discount) {
      const off = svc.price - estimate;
      html += `<div class="summary-row discount"><span>${state.discount.code}</span><span>-$${off.toFixed(2)}</span></div>`;
    }
    html += `<div class="summary-row total"><span>Estimated total</span><span>$${estimate.toFixed(2)}</span></div>`;
    body.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  renderSummary();
});
