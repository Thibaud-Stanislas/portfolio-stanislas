(() => {
  const token = sessionStorage.getItem('adminToken');
  if (!token) { window.location.replace('login.html'); return; }
  const list = document.getElementById('messages-list');
  const total = document.getElementById('total-count');
  const unprocessed = document.getElementById('unprocessed-count');
  const unread = document.getElementById('unread-count');
  const summary = document.getElementById('message-summary');
  const filterButtons = [...document.querySelectorAll('.filter-tab')];
  const apiBase = (window.PORTFOLIO_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  let messages = [];
  let activeFilter = 'all';
  let toastTimer;

  async function api(path, options = {}) {
    const response = await fetch(`${apiBase}/api${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (response.status === 401) { sessionStorage.removeItem('adminToken'); window.location.replace('login.html'); throw new Error('Session expirée.'); }
    if (!response.ok) throw new Error(data.message || (response.status === 404 ? 'Serveur non connecté. Configurez l’adresse de l’API.' : 'Une erreur est survenue.'));
    return data;
  }
  function toast(message) {
    const element = document.getElementById('toast'); element.textContent = message; element.classList.add('show');
    window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => element.classList.remove('show'), 2600);
  }
  function setCounts() {
    const pendingCount = messages.filter((item) => !item.is_processed).length;
    const unreadCount = messages.filter((item) => !item.is_read).length;
    total.textContent = String(messages.length); unprocessed.textContent = String(pendingCount); unread.textContent = String(unreadCount);
    document.getElementById('sidebar-count').textContent = String(pendingCount);
    document.getElementById('all-filter-count').textContent = String(messages.length);
    document.getElementById('pending-filter-count').textContent = String(pendingCount);
    summary.textContent = messages.length ? `${messages.length} demande${messages.length === 1 ? '' : 's'} reçue${messages.length === 1 ? '' : 's'}` : 'Aucun message pour le moment';
  }
  function createAction(label, className, callback) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `message-action ${className || ''}`; button.textContent = label;
    button.addEventListener('click', callback); return button;
  }
  function formatDate(value) {
    const date = new Date(`${String(value).replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  function render() {
    setCounts();
    const visible = messages.filter((item) => activeFilter === 'all' || (activeFilter === 'unprocessed' ? !item.is_processed : !!item.is_processed));
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      const icon = document.createElement('span'); icon.className = 'empty-icon'; icon.textContent = activeFilter === 'all' ? '✳' : '✓';
      const copy = document.createElement('p'); copy.textContent = activeFilter === 'all' ? 'Les nouveaux messages apparaîtront ici.' : 'Aucun message dans cette catégorie.';
      empty.append(icon, copy); list.append(empty); return;
    }
    visible.forEach((message) => {
      const card = document.createElement('article'); card.className = `message-card${message.is_processed ? '' : ' is-unprocessed'}`;
      const top = document.createElement('div'); top.className = 'message-topline';
      const sender = document.createElement('div'); sender.className = 'sender-block';
      const avatar = document.createElement('span'); avatar.className = 'sender-avatar'; avatar.textContent = (message.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('') || '?').toUpperCase();
      const details = document.createElement('div'); details.className = 'sender-details';
      const name = document.createElement('p'); name.className = 'sender-name'; name.textContent = message.name;
      const email = document.createElement('span'); email.className = 'sender-email'; email.textContent = message.email;
      details.append(name, email); sender.append(avatar, details);
      const date = document.createElement('time'); date.className = 'message-date'; date.dateTime = message.created_at; date.textContent = formatDate(message.created_at);
      top.append(sender, date);
      const badges = document.createElement('div'); badges.className = 'message-badges';
      const state = document.createElement('span'); state.className = `message-badge ${message.is_processed ? '' : 'pending'}`; state.textContent = message.is_processed ? 'TRAITÉ' : 'À TRAITER';
      const readState = document.createElement('span'); readState.className = `message-badge ${message.is_read ? '' : 'unread'}`; readState.textContent = message.is_read ? 'LU' : 'NON LU'; badges.append(state, readState);
      const body = document.createElement('p'); body.className = 'message-body'; body.textContent = message.message;
      const actions = document.createElement('div'); actions.className = 'message-actions';
      const reply = document.createElement('a'); reply.className = 'message-action primary-action'; reply.textContent = 'Répondre ↗'; reply.href = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent('Votre demande de contact')}`;
      actions.append(reply);
      actions.append(createAction(message.is_processed ? 'Remettre à traiter' : 'Marquer comme traité', '', () => updateMessage(message.id, message.is_processed ? 'unprocessed' : 'processed')));
      actions.append(createAction(message.is_read ? 'Marquer comme non lu' : 'Marquer comme lu', '', () => updateMessage(message.id, message.is_read ? 'unread' : 'read')));
      actions.append(createAction('Supprimer', 'danger', () => deleteMessage(message.id)));
      card.append(top, badges, body, actions); list.append(card);
    });
  }
  async function loadMessages() {
    list.innerHTML = '<div class="loading-state"><span class="loading-orbit"></span><p>Récupération des messages…</p></div>';
    try { messages = await api('/messages'); render(); }
    catch (error) { list.replaceChildren(); const state = document.createElement('div'); state.className = 'empty-state error-state'; const copy = document.createElement('p'); copy.textContent = error.message || 'Impossible de récupérer les messages.'; state.append(copy); list.append(state); }
  }
  async function updateMessage(id, action) {
    try { await api(`/messages/${id}/${action}`, { method: 'PATCH' }); await loadMessages(); toast('Le message a bien été mis à jour.'); }
    catch (error) { toast(error.message); }
  }
  async function deleteMessage(id) {
    if (!window.confirm('Supprimer définitivement ce message ?')) return;
    try { await api(`/messages/${id}`, { method: 'DELETE' }); await loadMessages(); toast('Message supprimé.'); }
    catch (error) { toast(error.message); }
  }
  filterButtons.forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    render();
  }));
  document.getElementById('refresh-messages').addEventListener('click', loadMessages);
  document.getElementById('logout').addEventListener('click', () => { sessionStorage.removeItem('adminToken'); window.location.replace('login.html'); });
  loadMessages();
})();

