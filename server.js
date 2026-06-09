const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// 1. IN-MEMORY STORES & CACHE
// ---------------------------------------------------------
// Rate Limiting Store: IP -> array of timestamps
const rateLimitStore = {};

// Cache Store: URL/Key -> { data, expiry }
const cacheStore = {};

// OAuth Code Store: code -> { client_id, scope, redirect_uri, expiresAt }
const authCodesStore = {};

// OAuth Token Store: token -> { client_id, scope, expiresAt, refresh_token }
const activeTokensStore = {};
const refreshTokensStore = {};

// ---------------------------------------------------------
// 2. HELPER FUNCTIONS
// ---------------------------------------------------------

// Helper to make HTTPS requests (Native Node.js, no external fetch package needed)
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'NodeJS-OAuth-App',
        ...headers
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject({ status: res.statusCode, message: 'Invalid JSON response from external API' });
          }
        } else {
          try {
            const parsed = JSON.parse(data);
            reject({ status: res.statusCode, body: parsed });
          } catch (e) {
            reject({ status: res.statusCode, message: `HTTP Error: ${res.statusCode}` });
          }
        }
      });
    }).on('error', (err) => {
      reject({ status: 500, message: `Network request failed: ${err.message}` });
    });
  });
}

// ---------------------------------------------------------
// 3. MIDDLEWARE: CUSTOM RATE LIMITER
// ---------------------------------------------------------
// Limit: 5 requests per 30 seconds per IP
const RATE_LIMIT_WINDOW_MS = 30000; // 30 seconds
const RATE_LIMIT_MAX = 5;

function customRateLimiter(req, res, next) {
  // Bypass static assets
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path === '/' || req.path === '/index.html') {
    return next();
  }
  
  // Also bypass developer helpers like resetting rate limit
  if (req.path === '/api/rate-limit-reset') {
    return next();
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const now = Date.now();

  // Initialize or clean up old timestamps
  if (!rateLimitStore[ip]) {
    rateLimitStore[ip] = [];
  }
  
  // Filter out timestamps outside the current window
  rateLimitStore[ip] = rateLimitStore[ip].filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);

  const requestCount = rateLimitStore[ip].length;
  
  // Calculate remaining requests (including current attempt)
  const remaining = Math.max(0, RATE_LIMIT_MAX - (requestCount + 1));
  
  // Calculate when the oldest request in window will expire (Reset time in epoch ms)
  let resetTime = now + RATE_LIMIT_WINDOW_MS;
  if (rateLimitStore[ip].length > 0) {
    resetTime = rateLimitStore[ip][0] + RATE_LIMIT_WINDOW_MS;
  }
  const secondsToReset = Math.max(0, Math.ceil((resetTime - now) / 1000));

  // Set Standard Rate Limiting Headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000)); // standard is Unix epoch timestamp in seconds
  res.setHeader('X-RateLimit-Reset-Seconds', secondsToReset); // custom helpers

  if (requestCount >= RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', secondsToReset);
    return res.status(429).json({
      error: {
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too Many Requests. Rate limit of ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000} seconds exceeded.`,
        retryAfterSeconds: secondsToReset,
        resetTimeEpoch: resetTime
      }
    });
  }

  // Record request
  rateLimitStore[ip].push(now);
  next();
}

app.use(customRateLimiter);

// Developer endpoint to reset rate limits for testing
app.post('/api/rate-limit-reset', (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  rateLimitStore[ip] = [];
  res.json({ success: true, message: 'Rate limits reset successfully.' });
});

// ---------------------------------------------------------
// 4. API GATEWAY / EXTERNAL API PROXY
// ---------------------------------------------------------

// Proxy to weather API (Open-Meteo) with custom caching
app.get('/api/weather', async (req, res) => {
  const { latitude, longitude, city } = req.query;
  
  if (!latitude || !longitude) {
    return res.status(400).json({
      error: {
        status: 400,
        code: 'BAD_REQUEST',
        message: 'Query parameters "latitude" and "longitude" are required.'
      }
    });
  }

  const cacheKey = `weather_${latitude}_${longitude}`;
  const now = Date.now();
  const CACHE_TTL_MS = 10000; // 10 seconds cache

  // Check cache
  if (cacheStore[cacheKey] && now < cacheStore[cacheKey].expiry) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cacheStore[cacheKey].data);
  }

  res.setHeader('X-Cache', 'MISS');

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=temperature_2m,relativehumidity_2m,windspeed_10m`;
    const response = await fetchJson(url);
    
    // Store in cache
    cacheStore[cacheKey] = {
      data: {
        city: city || 'Unknown Location',
        latitude,
        longitude,
        current_weather: response.body.current_weather,
        cachedAt: new Date(now).toISOString()
      },
      expiry: now + CACHE_TTL_MS
    };

    res.json(cacheStore[cacheKey].data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        status: error.status || 500,
        code: 'EXTERNAL_API_ERROR',
        message: error.message || 'Failed to fetch weather data from Open-Meteo.'
      }
    });
  }
});

