// ==UserScript==
// @name         SOS POS – Auto Move v17.1
// @namespace    http://tampermonkey.net/
// @version      17.1
// @description  Click = toggle Repairing tickets Today↔Storage. Hold = settle board (move all non-finished).
// @author       You
// @match        *://app.sospos.com.au/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const BATCH_URL = 'https://app.sospos.com.au/api/entities/Ticket/batch';
  const BOARD_URL = 'https://app.sospos.com.au/api/entities/Ticket/board';
  const HOLD_MS   = 700;

  const SETTLE_OK = new Set([
    'paid & collected', 'paid', 'collected',
    'no fix - collected', 'no fix collected',
    'warranty', 'enquiry', 'refunded', 'cancelled',
  ]);

  // Persist state across reloads
  let inStorage    = sessionStorage.getItem('sos_in_storage') === 'true';
  let savedTickets = JSON.parse(sessionStorage.getItem('sos_saved_tickets') || '[]');
  let savedSettle  = JSON.parse(sessionStorage.getItem('sos_saved_settle')  || '[]');
  let settleStored = sessionStorage.getItem('sos_settle_stored') === 'true';
  let capturedStoreId = null;

  function saveState() {
    sessionStorage.setItem('sos_in_storage',    String(inStorage));
    sessionStorage.setItem('sos_saved_tickets', JSON.stringify(savedTickets));
    sessionStorage.setItem('sos_saved_settle',  JSON.stringify(savedSettle));
    sessionStorage.setItem('sos_settle_stored', String(settleStored));
  }

  // Capture store_id from any fetch
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = (typeof input === 'string' ? input : input?.url) ?? '';
    const m = url.match(/store_id=([^&]+)/);
    if (m) capturedStoreId = m[1];
    return _fetch(input, init);
  };

  function getStoreId() {
    if (capturedStoreId) return capturedStoreId;
    const m = document.documentElement.innerHTML.match(/store_id[=:]["']?([a-f0-9]{20,})/);
    return m ? m[1] : null;
  }

  async function fetchBoard() {
    const storeId = getStoreId();
    if (!storeId) { console.warn('[SOS-Move] No store_id'); return []; }
    const res = await _fetch(`${BOARD_URL}?store_id=${storeId}`, { credentials: 'include' });
    if (!res.ok) { console.warn('[SOS-Move] Board fetch failed', res.status); return []; }
    const data = await res.json();
    const flat = [];
    if (Array.isArray(data)) flat.push(...data);
    else if (data && typeof data === 'object') Object.values(data).forEach(v => Array.isArray(v) && flat.push(...v));
    return flat;
  }

  function isRepairing(t) {
    return /^repair/i.test(t.status || t.repair_status || t.ticket_status || t.state || '');
  }
  function isSettleOk(t) {
    return SETTLE_OK.has((t.status || t.repair_status || t.ticket_status || t.state || '').toLowerCase().trim());
  }

  async function batchMove(tickets, target) {
    const updates = tickets.map((t, i) => ({ id: t.id, board: target, sort_index: i }));
    console.log('[SOS-Move] Moving', tickets.length, '→', target);
    return _fetch(BATCH_URL, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
  }

  // ── Button ────────────────────────────────────────────────────────────
  document.head.insertAdjacentHTML('beforeend', `<style>
    #sos-btn {
      position: fixed; bottom: 28px; right: 28px; z-index: 2147483647;
      width: 44px; height: 44px; border-radius: 50%; border: none;
      cursor: pointer; background: #e2e8f0;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
      transition: background .2s, transform .15s, box-shadow .2s;
      display: flex; align-items: center; justify-content: center;
      -webkit-user-select: none; user-select: none;
    }
    #sos-btn:hover  { transform: scale(1.1); box-shadow: 0 4px 14px rgba(0,0,0,.22); }
    #sos-btn:active { transform: scale(.92); }
    #sos-btn.stored  { background: #3b82f6; }
    #sos-btn.settled { background: #f59e0b; }
    #sos-btn.busy    { background: #94a3b8; cursor: wait; }
    #sos-btn .dot {
      width: 14px; height: 14px; border-radius: 50%;
      background: #64748b; transition: background .2s;
    }
    #sos-btn.stored .dot  { background: #fff; }
    #sos-btn.settled .dot { background: #fff; }
    #sos-btn.busy .dot    { background: #e2e8f0; animation: sos-mv-pulse .8s infinite; }
    #sos-btn::after {
      content: ''; position: absolute; inset: 0; border-radius: 50%;
      border: 2px solid #f59e0b; opacity: 0; transform: scale(.7); transition: none;
    }
    #sos-btn.holding::after {
      opacity: 1; transform: scale(1.25);
      transition: transform 0.7s linear, opacity 0.1s;
    }
    @keyframes sos-mv-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  </style>`);

  const btn = document.createElement('button');
  btn.id = 'sos-btn';
  btn.title = 'Click: toggle Repairing  |  Hold: settle board';
  btn.innerHTML = '<span class="dot"></span>';
  document.body.appendChild(btn);

  if (settleStored)   btn.classList.add('settled');
  else if (inStorage) btn.classList.add('stored');

  let holdTimer = null, didHold = false;

  function startHold() {
    didHold = false;
    btn.classList.add('holding');
    holdTimer = setTimeout(() => {
      didHold = true;
      btn.classList.remove('holding');
      handleHold();
    }, HOLD_MS);
  }
  function cancelHold() { clearTimeout(holdTimer); btn.classList.remove('holding'); }

  btn.addEventListener('mousedown',  startHold);
  btn.addEventListener('touchstart', startHold, { passive: true });
  btn.addEventListener('mouseup',    cancelHold);
  btn.addEventListener('mouseleave', cancelHold);
  btn.addEventListener('touchend',   cancelHold);

  btn.addEventListener('click', async () => {
    if (didHold) return;
    setBusy(true);
    try {
      if (!inStorage) {
        const tickets = (await fetchBoard()).filter(isRepairing);
        if (!tickets.length) { setBusy(false); return; }
        const r = await batchMove(tickets, 'storage');
        if (r.ok) { savedTickets = tickets; inStorage = true; saveState(); location.reload(); }
      } else {
        const tickets = savedTickets.length ? savedTickets : (await fetchBoard()).filter(isRepairing);
        if (!tickets.length) { setBusy(false); return; }
        const r = await batchMove(tickets, 'today');
        if (r.ok) { savedTickets = []; inStorage = false; saveState(); location.reload(); }
      }
    } catch (e) { console.error('[SOS-Move]', e); }
    setBusy(false);
  });

  async function handleHold() {
    setBusy(true);
    try {
      if (!settleStored) {
        const tickets = (await fetchBoard()).filter(t => !isSettleOk(t));
        if (!tickets.length) { setBusy(false); return; }
        const r = await batchMove(tickets, 'storage');
        if (r.ok) {
          savedSettle = tickets; settleStored = true;
          savedTickets = []; inStorage = false;
          saveState(); location.reload();
        }
      } else {
        if (!savedSettle.length) { setBusy(false); return; }
        const r = await batchMove(savedSettle, 'today');
        if (r.ok) { savedSettle = []; settleStored = false; saveState(); location.reload(); }
      }
    } catch (e) { console.error('[SOS-Move]', e); }
    setBusy(false);
  }

  function setBusy(on) {
    btn.disabled = on;
    btn.classList.toggle('busy', on);
    if (!on) {
      if (settleStored)   { btn.classList.remove('stored');  btn.classList.add('settled'); }
      else if (inStorage) { btn.classList.remove('settled'); btn.classList.add('stored');  }
      else                { btn.classList.remove('stored', 'settled'); }
    }
  }

})();