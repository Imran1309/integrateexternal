// OAuth 2.0 State Machine
const oauthState = {
  authCode: null,
  accessToken: null,
  refreshToken: null,
  expiresIn: 0,
  expiryTime: null,
  expiryInterval: null,
  scopes: 'profile email',
  
  // Client configurations (must match server.js validation)
  clientId: 'sec_dashboard_client_xyz',
  clientSecret: 'super_secret_developer_key',
  redirectUri: window.location.origin + '/oauth_callback.html'
};

// ---------------------------------------------------------
// DOM REFERENCES
// ---------------------------------------------------------
const btnOAuthAuth = document.getElementById('btn-oauth-auth');
const btnOAuthToken = document.getElementById('btn-oauth-token');
const btnOAuthQuery = document.getElementById('btn-oauth-query');
const btnOAuthRefresh = document.getElementById('btn-oauth-refresh');
const btnOAuthClear = document.getElementById('btn-oauth-clear');

const valAuthCode = document.getElementById('val-auth-code');
const valAccessToken = document.getElementById('val-access-token');
const valTokenExpiry = document.getElementById('val-token-expiry');
const valRefreshToken = document.getElementById('val-refresh-token');

const oauthTerminal = document.getElementById('oauth-terminal');

// Action Step boxes
const actionBox1 = document.getElementById('action-box-1');
const actionBox2 = document.getElementById('action-box-2');
const actionBox3 = document.getElementById('action-box-3');
const actionBox4 = document.getElementById('action-box-4');

// Visual Step indicators
const step1Ind = document.getElementById('step1-indicator');
const step2Ind = document.getElementById('step2-indicator');
const step3Ind = document.getElementById('step3-indicator');
const step4Ind = document.getElementById('step4-indicator');

// Profile widget in header
const userProfileWidget = document.getElementById('user-profile-widget');

// Profile data container
const profileContainer = document.getElementById('profile-container');
const profileAvatar = document.getElementById('profile-avatar');
const profileName = document.getElementById('profile-name');
const profileRole = document.getElementById('profile-role');
const profileEmail = document.getElementById('profile-email');
const profileScopes = document.getElementById('profile-scopes');
const profileAuthMethod = document.getElementById('profile-auth-method');
const profileTime = document.getElementById('profile-time');

// Consent modal elements
const consentModal = document.getElementById('oauth-consent-modal');
const modalBtnApprove = document.getElementById('modal-btn-approve');
const modalBtnDeny = document.getElementById('modal-btn-deny');

