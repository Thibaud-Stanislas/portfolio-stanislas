(() => {
  const body = document.body;
  const themeButton = document.querySelector('.theme-toggle');
  const savedTheme = localStorage.getItem('portfolio-theme');
  if (savedTheme === 'light') body.classList.add('light-theme');

  function updateThemeLabel() {
    const light = body.classList.contains('light-theme');
    themeButton?.setAttribute('aria-label', light ? 'Activer le thème sombre' : 'Activer le thème clair');
    if (themeButton) themeButton.querySelector('.theme-label').textContent = light ? 'Mode sombre' : 'Mode clair';
    if (themeButton) themeButton.querySelector('.theme-icon').textContent = light ? '☾' : '☼';
  }
  updateThemeLabel();
  themeButton?.addEventListener('click', () => {
    body.classList.toggle('light-theme');
    localStorage.setItem('portfolio-theme', body.classList.contains('light-theme') ? 'light' : 'dark');
    updateThemeLabel();
  });

  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.querySelector('.nav-menu');
  menuToggle?.addEventListener('click', () => {
    const open = navMenu.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
  });
  navMenu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    navMenu.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  }));

  const filters = document.querySelectorAll('[data-filter]');
  const cards = document.querySelectorAll('.work-card[data-category]');
  filters.forEach((button) => button.addEventListener('click', () => {
    const category = button.dataset.filter;
    filters.forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    cards.forEach((card) => { card.hidden = category !== 'all' && card.dataset.category !== category; });
  }));

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }), { threshold: 0.12 }) : null;
  document.querySelectorAll('.reveal').forEach((element) => observer ? observer.observe(element) : element.classList.add('is-visible'));

  const form = document.getElementById('contact-form');
  const status = document.getElementById('form-status');
  const apiBase = (window.PORTFOLIO_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.website) { form.reset(); status.textContent = 'Merci, votre message est prêt.'; return; }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Envoi en cours…';
    try {
      const response = await fetch(`${apiBase}/api/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: values.name.trim(), email: values.email.trim(), message: values.message.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Le message ne peut pas être envoyé.');
      form.reset(); status.textContent = 'Merci ! Votre message a bien été envoyé. Je reviens vers vous sous 48 h.';
    } catch {
      const subject = encodeURIComponent(`Demande de contact — ${values.name.trim()}`);
      const message = encodeURIComponent(`Bonjour Stanislas,\n\n${values.message.trim()}\n\n${values.name.trim()}\n${values.email.trim()}`);
      status.textContent = 'Le formulaire en ligne sera actif dès que le serveur sera configuré. Votre messagerie peut préparer le message.';
      window.location.href = `mailto:stanislas.thibaud@gmail.com?subject=${subject}&body=${message}`;
    } finally { submit.disabled = false; }
  });
  document.getElementById('year').textContent = new Date().getFullYear();
})();
