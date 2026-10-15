(() => {
  const form = document.getElementById('setup-form');
  const email = document.getElementById('email');
  const token = document.getElementById('setup-token');
  const password = document.getElementById('password');
  const confirmation = document.getElementById('password-confirm');
  const status = document.getElementById('setup-status');
  const apiBase = (window.PORTFOLIO_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');

  const setStatus = (message, isError = true) => {
    status.textContent = message;
    status.classList.toggle('login-error', isError);
    status.classList.toggle('is-success', !isError);
  };

  fetch(`${apiBase}/api/setup/status`).then((response) => response.json()).then((data) => {
    if (!data.setupAvailable) {
      form.hidden = true;
      setStatus(data.configured ? 'Le compte administrateur a déjà été créé. Connectez-vous depuis la page de connexion.' : 'La création du compte sera activée lors de la mise en service du serveur.');
    }
  }).catch(() => setStatus('Serveur non connecté. La création du compte sera activée lors de la mise en service.'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    if (password.value !== confirmation.value) {
      setStatus('Les deux mots de passe ne correspondent pas.');
      confirmation.focus();
      return;
    }
    button.disabled = true;
    setStatus('Création de votre compte en cours…', false);
    try {
      const response = await fetch(`${apiBase}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value, setupToken: token.value, password: password.value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Création impossible.');
      setStatus('Votre compte est créé. Redirection vers la connexion…', false);
      form.reset();
      window.setTimeout(() => window.location.replace('login.html'), 1200);
    } catch (error) {
      setStatus(error.message === 'Failed to fetch' ? 'Serveur non connecté. Réessayez lorsque la mise en service sera terminée.' : error.message);
      button.disabled = false;
    }
  });
})();
