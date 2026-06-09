// Global Application State
const state = {
  cacheHits: 0,
  totalCalls: 0,
  rateLimit: {
    limit: 5,
    remaining: 5,
    resetSeconds: 0,
    timer: null
  }
};

// ---------------------------------------------------------
// DOM ELEMENTS REFERENCE
// ---------------------------------------------------------
const navButtons = document.querySelectorAll('.nav-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const tabTitle = document.getElementById('current-tab-title');
const tabDesc = document.getElementById('current-tab-desc');

// Toast Container
const toastContainer = document.getElementById('toast-container');

// Dashboard Widgets
const dashRateLimit = document.getElementById('dash-rate-limit');
const rateProgress = document.getElementById('rate-progress');
const dashCacheHits = document.getElementById('dash-cache-hits');
const dashTotalCalls = document.getElementById('dash-total-calls');

// Cache Indicator
const cacheIndicator = document.getElementById('cache-indicator');
const cacheStatusVal = document.getElementById('cache-status-val');

// Gateway Output Console
const gatewayRenderArea = document.getElementById('gateway-render-area');
const gatewayExecutionTime = document.getElementById('gateway-execution-time');

// Chaos & Rate Limit Controls
const rateCounterValue = document.getElementById('rate-counter-value');
const rateLimitStatusLabel = document.getElementById('rate-limit-status-label');
const rateResetLabel = document.getElementById('rate-reset-label');
const btnFireRate = document.getElementById('btn-fire-rate');
const btnResetRateServer = document.getElementById('btn-reset-rate-server');
const chaosButtons = document.querySelectorAll('.btn-chaos');

// Network Inspector
const inspectorHttpStatus = document.getElementById('inspector-http-status');
const inspectorReqUrl = document.getElementById('inspector-req-url');
const inspectorResHeaders = document.getElementById('inspector-res-headers');
const inspectorResBody = document.getElementById('inspector-res-body');

// API Configuration Controls
const weatherCitySelect = document.getElementById('weather-city-select');
const btnFetchWeather = document.getElementById('btn-fetch-weather');
const githubSearchInput = document.getElementById('github-search-input');
const btnFetchGithub = document.getElementById('btn-fetch-github');

// ---------------------------------------------------------
// 1. NAVIGATION TAB ROUTING
// ---------------------------------------------------------
const tabMetadata = {
  'tab-dashboard': {
    title: 'Dashboard Status',
    desc: 'Monitor server health, cache stats, and API rate limits in real-time.'
  },
  'tab-oauth': {
    title: 'OAuth 2.0 Playground',
    desc: 'Simulate the Authorization Code Grant Flow step-by-step to acquire and refresh access tokens.'
  },
  'tab-external': {
    title: 'External API Gateway',
    desc: 'Integrate third-party services securely through server-side proxies with built-in cache layers.'
  },
  'tab-chaos': {
    title: 'Chaos Monkey & Rate Limiting',
    desc: 'Test endpoint limits under pressure and observe custom client error interception.'
  }
};

navButtons.forEach(button => {
  button.addEventListener('click', () => {
    const targetTab = button.getAttribute('data-tab');
    
    // Toggle navigation button classes
    navButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    // Toggle active panes
    tabPanes.forEach(pane => {
      if (pane.id === targetTab) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // Update Topbar Titles
    const meta = tabMetadata[targetTab];
    if (meta) {
      tabTitle.textContent = meta.title;
      tabDesc.textContent = meta.desc;
    }
  });
});

// ---------------------------------------------------------
// 2. TOAST NOTIFICATION UTILITY
// ---------------------------------------------------------
function showToast(title, message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const iconMap = {
    success: '✅',
    info: 'ℹ️',
    warning: '⚠️',
    danger: '🚨'
  };
  
  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || '⚡'}</span>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close">&times;</button>
  `;
  
  // Close button binding
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.style.transform = 'translateX(100px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  });
  
  // Auto-remove toast
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.transform = 'translateX(100px)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }
  }, 4500);

  toastContainer.appendChild(toast);
}

// ---------------------------------------------------------
// 3. CORE CUSTOM API FETCH CLIENT (WITH HEADER METRICS)
// ---------------------------------------------------------
async function apiFetch(url, options = {}) {
  const startTime = performance.now();
  
  // Set Request URL in Inspector
  const method = options.method || 'GET';
  inspectorReqUrl.textContent = `${method} ${url}`;
  
  // Record session activity
  state.totalCalls++;
  dashTotalCalls.textContent = state.totalCalls;

  try {
    const response = await fetch(url, options);
    const duration = Math.round(performance.now() - startTime);
    gatewayExecutionTime.textContent = `${duration}ms`;

    // Process Rate Limit Headers
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const resetSec = response.headers.get('X-RateLimit-Reset-Seconds');

    if (limit !== null && remaining !== null) {
      updateRateLimitState(parseInt(limit), parseInt(remaining), parseInt(resetSec || '0'));
    }

    // Process Caching Headers
    const cacheHeader = response.headers.get('X-Cache');
    if (cacheHeader) {
      cacheIndicator.classList.remove('hidden');
      cacheStatusVal.textContent = cacheHeader;
      if (cacheHeader === 'HIT') {
        cacheIndicator.classList.add('hit');
        state.cacheHits++;
        dashCacheHits.textContent = state.cacheHits;
        showToast('Cache HIT', 'Response served directly from Express memory cache.', 'success');
      } else {
        cacheIndicator.classList.remove('hit');
      }
    } else {
      cacheIndicator.classList.add('hidden');
    }

    // Log Network Inspector Details
    updateInspector(response, url);

    const data = await response.json();
    
    // Update inspector body
    inspectorResBody.textContent = JSON.stringify(data, null, 2);

    if (!response.ok) {
      const errMessage = data.error?.message || `HTTP ${response.status} Error`;
      const errCode = data.error?.code || 'API_ERROR';
      
      if (response.status === 429) {
        showToast('Rate Limit Exceeded', errMessage, 'danger');
      } else {
        showToast(`Error: ${errCode}`, errMessage, 'danger');
      }
      
      throw { status: response.status, data };
    }

    return data;

  } catch (error) {
    if (error.status) {
      throw error; // Re-throw api standard format errors
    }
    
    // Handle Offline / Network failure errors
    const duration = Math.round(performance.now() - startTime);
    gatewayExecutionTime.textContent = `${duration}ms`;
    
    inspectorHttpStatus.textContent = 'NETWORK_ERROR';
    inspectorHttpStatus.className = 'badge text-danger';
    inspectorResHeaders.textContent = '(Request Failed)';
    inspectorResBody.textContent = JSON.stringify({ error: { code: 'NETWORK_DISCONNECTED', message: 'The local API server failed to respond. Please confirm the server is running.' } }, null, 2);
    
    showToast('Network Disconnected', 'Failed to connect to the backend server.', 'danger');
    throw { status: 500, error: 'Network error' };
  }
}

// Update local UI regarding Rate Limits
function updateRateLimitState(limit, remaining, resetSec) {
  state.rateLimit.limit = limit;
  state.rateLimit.remaining = remaining;
  state.rateLimit.resetSeconds = resetSec;

  // Update Dashboard Status Card
  dashRateLimit.textContent = `${remaining} / ${limit}`;
  const percentage = (remaining / limit) * 100;
  rateProgress.style.width = `${percentage}%`;

  if (percentage <= 20) {
    rateProgress.style.backgroundColor = 'var(--accent-danger)';
  } else if (percentage <= 50) {
    rateProgress.style.backgroundColor = 'var(--accent-warning)';
  } else {
    rateProgress.style.backgroundColor = 'var(--accent-primary)';
  }

  // Update Rate Limit Sandbox Pane
  rateCounterValue.textContent = remaining;
  
  const gauge = document.querySelector('.rate-circle-gauge');
  if (remaining === 0) {
    rateLimitStatusLabel.textContent = 'RATE EXHAUSTED';
    rateLimitStatusLabel.className = 'text-danger';
    gauge.style.borderColor = 'var(--accent-danger)';
    gauge.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.4)';
  } else if (remaining <= 2) {
    rateLimitStatusLabel.textContent = 'LOW REMAINING';
    rateLimitStatusLabel.className = 'text-warning';
    gauge.style.borderColor = 'var(--accent-warning)';
    gauge.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.3)';
  } else {
    rateLimitStatusLabel.textContent = 'NORMAL';
    rateLimitStatusLabel.className = 'text-success';
    gauge.style.borderColor = 'var(--accent-primary)';
    gauge.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.25)';
  }

  // Handle countdown timer
  clearInterval(state.rateLimit.timer);
  if (remaining === 0 && resetSec > 0) {
    startRateCountdown(resetSec);
  } else {
    rateResetLabel.textContent = remaining === limit ? 'N/A' : 'Resets in window';
  }
}

// Countdown timer helper for 429
function startRateCountdown(seconds) {
  let timeLeft = seconds;
  rateResetLabel.textContent = `Resets in ${timeLeft}s`;
  
  state.rateLimit.timer = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(state.rateLimit.timer);
      rateResetLabel.textContent = 'Reset ready (Refresh details)';
    } else {
      rateResetLabel.textContent = `Resets in ${timeLeft}s`;
    }
  }, 1000);
}

// Sync headers into visual network inspector
function updateInspector(response, url) {
  // Update Status Pill
  inspectorHttpStatus.textContent = `${response.status} ${response.statusText}`;
  
  if (response.ok) {
    inspectorHttpStatus.className = 'badge text-success';
  } else if (response.status === 429) {
    inspectorHttpStatus.className = 'badge text-warning';
  } else {
    inspectorHttpStatus.className = 'badge text-danger';
  }

  // Read Headers
  let headersText = '';
  response.headers.forEach((value, name) => {
    headersText += `${name}: ${value}\n`;
  });
  
  inspectorResHeaders.textContent = headersText || '(No response headers returned)';
}

// ---------------------------------------------------------
// 4. EXTERNAL API RENDER WIDGETS
// ---------------------------------------------------------

// Weather Widget Renderer
function renderWeather(data) {
  const weatherSymbols = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
    45: '🌫️', 48: '🌫️',
    51: '🌧️', 53: '🌧️', 55: '🌧️',
    61: '🌧️', 63: '🌧️', 65: '🌧️',
    71: '🌨️', 73: '🌨️', 75: '🌨️',
    95: '⛈️'
  };

  const weatherCode = data.current_weather.weathercode;
  const icon = weatherSymbols[weatherCode] || '🌡️';

  gatewayRenderArea.innerHTML = `
    <div class="weather-result-card">
      <div class="weather-header">
        <div>
          <span class="weather-city">${data.city} Weather</span>
          <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Coords: ${data.latitude}°N, ${data.longitude}°E</div>
        </div>
        <div class="weather-temp">${data.current_weather.temperature}°C</div>
      </div>
      
      <div class="weather-grid">
        <div class="weather-item">
          <div class="weather-label">Condition</div>
          <div class="weather-val">${icon} Weather Code ${weatherCode}</div>
        </div>
        <div class="weather-item">
          <div class="weather-label">Wind Speed</div>
          <div class="weather-val">💨 ${data.current_weather.windspeed} km/h</div>
        </div>
        <div class="weather-item">
          <div class="weather-label">Wind Direction</div>
          <div class="weather-val">🧭 ${data.current_weather.winddirection}°</div>
        </div>
        <div class="weather-item">
          <div class="weather-label">Cached At</div>
          <div class="weather-val" style="font-family:'JetBrains Mono'; font-size:11px;">
            ${new Date(data.cachedAt).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  `;
}

// GitHub List Renderer
function renderGitHub(data) {
  if (data.total_count === 0 || data.items.length === 0) {
    gatewayRenderArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <p>No public repositories found matching your query.</p>
      </div>
    `;
    return;
  }

  let listHtml = '';
  data.items.forEach(repo => {
    listHtml += `
      <div class="github-repo-card">
        <div class="repo-header">
          <a href="${repo.html_url}" target="_blank" class="repo-name">${repo.full_name}</a>
          <span class="repo-lang">${repo.language || 'Plain Text'}</span>
        </div>
        <p class="repo-desc">${repo.description || 'No description provided by developers.'}</p>
        <div class="repo-stats">
          <span>⭐ ${repo.stargazers_count.toLocaleString()} stars</span>
          <span>🍴 ${repo.forks_count.toLocaleString()} forks</span>
          <span>ID: ${repo.id}</span>
        </div>
      </div>
    `;
  });

  gatewayRenderArea.innerHTML = `
    <div class="github-results-list">
      <div style="font-size:13px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">
        Found ${data.total_count.toLocaleString()} repositories. Showing top 5 cached results:
      </div>
      ${listHtml}
      <div style="font-size:10px; color:var(--text-muted); text-align:right; margin-top:8px;">
        Cached Gateway Record: ${new Date(data.cachedAt).toLocaleTimeString()}
      </div>
    </div>
  `;
}

// JSON Formatted Renderer (Default Fallback)
function renderJsonCode(data) {
  let jsonString = JSON.stringify(data, null, 2);
  
  // Syntax highlight simple JSON strings
  jsonString = jsonString.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const highlighted = jsonString.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (match) => {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });

  gatewayRenderArea.innerHTML = `<pre style="margin: 0; line-height: 1.5; white-space: pre-wrap;">${highlighted}</pre>`;
}

// ---------------------------------------------------------
// 5. EVENT BINDINGS FOR GATEWAY CONTROLLER
// ---------------------------------------------------------

// Weather Search trigger
btnFetchWeather.addEventListener('click', async () => {
  const selectedOption = weatherCitySelect.options[weatherCitySelect.selectedIndex];
  const cityName = selectedOption.value;
  const lat = selectedOption.getAttribute('data-lat');
  const lon = selectedOption.getAttribute('data-lon');
  
  gatewayRenderArea.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon animate-pulse">🛰️</div>
      <p>Consulting weather satellite proxies...</p>
    </div>
  `;

  try {
    const data = await apiFetch(`/api/weather?latitude=${lat}&longitude=${lon}&city=${cityName}`);
    renderWeather(data);
  } catch (error) {
    gatewayRenderArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon text-danger">⚠️</div>
        <p class="text-danger">Request Failed. Rate Limit or Server Error triggered.</p>
        <small class="font-mono text-muted">Status Code: ${error.status || 500}</small>
      </div>
    `;
  }
});

