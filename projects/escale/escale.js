(() => {
  const form = document.getElementById('stay-form');
  const roomSelect = document.getElementById('room-choice');
  const roomNote = document.getElementById('room-choice-note');
  const date = document.getElementById('arrival-date');
  const status = document.getElementById('stay-status');
  const localDate = new Date();
  const offset = localDate.getTimezoneOffset();
  date.min = new Date(localDate.getTime() - offset * 60_000).toISOString().slice(0, 10);

  function updateRoom() {
    const option = roomSelect.selectedOptions[0];
    const room = option.textContent.split(' — ')[0];
    roomNote.textContent = `${room} · ${option.dataset.rate} € par nuit`;
  }

  document.querySelectorAll('.room-select').forEach((button) => {
    button.addEventListener('click', () => {
      roomSelect.value = button.dataset.room;
      updateRoom();
      document.getElementById('reservation').scrollIntoView({ behavior: 'smooth' });
      status.textContent = `${roomSelect.selectedOptions[0].textContent.split(' — ')[0]} sélectionnée. Choisissez vos dates pour afficher la simulation.`;
    });
  });
  roomSelect.addEventListener('change', updateRoom);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const option = roomSelect.selectedOptions[0];
    const room = option.textContent.split(' — ')[0];
    const nights = Number(form.elements.nights.value);
    const total = Number(option.dataset.rate) * nights;
    const arrival = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(`${date.value}T12:00:00`));
    const guests = Number(form.elements.guests.value);
    status.textContent = `Simulation : ${room}, ${nights} nuit${nights > 1 ? 's' : ''} à partir du ${arrival}, pour ${guests} personne${guests > 1 ? 's' : ''}. Total indicatif : ${total} €. Aucune réservation n’a été envoyée.`;
  });
})();
