(() => {
  const form = document.getElementById('booking-form');
  const dateInput = document.getElementById('booking-date');
  const slotList = document.getElementById('time-slots');
  const timeInput = document.getElementById('booking-time');
  const status = document.getElementById('booking-status');
  const capacityLabel = document.getElementById('slot-capacity');
  const dialog = document.getElementById('booking-success');
  const slots = ['09:30', '11:00', '14:30', '16:00'];
  const apiBase = (window.PORTFOLIO_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  const storageKey = 'tempo-yoga-demo-bookings';
  const pad = (value) => String(value).padStart(2, '0');
  const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const now = new Date();
  dateInput.min = isoDate(now);
  const nextOpenDay = new Date(now);
  while ([0, 1].includes(nextOpenDay.getDay())) nextOpenDay.setDate(nextOpenDay.getDate() + 1);
  dateInput.value = isoDate(nextOpenDay);

  function localBookings() { try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; } }
  function renderSlots(booked = []) {
    slotList.replaceChildren();
    timeInput.value = '';
    slots.forEach((time) => {
      const count = booked.filter((item) => item.time === time).length;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'time-slot'; button.textContent = time;
      button.setAttribute('aria-pressed', 'false');
      button.disabled = count >= 8;
      button.addEventListener('click', () => {
        slotList.querySelectorAll('.time-slot').forEach((item) => { item.classList.remove('selected'); item.setAttribute('aria-pressed', 'false'); });
        button.classList.add('selected'); button.setAttribute('aria-pressed', 'true'); timeInput.value = time;
      });
      slotList.append(button);
    });
    capacityLabel.textContent = '4 créneaux · 8 places chacun';
  }
  async function loadSlots() {
    const selectedDate = new Date(`${dateInput.value}T12:00:00`);
    if ([0, 1].includes(selectedDate.getDay())) {
      renderSlots(); slotList.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      status.textContent = 'Le studio est fermé le dimanche et le lundi. Choisissez un autre jour.';
      return;
    }
    renderSlots(localBookings().filter((item) => item.date === dateInput.value));
    try {
      const response = await fetch(`${apiBase}/api/bookings/availability?date=${encodeURIComponent(dateInput.value)}`);
      if (!response.ok) {
        status.textContent = 'Démo interactive locale — votre demande reste enregistrée dans ce navigateur.';
        return;
      }
      const data = await response.json();
      renderSlots(data.bookings || []);
      status.textContent = 'Démonstration connectée au serveur de réservations.';
    } catch {
      status.textContent = 'Démo interactive locale — votre demande reste enregistrée dans ce navigateur.';
    }
  }
  dateInput.addEventListener('change', loadSlots);
  loadSlots();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.website) { form.reset(); return; }
    if (!values.time) { status.textContent = 'Choisissez un créneau pour continuer.'; return; }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; status.textContent = 'Enregistrement de la demande…';
    const booking = { name: values.name.trim(), email: values.email.trim(), date: values.date, time: values.time, className: values.className };
    let serverResponded = false;
    try {
      const response = await fetch(`${apiBase}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(booking) });
      if ([404, 405].includes(response.status)) throw new Error('API indisponible');
      serverResponded = true;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { status.textContent = data.message || 'La réservation n’a pas pu être enregistrée.'; submit.disabled = false; return; }
      status.textContent = 'Demande enregistrée dans le serveur démo.';
    } catch (error) {
      if (serverResponded) { status.textContent = error.message || 'La réservation n’a pas pu être enregistrée.'; submit.disabled = false; return; }
      const bookings = localBookings();
      if (bookings.filter((item) => item.date === booking.date && item.time === booking.time).length >= 8) {
        status.textContent = 'Ce créneau est complet. Choisissez-en un autre.'; submit.disabled = false; await loadSlots(); return;
      }
      bookings.push({ ...booking, id: crypto.randomUUID?.() || `${Date.now()}`, status: 'pending' });
      localStorage.setItem(storageKey, JSON.stringify(bookings));
      status.textContent = 'Demande enregistrée dans cette démonstration sur votre navigateur.';
    }
    const selectedCourse = form.querySelector('#class-choice').selectedOptions[0]?.textContent.split(' · ')[0] || 'votre cours';
    document.getElementById('success-copy').textContent = booking.name + ', votre demande pour ' + selectedCourse + ' du ' + new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' à ' + booking.time + ' est bien enregistrée. Cette démo n’envoie pas de confirmation réelle.';
    form.reset(); dateInput.value = booking.date; timeInput.value = ''; await loadSlots(); submit.disabled = false; dialog.showModal();
  });
  document.querySelector('.success-close').addEventListener('click', () => dialog.close());
  document.getElementById('success-done').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
})();