// Proxy to GitHub Repository Search API with caching
app.get('/api/github', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({
      error: {
        status: 400,
        code: 'BAD_REQUEST',
        message: 'Query parameter "q" (search query) is required.'
      }
    });
  }

  const cacheKey = `github_${q}`;
  const now = Date.now();
  const CACHE_TTL_MS = 15000; // 15 seconds cache

  // Check cache
  if (cacheStore[cacheKey] && now < cacheStore[cacheKey].expiry) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(cacheStore[cacheKey].data);
  }

  res.setHeader('X-Cache', 'MISS');

  try {
    const encodedQ = encodeURIComponent(q);
    const url = `https://api.github.com/search/repositories?q=${encodedQ}&per_page=5`;
    const response = await fetchJson(url);

    const formattedData = {
      query: q,
      total_count: response.body.total_count,
      items: response.body.items.map(item => ({
        id: item.id,
        name: item.name,
        full_name: item.full_name,
        html_url: item.html_url,
        description: item.description,
        stargazers_count: item.stargazers_count,
        forks_count: item.forks_count,
        language: item.language
      })),
      cachedAt: new Date(now).toISOString()
    };

    cacheStore[cacheKey] = {
      data: formattedData,
      expiry: now + CACHE_TTL_MS
    };

    res.json(formattedData);
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        status: error.status || 500,
        code: 'EXTERNAL_API_ERROR',
        message: error.body?.message || error.message || 'Failed to fetch repository data from GitHub.'
      }
    });
  }
});

// ---------------------------------------------------------
// 5. CHAOS MONKEY: ERROR TESTING ENDPOINT
// ---------------------------------------------------------
app.get('/api/chaos', (req, res) => {
  const status = parseInt(req.query.status) || 500;
  
  const errorMap = {
    400: { code: 'BAD_REQUEST', message: 'The server cannot process the request due to an apparent client error (e.g., malformed request syntax, size too large).' },
    401: { code: 'UNAUTHORIZED', message: 'Authentication is required and has failed or has not yet been provided.' },
    403: { code: 'FORBIDDEN', message: 'The server understood the request but refuses to authorize it (e.g., insufficient permissions).' },
    404: { code: 'NOT_FOUND', message: 'The requested resource could not be found but may be available in the future.' },
    429: { code: 'RATE_LIMIT_EXCEEDED', message: 'The user has sent too many requests in a given amount of time.' },
    500: { code: 'INTERNAL_SERVER_ERROR', message: 'A generic error message, given when an unexpected condition was encountered and no more specific message is suitable.' }
  };

  const errDetail = errorMap[status] || { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred.' };
  
  if (status === 429) {
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + 30000) / 1000));
    res.setHeader('Retry-After', 30);
  }

  res.status(status).json({
    error: {
      status,
      code: errDetail.code,
      message: `Chaos Monkey triggered: ${errDetail.message}`
    }
  });
});

// ---------------------------------------------------------
// 6. MOCK OAUTH 2.0 AUTHORIZATION SERVER
// ---------------------------------------------------------

