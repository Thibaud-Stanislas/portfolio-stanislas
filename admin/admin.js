(() => {
  const token = sessionStorage.getItem('adminToken');
  if (!token) { window.location.replace('login.html'); return; }

  const list = document.getElementById('messages-list');
  const total = document.getElementById('total-count');
  const unprocessed = document.getElementById('unprocessed-count');
  const unread = document.getElementById('unread-count');
  const summary = document.getElementById('message-summary');
  const banner = document.getElementById('email-connection-banner');
  const modal = document.getElementById('gmail-setup-modal');
  const setupStatus = document.getElementById('gmail-setup-status');
  const scriptSource = document.getElementById('gmail-script-source');
  const filterButtons = [...document.querySelectorAll('.filter-tab')];
  const apiBase = (window.PORTFOLIO_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  const composers = new Set();
  const drafts = new Map();
  let messages = [];
  let activeFilter = 'all';
  let emailStatus = null;
  let emailStatusError = '';
  let toastTimer;
  let isLoading = false;

  async function api(path, options = {}) {
    const response = await fetch(`${apiBase}/api${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
    });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem('adminToken');
      window.location.replace('login.html');
      throw new Error('Session expirée.');
    }
    if (!response.ok) throw new Error(data.message || (response.status === 404 ? 'Cette fonction n’est pas encore disponible sur le serveur.' : 'Une erreur est survenue.'));
    return data;
  }

  function toast(message) {
    const element = document.getElementById('toast');
    element.textContent = message;
    element.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('show'), 3200);
  }

  function formatDate(value) {
    const text = String(value || '');
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function setCounts() {
    const pendingCount = messages.filter((item) => !item.is_processed).length;
    const unreadCount = messages.filter((item) => !item.is_read).length;
    total.textContent = String(messages.length);
    unprocessed.textContent = String(pendingCount);
    unread.textContent = String(unreadCount);
    document.getElementById('sidebar-count').textContent = String(pendingCount);
    document.getElementById('all-filter-count').textContent = String(messages.length);
    document.getElementById('pending-filter-count').textContent = String(pendingCount);
    summary.textContent = messages.length ? `${messages.length} demande${messages.length === 1 ? '' : 's'} reçue${messages.length === 1 ? '' : 's'}` : 'Aucun message pour le moment';
  }

  function createAction(label, className, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `message-action ${className || ''}`;
    button.textContent = label;
    button.addEventListener('click', callback);
    return button;
  }

  function statusLabel(reply) {
    if (reply.direction === 'inbound') return 'REÇU';
    return ({ pending: 'EN ATTENTE', sending: 'ENVOI EN COURS', sent: 'ENVOYÉ', failed: 'ÉCHEC' })[reply.status] || 'RÉPONSE';
  }

  function renderReply(message, reply) {
    const item = document.createElement('article');
    item.className = `conversation-reply ${reply.direction === 'outbound' ? 'is-outbound' : 'is-inbound'} ${reply.status === 'failed' ? 'has-failed' : ''}`;
    const heading = document.createElement('div');
    heading.className = 'conversation-reply-heading';
    const sender = document.createElement('strong');
    sender.textContent = reply.direction === 'outbound' ? 'Vous' : message.name;
    const meta = document.createElement('span');
    meta.textContent = `${statusLabel(reply)} · ${formatDate(reply.sent_at || reply.created_at)}`;
    heading.append(sender, meta);
    const body = document.createElement('p');
    body.className = 'conversation-reply-body';
    body.textContent = reply.body;
    item.append(heading, body);
    if (reply.last_error) {
      const error = document.createElement('p');
      error.className = 'conversation-reply-error';
      error.textContent = reply.last_error;
      item.append(error);
    }
    if (reply.direction === 'outbound' && reply.status === 'failed') {
      const retry = createAction('Réessayer l’envoi', '', async () => {
        retry.disabled = true;
        try {
          await api(`/messages/${message.id}/replies/${reply.id}/retry`, { method: 'POST', body: {} });
          await loadMessages();
          toast('Nouvel essai d’envoi demandé.');
        } catch (error) { retry.disabled = false; toast(error.message); }
      });
      retry.classList.add('conversation-retry');
      item.append(retry);
    }
    return item;
  }

  function renderComposer(message) {
    const form = document.createElement('form');
    form.className = 'reply-composer';
    const label = document.createElement('label');
    label.htmlFor = `reply-${message.id}`;
    label.textContent = `Votre réponse à ${message.name}`;
    const textarea = document.createElement('textarea');
    textarea.id = `reply-${message.id}`;
    textarea.name = 'reply';
    textarea.rows = 4;
    textarea.maxLength = 5000;
    textarea.required = true;
    textarea.placeholder = 'Écrivez votre réponse…';
    textarea.value = drafts.get(message.id) || '';
    textarea.addEventListener('input', () => drafts.set(message.id, textarea.value));
    const footer = document.createElement('div');
    footer.className = 'reply-composer-footer';
    const note = document.createElement('span');
    note.textContent = emailStatus?.connected ? `Envoi depuis ${emailStatus.googleEmail || emailStatus.adminEmail}` : 'Reliez Gmail pour envoyer cette réponse.';
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'message-action primary-action';
    send.textContent = 'Envoyer la réponse ↗';
    send.disabled = !emailStatus?.connected;
    footer.append(note, send);
    form.append(label, textarea, footer);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      if (!body) return;
      send.disabled = true;
      try {
        await api(`/messages/${message.id}/replies`, { method: 'POST', body: { body } });
        drafts.delete(message.id);
        composers.delete(message.id);
        await loadMessages();
        toast('Réponse enregistrée. Gmail va l’envoyer dans quelques instants.');
      } catch (error) {
        send.disabled = false;
        toast(error.message);
      }
    });
    return form;
  }

  function render() {
    setCounts();
    const visible = messages.filter((item) => activeFilter === 'all' || (activeFilter === 'unprocessed' ? !item.is_processed : !!item.is_processed));
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const icon = document.createElement('span');
      icon.className = 'empty-icon';
      icon.textContent = activeFilter === 'all' ? '✳' : '✓';
      const copy = document.createElement('p');
      copy.textContent = activeFilter === 'all' ? 'Les nouveaux messages apparaîtront ici.' : 'Aucun message dans cette catégorie.';
      empty.append(icon, copy);
      list.append(empty);
      return;
    }

    visible.forEach((message) => {
      const card = document.createElement('article');
      card.className = `message-card${message.is_processed ? '' : ' is-unprocessed'}`;
      const top = document.createElement('div');
      top.className = 'message-topline';
      const sender = document.createElement('div');
      sender.className = 'sender-block';
      const avatar = document.createElement('span');
      avatar.className = 'sender-avatar';
      avatar.textContent = (message.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('') || '?').toUpperCase();
      const details = document.createElement('div');
      details.className = 'sender-details';
      const name = document.createElement('p');
      name.className = 'sender-name';
      name.textContent = message.name;
      const email = document.createElement('span');
      email.className = 'sender-email';
      email.textContent = message.email;
      details.append(name, email);
      sender.append(avatar, details);
      const date = document.createElement('time');
      date.className = 'message-date';
      date.dateTime = message.created_at;
      date.textContent = formatDate(message.created_at);
      top.append(sender, date);

      const badges = document.createElement('div');
      badges.className = 'message-badges';
      const state = document.createElement('span');
      state.className = `message-badge ${message.is_processed ? '' : 'pending'}`;
      state.textContent = message.is_processed ? 'TRAITÉ' : 'À TRAITER';
      const readState = document.createElement('span');
      readState.className = `message-badge ${message.is_read ? '' : 'unread'}`;
      readState.textContent = message.is_read ? 'LU' : 'NON LU';
      badges.append(state, readState);
      const body = document.createElement('p');
      body.className = 'message-body';
      body.textContent = message.message;
      card.append(top, badges, body);

      const replies = Array.isArray(message.replies) ? message.replies : [];
      if (replies.length) {
        const thread = document.createElement('div');
        thread.className = 'conversation-thread';
        const heading = document.createElement('p');
        heading.className = 'conversation-thread-label';
        heading.textContent = 'CONVERSATION PAR E-MAIL';
        thread.append(heading, ...replies.map((reply) => renderReply(message, reply)));
        card.append(thread);
      }

      const actions = document.createElement('div');
      actions.className = 'message-actions';
      const reply = createAction(composers.has(message.id) ? 'Fermer la réponse' : 'Répondre', 'primary-action', () => {
        if (composers.has(message.id)) composers.delete(message.id);
        else composers.add(message.id);
        render();
      });
      reply.setAttribute('aria-expanded', String(composers.has(message.id)));
      actions.append(reply);
      actions.append(createAction(message.is_processed ? 'Remettre à traiter' : 'Marquer comme traité', '', () => updateMessage(message.id, message.is_processed ? 'unprocessed' : 'processed')));
      actions.append(createAction(message.is_read ? 'Marquer comme non lu' : 'Marquer comme lu', '', () => updateMessage(message.id, message.is_read ? 'unread' : 'read')));
      actions.append(createAction('Supprimer', 'danger', () => deleteMessage(message.id)));
      card.append(actions);
      if (composers.has(message.id)) {
        const composer = renderComposer(message);
        card.append(composer);
      }
      list.append(card);
    });
  }

  function renderEmailBanner() {
    banner.replaceChildren();
    const copy = document.createElement('div');
    copy.className = 'email-connection-copy';
    const title = document.createElement('strong');
    const description = document.createElement('p');
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'message-action email-connection-action';
    if (emailStatus?.connected) {
      banner.className = 'email-connection-banner is-connected';
      title.textContent = `Gmail relié · ${emailStatus.googleEmail || emailStatus.adminEmail}`;
      description.textContent = emailStatus.lastSyncAt ? `Les envois et réponses se synchronisent automatiquement. Dernière synchronisation : ${formatDate(emailStatus.lastSyncAt)}.` : 'Les envois et réponses se synchronisent automatiquement.';
      action.textContent = 'Dissocier Gmail';
      action.addEventListener('click', disconnectEmail);
    } else {
      banner.className = `email-connection-banner ${emailStatusError ? 'has-error' : ''}`;
      title.textContent = emailStatusError ? 'L’état de la messagerie est indisponible.' : 'Répondre depuis l’admin et recevoir les retours ici.';
      description.textContent = emailStatusError || 'Reliez votre Gmail une fois pour envoyer et synchroniser les conversations sans service payant.';
      action.textContent = emailStatus ? 'Relier Gmail gratuitement' : 'Vérifier la messagerie';
      action.addEventListener('click', () => {
        if (emailStatus) openGmailSetup();
        else loadEmailStatus();
      });
    }
    copy.append(title, description);
    banner.append(copy, action);
  }

  async function loadEmailStatus() {
    try {
      const wasConnected = emailStatus?.connected;
      emailStatus = await api('/email/bridge/status');
      emailStatusError = '';
      renderEmailBanner();
      if (wasConnected !== emailStatus.connected) render();
    } catch (error) {
      emailStatusError = error.message || 'Impossible de vérifier Gmail.';
      renderEmailBanner();
    }
  }

  async function loadMessages() {
    if (isLoading) return;
    isLoading = true;
    try {
      messages = await api('/messages');
      render();
    } catch (error) {
      list.replaceChildren();
      const state = document.createElement('div');
      state.className = 'empty-state error-state';
      const copy = document.createElement('p');
      copy.textContent = error.message || 'Impossible de récupérer les messages.';
      state.append(copy);
      list.append(state);
    } finally {
      isLoading = false;
    }
  }

  async function updateMessage(id, action) {
    try { await api(`/messages/${id}/${action}`, { method: 'PATCH' }); await loadMessages(); toast('Le message a bien été mis à jour.'); }
    catch (error) { toast(error.message); }
  }

  async function deleteMessage(id) {
    if (!window.confirm('Supprimer définitivement ce message et son fil de réponse ?')) return;
    try { await api(`/messages/${id}`, { method: 'DELETE' }); await loadMessages(); toast('Le message a bien été supprimé.'); }
    catch (error) { toast(error.message); }
  }

  function openGmailSetup() {
    setupStatus.textContent = '';
    document.getElementById('gmail-setup-intro').hidden = false;
    document.getElementById('gmail-setup-steps').hidden = true;
    scriptSource.value = '';
    scriptSource.hidden = true;
    modal.hidden = false;
    document.getElementById('prepare-gmail-setup').focus();
  }

  async function prepareGmailSetup() {
    const button = document.getElementById('prepare-gmail-setup');
    button.disabled = true;
    setupStatus.textContent = 'Préparation du script sécurisé…';
    try {
      const pairing = await api('/email/bridge/pairing', { method: 'POST' });
      const response = await fetch('gmail-bridge.gs', { cache: 'no-store' });
      if (!response.ok) throw new Error('Le script de connexion est introuvable. Actualisez la page puis réessayez.');
      const template = await response.text();
      const source = template
        .replace('__PORTFOLIO_API_BASE__', pairing.apiBaseUrl)
        .replace('__PORTFOLIO_PAIRING_CODE__', pairing.pairingCode);
      scriptSource.value = source;
      document.getElementById('gmail-setup-intro').hidden = true;
      document.getElementById('gmail-setup-steps').hidden = false;
      try {
        await navigator.clipboard.writeText(source);
        setupStatus.textContent = 'Script copié. Ouvrez Apps Script puis collez-le dans Code.gs.';
      } catch {
        scriptSource.hidden = false;
        scriptSource.focus();
        scriptSource.select();
        setupStatus.textContent = 'La copie automatique est bloquée. Copiez le texte sélectionné ci-dessous.';
      }
    } catch (error) {
      setupStatus.textContent = error.message || 'Impossible de préparer la connexion Gmail.';
    } finally {
      button.disabled = false;
    }
  }

  async function copyGmailScript() {
    try {
      await navigator.clipboard.writeText(scriptSource.value);
      setupStatus.textContent = 'Script copié. Collez-le dans Code.gs sur Apps Script.';
    } catch {
      scriptSource.hidden = false;
      scriptSource.focus();
      scriptSource.select();
      setupStatus.textContent = 'Copiez le texte sélectionné, puis collez-le dans Code.gs.';
    }
  }

  async function disconnectEmail() {
    if (!window.confirm('Dissocier Gmail ? Les réponses ne seront plus envoyées et les nouveaux retours ne seront plus importés.')) return;
    try {
      await api('/email/bridge/disconnect', { method: 'POST', body: {} });
      emailStatus = { connected: false, adminEmail: emailStatus?.adminEmail };
      renderEmailBanner();
      render();
      toast('Gmail a été dissocié.');
    } catch (error) { toast(error.message); }
  }

  filterButtons.forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    render();
  }));

  document.getElementById('refresh-messages').addEventListener('click', () => { loadMessages(); loadEmailStatus(); });
  document.getElementById('logout').addEventListener('click', () => { sessionStorage.removeItem('adminToken'); window.location.replace('login.html'); });
  document.getElementById('prepare-gmail-setup').addEventListener('click', prepareGmailSetup);
  document.getElementById('copy-gmail-script').addEventListener('click', copyGmailScript);
  document.getElementById('close-gmail-setup').addEventListener('click', () => { modal.hidden = true; });
  modal.querySelector('[data-close-gmail-modal]').addEventListener('click', () => { modal.hidden = true; });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) modal.hidden = true; });
  loadMessages();
  loadEmailStatus();
  window.setInterval(() => {
    if (!document.hidden) { loadMessages(); loadEmailStatus(); }
  }, 45000);
})();

