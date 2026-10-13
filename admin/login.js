(() => {
  const form = document.getElementById('login-form');
  const password = document.getElementById('password');
  const status = document.getElementById('login-status');
  const apiBase = (window.PORTFOLIO_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  if (sessionStorage.getItem('adminToken')) window.location.replace('index.html');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button'); button.disabled = true; status.textContent = 'Vérification en cours…'; status.classList.remove('login-error');
    try {
      const response = await fetch(`${apiBase}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || (response.status === 404 ? 'Serveur non connecté. Configurez l’adresse de l’API pour activer la connexion.' : 'Connexion impossible.'));
      sessionStorage.setItem('adminToken', data.token); window.location.replace('index.html');
    } catch (error) { status.textContent = error.message === 'Failed to fetch' ? 'Serveur non connecté. Configurez l’adresse de l’API pour activer la connexion.' : error.message; status.classList.add('login-error'); button.disabled = false; }
  });
})();

