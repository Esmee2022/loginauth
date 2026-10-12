function flipCard() {
  const card = document.getElementById("authCard");
  card.classList.toggle("flipped");
}

function togglePassword(id, button) {
  const input = document.getElementById(id);
  const icon = button.querySelector("i");
  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toastNotification');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast-notification ${type} show`;
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

function showForgotNotice() {
  showToast('Please contact your System Administrator to reset your credentials or 2FA authenticator.', 'info');
}

// 2FA Modal Controls
function openTwoFactorModal() {
  document.getElementById('twoFactorModal').style.display = 'flex';
  document.getElementById('totpCode').focus();
}

function closeTwoFactorModal() {
  document.getElementById('twoFactorModal').style.display = 'none';
  document.getElementById('totpCode').value = '';
  document.getElementById('recoveryCode').value = '';
}

let isRecoveryMode = false;
function toggleRecoveryMode() {
  isRecoveryMode = !isRecoveryMode;
  const totpForm = document.getElementById('totpForm');
  const recoveryForm = document.getElementById('recoveryForm');
  const toggleLink = document.getElementById('toggleRecoveryLink');
  const subtitle = document.getElementById('twoFactorSubtitle');

  if (isRecoveryMode) {
    totpForm.style.display = 'none';
    recoveryForm.style.display = 'block';
    toggleLink.textContent = 'Have your authenticator app? Enter 6-digit code';
    subtitle.textContent = 'Enter one of your 8 single-use emergency backup recovery codes.';
    document.getElementById('recoveryCode').focus();
  } else {
    totpForm.style.display = 'block';
    recoveryForm.style.display = 'none';
    toggleLink.textContent = 'Lost authenticator? Use backup code';
    subtitle.textContent = 'Enter the 6-digit code from your authenticator app.';
    document.getElementById('totpCode').focus();
  }
}

// ======================== API INTEGRATIONS ========================

// 1. LOGIN
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Authenticating...';

    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });

      const data = await response.json();

      if (!response.ok) {
        showToast(data.message || 'Invalid username, email, or password.', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      if (data.requires2fa) {
        showToast('Password verified. Please enter your 2FA code.', 'info');
        btn.disabled = false;
        btn.textContent = originalText;
        openTwoFactorModal();
      } else {
        showToast('Login successful! Redirecting...', 'success');
        btn.textContent = '✓ SUCCESS';
        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 800);
      }
    } catch (err) {
      showToast('Network error. Check server connectivity.', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// 2. SIGN UP (REGISTER)
const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = document.getElementById('signupBtn');
    const originalText = btn.textContent;

    const fullName = document.getElementById('signupName').value.trim();
    const username = document.getElementById('signupUsername').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (password !== confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }

    if (password.length < 12) {
      showToast('Password must be at least 12 characters long.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating Account...';

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, username, email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        showToast(data.message || 'Registration failed.', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      showToast('Account created successfully! Please sign in.', 'success');
      btn.textContent = '✓ REGISTERED';
      signupForm.reset();

      setTimeout(() => {
        flipCard();
        btn.disabled = false;
        btn.textContent = originalText;
        document.getElementById('loginIdentifier').value = username;
      }, 1200);
    } catch (err) {
      showToast('Network error during registration.', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// 3. 2FA TOTP VERIFICATION
const totpForm = document.getElementById('totpForm');
if (totpForm) {
  totpForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = document.getElementById('verifyTotpBtn');
    const originalText = btn.textContent;
    const code = document.getElementById('totpCode').value.trim();

    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      const data = await response.json();

      if (!response.ok) {
        showToast(data.message || 'Invalid or expired 2FA code.', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      showToast('2FA Verified! Redirecting to dashboard...', 'success');
      btn.textContent = '✓ VERIFIED';
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 700);
    } catch (err) {
      showToast('Network error during 2FA verification.', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

// 4. 2FA RECOVERY CODE VERIFICATION
const recoveryForm = document.getElementById('recoveryForm');
if (recoveryForm) {
  recoveryForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = document.getElementById('verifyRecoveryBtn');
    const originalText = btn.textContent;
    const recoveryCode = document.getElementById('recoveryCode').value.trim();

    btn.disabled = true;
    btn.textContent = 'Checking recovery code...';

    try {
      const response = await fetch('/api/auth/2fa/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryCode })
      });

      const data = await response.json();

      if (!response.ok) {
        showToast(data.message || 'Invalid or used recovery code.', 'error');
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      showToast('Recovery code accepted! Redirecting...', 'success');
      btn.textContent = '✓ RECOVERED';
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 700);
    } catch (err) {
      showToast('Network error during recovery verification.', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}
