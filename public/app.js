const TOKEN_KEY = 'focusboard_token_v13';
const USER_KEY = 'focusboard_user_v13';

// SINGLE GLOBAL STATE
let APP_STATE = {
  user: null,
  stats: null,
  today: null,
  recentActivities: null,
  isLoading: false,
  error: null
};

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
function getUser() { return APP_STATE.user; }
function authHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` }; }
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return [...document.querySelectorAll(sel)]; }

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearAuth();
    if (!location.pathname.endsWith('login.html') && !location.pathname.endsWith('register.html')) location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadAppState() {
  APP_STATE.isLoading = true;
  try {
    const response = await api('/api/me', { headers: authHeaders() });
    APP_STATE = { ...APP_STATE, ...response, isLoading: false };
    if (APP_STATE.user) applyTheme(APP_STATE.user.theme);
    return APP_STATE;
  } catch (err) {
    APP_STATE.error = err.message;
    APP_STATE.isLoading = false;
    if (getToken()) toast(`Error: ${err.message}`);
    throw err;
  }
}

function requireAuth() { if (!getToken()) location.href = '/login.html'; }
function logout() { clearAuth(); location.href = '/login.html'; }
function applyTheme(theme) { document.documentElement.className = `theme-${theme || 'cyan'}`; }
function formatMinutes(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h ${m}m` : `${m}m`; }
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function renderProgressRing(element, completed, target, type) {
  if (!element) return;
  const percentage = Math.min(100, Math.round((completed / Math.max(target, 1)) * 100));
  const color = `var(--accent-${type})`;
  const conic = `conic-gradient(${color} 0deg ${percentage}%, transparent 0deg)`;
  element.style.background = conic;
  element.innerHTML = `<div class="ring-inner"><span>${percentage}%</span></div>`;
}

function sidebar(active) {
  const user = APP_STATE.user || { name: 'User', plan: 'free' };
  return `
  <aside class="sidebar">
    <div class="brand">FocusBoard</div>
    <div class="brand-sub">P-1.1 · Focused Execution</div>
    <div class="streak-badge-mini">
      <span class="icon">🔥</span> ${user.streak || 0} Day Streak
    </div>
    <nav class="nav">
      ${[['dashboard.html', 'Dashboard'], ['study.html', 'Study'], ['fitness.html', 'Fitness'], ['projects.html', 'Projects'], ['analytics.html', 'Analytics'], ['profile.html', 'Profile']].map(([href, label]) => `<a href="/${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('')}
    </nav>
    <div class="sidebar-user">
      <div class="muted" style="font-size:12px">Signed in as</div>
      <div style="font-weight:700; margin-top:6px">${user.name}</div>
      <div class="muted" style="margin-top:4px">Plan: ${user.plan || 'free'}</div>
      <div class="actions" style="margin-top:14px"><button class="btn-logout" onclick="logout()">Logout</button></div>
    </div>
  </aside>`;
}

function shell(active, title, subtitle, content) {
  document.body.classList.add('page-bg');
  document.body.innerHTML = `
    <div class="aurora one"></div><div class="aurora two"></div>
    <div class="app">
      ${sidebar(active)}
      <main class="main">
        <div class="topbar">
          <div><div class="title">${title}</div><div class="subtitle">${subtitle}</div></div>
          <div class="actions"><a class="btn-theme" href="/settings.html">Settings</a></div>
        </div>
        <div class="content-fade-in">
          ${content}
        </div>
      </main>
    </div>
    <div id="toast" class="toast"></div>`;
}

// Handle Auth Pages
if (location.pathname.endsWith('login.html') || location.pathname.endsWith('register.html')) {
  document.addEventListener('DOMContentLoaded', () => {
    const loginForm = qs('#loginForm');
    const registerForm = qs('#registerForm');

    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = qs('#email').value;
      const password = qs('#password').value;
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        setToken(data.token);
        location.href = '/index.html';
      } catch (err) {
        toast(err.message);
      }
    });

    registerForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = qs('#name').value;
      const email = qs('#email').value;
      const password = qs('#password').value;
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        setToken(data.token);
        location.href = '/index.html';
      } catch (err) {
        toast(err.message);
      }
    });
  });
}