// GET /oauth/authorize
// Renders the mock consent screen
app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state } = req.query;

  // Simple validation
  if (!client_id || !redirect_uri || response_type !== 'code') {
    return res.status(400).send('OAuth Parameter Error: Missing client_id, redirect_uri, or response_type must be "code".');
  }

  // Display a modern HTML consent page
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MockOAuth - Authorization Consent</title>
      <style>
        :root {
          --bg-dark: #0f172a;
          --panel-bg: rgba(30, 41, 59, 0.7);
          --text-primary: #f8fafc;
          --text-secondary: #94a3b8;
          --accent-primary: #6366f1;
          --accent-hover: #4f46e5;
          --accent-danger: #ef4444;
          --border: rgba(255, 255, 255, 0.08);
        }
        body {
          margin: 0;
          font-family: 'Outfit', -apple-system, sans-serif;
          background: radial-gradient(circle at top, #1e1b4b 0%, var(--bg-dark) 100%);
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
        }
        .card {
          background: var(--panel-bg);
          backdrop-filter: blur(16px);
          border: 1px solid var(--border);
          border-radius: 24px;
          padding: 40px;
          max-width: 440px;
          width: 90%;
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
          text-align: center;
        }
        .logo {
          font-size: 32px;
          font-weight: 800;
          background: linear-gradient(135deg, #818cf8, #e0e7ff);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 20px;
        }
        h2 { margin: 0 0 10px 0; font-size: 20px; font-weight: 600; }
        .subtitle { color: var(--text-secondary); font-size: 14px; margin-bottom: 24px; }
        .scope-box {
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          text-align: left;
          margin-bottom: 30px;
        }
        .scope-item {
          display: flex;
          align-items: center;
          margin: 8px 0;
          font-size: 14px;
        }
        .scope-item svg {
          margin-right: 8px;
          color: #34d399;
          flex-shrink: 0;
        }
        .btn-group {
          display: flex;
          gap: 12px;
        }
        button, a.btn {
          flex: 1;
          padding: 12px;
          border-radius: 12px;
          border: none;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-decoration: none;
          display: inline-block;
        }
        .btn-approve {
          background: var(--accent-primary);
          color: white;
        }
        .btn-approve:hover {
          background: var(--accent-hover);
        }
        .btn-deny {
          background: rgba(255,255,255,0.05);
          color: var(--text-secondary);
          border: 1px solid var(--border);
        }
        .btn-deny:hover {
          background: rgba(255,255,255,0.1);
          color: var(--text-primary);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">MockOAuth 2.0</div>
        <h2>Authorize App</h2>
        <div class="subtitle"><strong>Client App</strong> wants access to your Mock Profile.</div>
        
        <div class="scope-box">
          <div style="font-weight:600; font-size:12px; color:var(--text-secondary); text-transform:uppercase; margin-bottom:8px;">Requested Permissions:</div>
          <div class="scope-item">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>
            Read access to user profile data (email, name, picture)
          </div>
          <div class="scope-item">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>
            Scope: <strong>${scope || 'profile email'}</strong>
          </div>
        </div>

        <form action="/oauth/approve" method="POST">
          <input type="hidden" name="client_id" value="${client_id}">
          <input type="hidden" name="redirect_uri" value="${redirect_uri}">
          <input type="hidden" name="scope" value="${scope || 'profile'}">
          <input type="hidden" name="state" value="${state || ''}">
          <div class="btn-group">
            <button type="submit" name="action" value="deny" class="btn-deny">Deny</button>
            <button type="submit" name="action" value="approve" class="btn-approve">Authorize</button>
          </div>
        </form>
      </div>
    </body>
    </html>
  `);
});

// POST /oauth/approve
// Processes the approval and redirects back with auth code
app.post('/oauth/approve', (req, res) => {
  const { client_id, redirect_uri, scope, state, action } = req.body;

  if (action === 'deny') {
    // Redirect back with access_denied error
    const dest = `${redirect_uri}?error=access_denied&state=${state || ''}`;
    return res.redirect(dest);
  }

  // Generate an authorization code
  const code = 'code_mock_' + Math.random().toString(36).substring(2, 15);
  
  // Store the authorization code (expires in 5 minutes)
  authCodesStore[code] = {
    client_id,
    scope,
    redirect_uri,
    expiresAt: Date.now() + 300000 // 5 minutes
  };

  // Redirect back to the client application with the auth code
  const dest = `${redirect_uri}?code=${code}&state=${state || ''}`;
  res.redirect(dest);
});

// POST /oauth/token
// Exchange Auth Code (or Refresh Token) for Access Token
app.post('/oauth/token', (req, res) => {
  const { grant_type, client_id, client_secret, code, redirect_uri, refresh_token } = req.body;

  // Validate client credentials (simulated)
  if (client_secret !== 'super_secret_developer_key') {
    return res.status(401).json({ error: 'invalid_client', error_description: 'Client secret is invalid.' });
  }

  if (grant_type === 'authorization_code') {
    if (!code) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Authorization code is missing.' });
    }

    const savedCode = authCodesStore[code];
    if (!savedCode || Date.now() > savedCode.expiresAt) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Auth code is invalid or expired.' });
    }

    // Clean up used code (one-time use!)
    delete authCodesStore[code];

    // Generate tokens
    const accessToken = 'access_token_' + Math.random().toString(36).substring(2, 18);
    const newRefreshToken = 'refresh_token_' + Math.random().toString(36).substring(2, 18);

    // Store tokens (expires in 60 seconds for display purposes!)
    const expiresIn = 60; // 60 seconds
    activeTokensStore[accessToken] = {
      client_id,
      scope: savedCode.scope,
      expiresAt: Date.now() + (expiresIn * 1000),
      refresh_token: newRefreshToken
    };

    refreshTokensStore[newRefreshToken] = {
      client_id,
      scope: savedCode.scope,
      accessToken // link back to invalidate
    };

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: savedCode.scope
    });
  } 
  
  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Refresh token is missing.' });
    }

    const savedRefresh = refreshTokensStore[refresh_token];
    if (!savedRefresh) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' });
    }

    // Generate new Access Token
    const newAccessToken = 'access_token_' + Math.random().toString(36).substring(2, 18);
    const newRefreshToken = 'refresh_token_' + Math.random().toString(36).substring(2, 18);

    // Invalidate old access token and refresh token
    delete refreshTokensStore[refresh_token];
    if (savedRefresh.accessToken) {
      delete activeTokensStore[savedRefresh.accessToken];
    }

    // Store new tokens
    const expiresIn = 60; // 60 seconds
    activeTokensStore[newAccessToken] = {
      client_id,
      scope: savedRefresh.scope,
      expiresAt: Date.now() + (expiresIn * 1000),
      refresh_token: newRefreshToken
    };

    refreshTokensStore[newRefreshToken] = {
      client_id,
      scope: savedRefresh.scope,
      accessToken: newAccessToken
    };

    return res.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: savedRefresh.scope
    });
  }

  return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code and refresh_token are supported.' });
});

// Middleware to secure endpoints with Access Token (Bearer Token)
function requireOAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Access Token is missing or not provided as a Bearer token.'
      }
    });
  }

  const token = authHeader.split(' ')[1];
  const tokenDetails = activeTokensStore[token];

  if (!tokenDetails) {
    return res.status(401).json({
      error: {
        status: 401,
        code: 'INVALID_TOKEN',
        message: 'The provided Access Token is invalid or expired.'
      }
    });
  }

  if (Date.now() > tokenDetails.expiresAt) {
    // Invalidate token
    delete activeTokensStore[token];
    return res.status(401).json({
      error: {
        status: 401,
        code: 'EXPIRED_TOKEN',
        message: 'The Access Token has expired. Please use the refresh token to renew it.'
      }
    });
  }

  req.tokenDetails = tokenDetails;
  next();
}

// SECURE API ENDPOINT (Resource Server)
app.get('/api/secure-profile', requireOAuth, (req, res) => {
  res.json({
    user: 'Jane Doe',
    email: 'jane.doe@mockoauth.com',
    profile_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=256&h=256&q=80',
    tier: 'Premium Developer',
    role: 'Staff Architect',
    permissions: req.tokenDetails.scope.split(' '),
    meta: {
      client_id: req.tokenDetails.client_id,
      authenticated_via: 'OAuth 2.0 Auth Code Flow',
      server_time: new Date().toISOString()
    }
  });
});

// ---------------------------------------------------------
// 7. EXPLICIT ERROR WRAPPER & STARTUP
// ---------------------------------------------------------

// Handle 404 Route Not Found
app.use((req, res, next) => {
  res.status(404).json({
    error: {
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      message: `The endpoint ${req.method} ${req.path} does not exist.`
    }
  });
});

// Generic Global Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: {
      status: err.status || 500,
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected server error occurred.'
    }
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`   Secure API & OAuth Server started successfully!`);
    console.log(`   Local Address: http://localhost:${PORT}`);
    console.log(`===================================================`);
  });
}

module.exports = app;