// ---------------------------------------------------------
// LOGGING UTILITIES
// ---------------------------------------------------------
function logTerminal(message, type = 'info') {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  
  const time = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="system">[${time}]</span> ${message}`;
  
  oauthTerminal.appendChild(line);
  oauthTerminal.scrollTop = oauthTerminal.scrollHeight;
}

// ---------------------------------------------------------
// STEP 1: AUTHORIZE CLIENT & CONSENT
// ---------------------------------------------------------
btnOAuthAuth.addEventListener('click', () => {
  logTerminal('Initiating Authorization Request flow...', 'info');
  logTerminal(`GET /oauth/authorize?client_id=${oauthState.clientId}&response_type=code&scope=${encodeURIComponent(oauthState.scopes)}&redirect_uri=${encodeURIComponent(oauthState.redirectUri)}`, 'info');
  
  // Show consent modal
  consentModal.classList.remove('hidden');
});

modalBtnDeny.addEventListener('click', () => {
  consentModal.classList.add('hidden');
  logTerminal('User denied application access authorization.', 'error');
  logTerminal('Redirected back with: error=access_denied', 'error');
  showToast('Auth Denied', 'User refused authorization access scope.', 'warning');
});

modalBtnApprove.addEventListener('click', async () => {
  consentModal.classList.add('hidden');
  logTerminal('User approved authorization access scope.', 'success');
  
  // Simulate POST authorization approval call to backend
  try {
    const params = new URLSearchParams();
    params.append('client_id', oauthState.clientId);
    params.append('redirect_uri', oauthState.redirectUri);
    params.append('scope', oauthState.scopes);
    params.append('state', 'random_state_9876');
    params.append('action', 'approve');

    const res = await fetch('/oauth/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (res.ok) {
      // Find returned url (redirect)
      const redirectUrl = res.url;
      logTerminal(`Redirected back to client callback URI: ${redirectUrl}`, 'info');
      
      const urlObj = new URL(redirectUrl);
      const code = urlObj.searchParams.get('code');
      
      if (code) {
        oauthState.authCode = code;
        valAuthCode.textContent = code;
        valAuthCode.style.color = 'var(--accent-success)';
        
        logTerminal(`Authorization Code acquired successfully: ${code}`, 'success');
        showToast('Auth Code Acquired', 'Authorization completed. Code ready for exchange.', 'success');
        
        // Update timeline visual styles
        step1Ind.classList.remove('active');
        step1Ind.classList.add('completed');
        step2Ind.classList.add('active');
        
        // Update Controller Buttons
        actionBox1.classList.remove('active-box');
        actionBox2.classList.remove('disabled');
        actionBox2.classList.add('active-box');
        btnOAuthToken.disabled = false;
        btnOAuthAuth.disabled = true;
      }
    }
  } catch (error) {
    logTerminal('Failed to negotiate authorization handshake.', 'error');
  }
});

// ---------------------------------------------------------
// STEP 2: EXCHANGE AUTH CODE
// ---------------------------------------------------------
btnOAuthToken.addEventListener('click', async () => {
  logTerminal('Querying token exchange endpoint...', 'info');
  logTerminal('POST /oauth/token', 'info');
  logTerminal(`Payload: { grant_type: "authorization_code", code: "${oauthState.authCode}", client_id: "${oauthState.clientId}", client_secret: "••••••••••••" }`, 'info');

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', oauthState.clientId);
    params.append('client_secret', oauthState.clientSecret);
    params.append('code', oauthState.authCode);
    params.append('redirect_uri', oauthState.redirectUri);

    const res = await fetch('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await res.json();

    if (res.ok) {
      oauthState.accessToken = data.access_token;
      oauthState.refreshToken = data.refresh_token;
      oauthState.expiresIn = data.expires_in;
      
      valAccessToken.textContent = data.access_token;
      valRefreshToken.textContent = data.refresh_token;
      
      logTerminal(`Exchange Successful. Token Type: ${data.token_type}`, 'success');
      logTerminal(`Access Token: ${data.access_token}`, 'success');
      logTerminal(`Refresh Token: ${data.refresh_token}`, 'success');
      showToast('Tokens Exchanged', 'Access & Refresh tokens loaded in vault.', 'success');

      // Timeline updates
      step2Ind.classList.remove('active');
      step2Ind.classList.add('completed');
      step3Ind.classList.add('active');

      // Button controllers updates
      actionBox2.classList.remove('active-box');
      actionBox2.classList.add('disabled');
      btnOAuthToken.disabled = true;
      
      actionBox3.classList.remove('disabled');
      actionBox3.classList.add('active-box');
      btnOAuthQuery.disabled = false;
      
      actionBox4.classList.remove('disabled');
      btnOAuthRefresh.disabled = false;

      // Start Countdown for Expiry
      startTokenTimer(data.expires_in);
    } else {
      logTerminal(`Token exchange rejected: ${data.error_description || data.error}`, 'error');
      showToast('Token Request Rejected', data.error_description || 'Invalid credentials.', 'danger');
    }
  } catch (error) {
    logTerminal('Network error during token negotiations.', 'error');
  }
});

// Timer counting down access token lifespan
function startTokenTimer(seconds) {
  clearInterval(oauthState.expiryInterval);
  oauthState.expiresIn = seconds;
  
  // Set visual bar
  const dashTokenStatus = document.getElementById('dash-token-status');
  const dashTokenDesc = document.getElementById('dash-token-desc');
  const tokenProgress = document.getElementById('token-progress');
  
  dashTokenStatus.textContent = 'Active';
  dashTokenStatus.style.color = 'var(--accent-success)';
  dashTokenDesc.textContent = `Expires in ${seconds}s`;

  valTokenExpiry.textContent = `${seconds}s`;
  valTokenExpiry.style.color = 'var(--accent-success)';

  const initialTime = seconds;

  oauthState.expiryInterval = setInterval(() => {
    oauthState.expiresIn--;
    
    // Update progress bars
    valTokenExpiry.textContent = `${oauthState.expiresIn}s`;
    dashTokenDesc.textContent = `Expires in ${oauthState.expiresIn}s`;
    
    const pct = (oauthState.expiresIn / initialTime) * 100;
    tokenProgress.style.width = `${pct}%`;

    if (oauthState.expiresIn <= 15) {
      valTokenExpiry.style.color = 'var(--accent-warning)';
      dashTokenStatus.style.color = 'var(--accent-warning)';
    }

    if (oauthState.expiresIn <= 0) {
      clearInterval(oauthState.expiryInterval);
      
      valTokenExpiry.textContent = 'EXPIRED';
      valTokenExpiry.style.color = 'var(--accent-danger)';
      
      dashTokenStatus.textContent = 'Expired';
      dashTokenStatus.style.color = 'var(--accent-danger)';
      dashTokenDesc.textContent = 'Access token has expired.';
      
      logTerminal('Access Token has expired. Secure API endpoints will reject queries.', 'warning');
      showToast('Token Expired', 'Access Token expired. Execute step 4 to refresh.', 'warning');
    }
  }, 1000);
}

// ---------------------------------------------------------
// STEP 3: QUERY SECURE API
// ---------------------------------------------------------
btnOAuthQuery.addEventListener('click', async () => {
  logTerminal('Querying secure profile resource endpoint...', 'info');
  logTerminal('GET /api/secure-profile', 'info');
  logTerminal(`Headers: { Authorization: "Bearer ${oauthState.accessToken}" }`, 'info');

  try {
    const res = await fetch('/api/secure-profile', {
      headers: { 'Authorization': `Bearer ${oauthState.accessToken}` }
    });

    const data = await res.json();

    if (res.ok) {
      logTerminal(`Query Successful! Server returned 200 OK.`, 'success');
      logTerminal(JSON.stringify(data), 'success');
      showToast('Resource Fetched', 'Protected resource loaded.', 'success');

      // Populate UI Profile Card
      profileAvatar.src = data.profile_url;
      profileName.textContent = data.user;
      profileRole.textContent = data.role;
      profileEmail.textContent = data.email;
      profileScopes.textContent = data.permissions.join(', ');
      profileAuthMethod.textContent = data.meta.authenticated_via;
      profileTime.textContent = new Date(data.meta.server_time).toLocaleTimeString();

      profileContainer.classList.remove('hidden');

      // Update Top Bar Profile Header
      userProfileWidget.innerHTML = `
        <div class="profile-info-anon" style="gap: 12px; display: flex; align-items: center;">
          <img class="avatar-image" src="${data.profile_url}" alt="${data.user}">
          <div class="text-group">
            <span class="profile-name">${data.user}</span>
            <span class="profile-role" style="color:var(--accent-success); font-weight:700;">${data.tier}</span>
          </div>
        </div>
      `;

      // Timeline updates
      step3Ind.classList.add('completed');
    } else {
      logTerminal(`Query Rejected: ${data.error.message} (${data.error.code})`, 'error');
      showToast('API Rejected Query', data.error.message, 'danger');
    }
  } catch (error) {
    logTerminal('Failed to reach target resource endpoint.', 'error');
  }
});

// ---------------------------------------------------------
// STEP 4: TOKEN REFRESH
// ---------------------------------------------------------
btnOAuthRefresh.addEventListener('click', async () => {
  logTerminal('Requesting access token renewal using refresh token...', 'info');
  logTerminal('POST /oauth/token', 'info');
  logTerminal(`Payload: { grant_type: "refresh_token", refresh_token: "${oauthState.refreshToken}", client_id: "${oauthState.clientId}" }`, 'info');

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', oauthState.clientId);
    params.append('client_secret', oauthState.clientSecret);
    params.append('refresh_token', oauthState.refreshToken);

    const res = await fetch('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await res.json();

    if (res.ok) {
      oauthState.accessToken = data.access_token;
      oauthState.refreshToken = data.refresh_token;
      oauthState.expiresIn = data.expires_in;

      valAccessToken.textContent = data.access_token;
      valRefreshToken.textContent = data.refresh_token;

      logTerminal('Renewal Successful. New Access & Refresh tokens generated.', 'success');
      logTerminal(`New Access Token: ${data.access_token}`, 'success');
      logTerminal(`New Refresh Token: ${data.refresh_token}`, 'success');
      showToast('Tokens Renewed', 'Access token refreshed successfully.', 'success');

      // Visual flash on Step 4
      step4Ind.classList.add('completed');
      setTimeout(() => step4Ind.classList.remove('completed'), 1000);

      // Restart Timer
      startTokenTimer(data.expires_in);
    } else {
      logTerminal(`Renewal request rejected: ${data.error_description || data.error}`, 'error');
      showToast('Refresh Rejected', data.error_description || 'Expired refresh token.', 'danger');
    }
  } catch (error) {
    logTerminal('Network error during token renewal.', 'error');
  }
});

// ---------------------------------------------------------
// RESET PLAYGROUND STATE
// ---------------------------------------------------------
btnOAuthClear.addEventListener('click', () => {
  clearInterval(oauthState.expiryInterval);
  
  // Clear State values
  oauthState.authCode = null;
  oauthState.accessToken = null;
  oauthState.refreshToken = null;
  oauthState.expiresIn = 0;
  
  // Clear vault labels
  valAuthCode.textContent = 'Not acquired';
  valAuthCode.style.color = '';
  valAccessToken.textContent = 'Not acquired';
  valRefreshToken.textContent = 'Not acquired';
  valTokenExpiry.textContent = 'N/A';
  valTokenExpiry.style.color = '';

  // Clear timeline indicators
  step1Ind.classList.remove('completed', 'active');
  step2Ind.classList.remove('completed', 'active');
  step3Ind.classList.remove('completed', 'active');
  step4Ind.classList.remove('completed', 'active');
  step1Ind.classList.add('active');

  // Clear boxes
  actionBox1.classList.add('active-box');
  btnOAuthAuth.disabled = false;

  actionBox2.classList.remove('active-box');
  actionBox2.classList.add('disabled');
  btnOAuthToken.disabled = true;

  actionBox3.classList.remove('active-box');
  actionBox3.classList.add('disabled');
  btnOAuthQuery.disabled = true;

  actionBox4.classList.add('disabled');
  btnOAuthRefresh.disabled = true;

  // Clear dashboard tokens indicators
  document.getElementById('dash-token-status').textContent = 'None';
  document.getElementById('dash-token-status').style.color = '';
  document.getElementById('dash-token-desc').textContent = 'Not authenticated';
  document.getElementById('token-progress').style.width = '0%';

  // Hide profiles
  profileContainer.classList.add('hidden');
  
  // Restore Header Guest User profile widget
  userProfileWidget.innerHTML = `
    <div class="profile-info-anon">
      <span class="avatar-placeholder">?</span>
      <div class="text-group">
        <span class="profile-name">Guest User</span>
        <span class="profile-role">Unauthorized</span>
      </div>
    </div>
  `;

  logTerminal('Playground credentials and authentication session cleared.', 'warning');
  showToast('Session Reset', 'All cached credentials have been forgotten.', 'info');
});
