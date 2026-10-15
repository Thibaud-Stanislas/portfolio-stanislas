// The GitHub Pages copy uses the Cloudflare Pages API for forms and administration.
// Cloudflare Pages serves both the site and its API on the same host.
const isGithubPages = window.location.hostname === "thibaud-stanislas.github.io";
window.PORTFOLIO_CONFIG = {
  apiBaseUrl: isGithubPages ? "https://portfolio-stanislas.pages.dev" : ""
};