// GitHub Search trigger
btnFetchGithub.addEventListener('click', async () => {
  const query = githubSearchInput.value.trim();
  if (!query) {
    showToast('Search Query Empty', 'Please enter a keyword to search repositories.', 'warning');
    return;
  }

  gatewayRenderArea.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon animate-pulse">🐙</div>
      <p>Searching GitHub Public Indexes...</p>
    </div>
  `;

  try {
    const data = await apiFetch(`/api/github?q=${query}`);
    renderGitHub(data);
  } catch (error) {
    gatewayRenderArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon text-danger">⚠️</div>
        <p class="text-danger">Request Failed. Rate Limit or Server Error triggered.</p>
        <small class="font-mono text-muted">Status Code: ${error.status || 500}</small>
      </div>
    `;
  }
});

// ---------------------------------------------------------
// 6. EVENT BINDINGS FOR CHAOS & LIMITS
// ---------------------------------------------------------

// Rapid request rate limiter sandbox button
btnFireRate.addEventListener('click', async () => {
  try {
    const data = await apiFetch('/api/chaos?status=200');
    showToast('Request Success', 'A standard 200 OK query completed successfully.', 'success');
  } catch (error) {
    // Handled in apiFetch client
  }
});

// Reset Rate Limits Trigger
btnResetRateServer.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/rate-limit-reset', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateRateLimitState(5, 5, 0);
      showToast('Rate Limit Reset', 'Server-side rate window has been cleared for your IP.', 'success');
    }
  } catch (err) {
    showToast('Reset Failed', 'Failed to communicate with rate reset helper.', 'danger');
  }
});

// Chaos Monkey error triggers
chaosButtons.forEach(button => {
  button.addEventListener('click', async () => {
    const status = button.getAttribute('data-status');
    try {
      await apiFetch(`/api/chaos?status=${status}`);
    } catch (error) {
      // Intercepted and handled globally by apiFetch UI outputs
    }
  });
});

// Initial Setup
updateRateLimitState(5, 5, 0);
// Clear terminal log on setup
document.getElementById('btn-clear-logs').addEventListener('click', () => {
  document.getElementById('oauth-terminal').innerHTML = '<div class="terminal-line system">[System] Debug log cleared. Ready.</div>';
});
