/**
 * Authentication Controller
 */

const auth = {
    init: () => {
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', auth.handleLogin);
        }
    },

    handleLogin: async (e) => {
        e.preventDefault();

        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const errorDiv = document.getElementById('login-error');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        // Prevent double submission (e.g. from autofill + click)
        if (submitBtn.disabled) return;

        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            auth.showError('Please enter both User ID/Username and password.');
            return;
        }

        // Check if dataService is ready
        if (!window.dataService) {
            auth.showError('Application is still loading. Please wait a moment and try again.');
            return;
        }

        // Loading state
        const originalBtnText = submitBtn.textContent;
        submitBtn.textContent = 'Signing in...';
        submitBtn.disabled = true;
        errorDiv.style.display = 'none';

        try {
            const user = await dataService.login(username, password);
            console.log('Login successful:', user);

            if (user.role === 'student') {
                window.location.href = 'pages/student-dashboard.html';
            } else if (user.role === 'teacher') {
                window.location.href = 'pages/teacher-dashboard.html';
            } else if (user.role === 'admin') {
                window.location.href = 'pages/admin-dashboard.html';
            } else {
                auth.showError('Unknown user role.');
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
            }
        } catch (err) {
            console.error('Login error:', err);

            // Handle AbortError specifically (often caused by password managers or network cancellation)
            if (err.name === 'AbortError' || (err.message && err.message.includes('AbortError'))) {
                auth.showError('Login interrupted. Please tap Login again.');
            } else {
                auth.showError(err.message || 'Login failed. Please check your credentials.');
            }

            submitBtn.textContent = originalBtnText;
            submitBtn.disabled = false;
        }
    },

    showError: async (msg) => {
        const errorDiv = document.getElementById('login-error');
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.style.display = 'block';
        } else {
            await Utils.showAlert('Notice', msg);
        }
    },

    logout: async () => {
        await dataService.logout();
        // Check if we are in a subdirectory (pages/) or root
        if (window.location.pathname.includes('/pages/')) {
            window.location.href = '../index.html';
        } else {
            window.location.href = 'index.html';
        }
    },

    togglePassword: (inputId, button) => {
        const passwordInput = document.getElementById(inputId);
        const eyeIcon = button.querySelector('.eye-icon');

        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            eyeIcon.textContent = '👁️‍🗨️';
            button.setAttribute('aria-label', 'Hide password');
        } else {
            passwordInput.type = 'password';
            eyeIcon.textContent = '👁️';
            button.setAttribute('aria-label', 'Show password');
        }
    }
};

// Forgot Password / Username Flow Helpers

// Tab Switching
window.switchForgotTab = (tab) => {
    const passwordTab = document.getElementById('forgot-tab-password');
    const usernameTab = document.getElementById('forgot-tab-username');
    const passwordContent = document.getElementById('forgot-password-content');
    const usernameContent = document.getElementById('forgot-username-content');

    if (tab === 'password') {
        passwordTab.classList.add('active');
        usernameTab.classList.remove('active');
        passwordContent.classList.add('active');
        usernameContent.classList.remove('active');
    } else {
        usernameTab.classList.add('active');
        passwordTab.classList.remove('active');
        usernameContent.classList.add('active');
        passwordContent.classList.remove('active');
    }
};

window.openForgotPasswordModal = () => {
    const modal = document.getElementById('forgot-password-modal');
    if (modal) {
        modal.classList.add('show');
        switchForgotTab('password');
    }
};

window.openForgotUsernameModal = () => {
    const modal = document.getElementById('forgot-password-modal');
    if (modal) {
        modal.classList.add('show');
        switchForgotTab('username');
    }
};

window.closeModal = (id) => {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('show');
    // Clear results/errors when closing
    const recoveryResult = document.getElementById('username-recovery-result');
    if (recoveryResult) {
        recoveryResult.style.display = 'none';
        recoveryResult.innerHTML = '';
    }
    const recoveryError = document.getElementById('username-recovery-error');
    if (recoveryError) recoveryError.style.display = 'none';
};

// Forgot Password Step 1: Request Reset Code
window.handleRequestReset = async () => {
    const usernameInput = document.getElementById('reset-username');
    const errorDiv = document.getElementById('reset-error-1');
    const btn = document.getElementById('request-reset-btn');
    const username = usernameInput.value.trim();

    if (!username) {
        errorDiv.textContent = 'Please enter your username.';
        errorDiv.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    errorDiv.style.display = 'none';

    try {
        await dataService.requestPasswordReset(username);
        // Move to step 2
        window.closeModal('forgot-password-modal');
        const verifyModal = document.getElementById('verify-reset-modal');
        if (verifyModal) verifyModal.classList.add('show');
        // Pre-fill username if needed
        localStorage.setItem('pending_reset_user', username);
    } catch (err) {
        errorDiv.textContent = err.message || 'Failed to request reset.';
        errorDiv.style.display = 'block';
    }
    btn.textContent = '🚀 Request Reset Code';
    btn.disabled = false;
};

// Forgot Password Step 2: Verify & Reset
window.handleVerifyReset = async () => {
    const codeInput = document.getElementById('reset-code');
    const passInput = document.getElementById('reset-new-password');
    const errorDiv = document.getElementById('reset-error-2');
    const btn = document.getElementById('verify-reset-btn');

    const code = codeInput.value.trim();
    const newPassword = passInput.value.trim();
    const username = localStorage.getItem('pending_reset_user');

    if (!code || code.length !== 6) {
        errorDiv.textContent = 'Please enter the 6-digit code.';
        errorDiv.style.display = 'block';
        return;
    }

    if (newPassword.length < 6) {
        errorDiv.textContent = 'Password must be at least 6 characters.';
        errorDiv.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Updating...';
    errorDiv.style.display = 'none';

    try {
        await dataService.verifyAndResetPassword(username, code, newPassword);
        await Utils.showAlert('Success', '✅ Password updated successfully! You can now log in.');
        window.closeModal('verify-reset-modal');
        localStorage.removeItem('pending_reset_user');
    } catch (err) {
        errorDiv.textContent = err.message || 'Failed to update password.';
        errorDiv.style.display = 'block';
        btn.textContent = '✅ Update Password';
        btn.disabled = false;
    }
};

// Forgot Username: Recover Username by full name + password
window.handleRecoverUsername = async () => {
    const fullNameInput = document.getElementById('recovery-fullname');
    const passwordInput = document.getElementById('recovery-password');
    const errorDiv = document.getElementById('username-recovery-error');
    const resultDiv = document.getElementById('username-recovery-result');
    const btn = document.getElementById('recover-username-btn');

    const fullName = fullNameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!fullName) {
        errorDiv.textContent = 'Please enter your full name.';
        errorDiv.style.display = 'block';
        return;
    }

    if (!password) {
        errorDiv.textContent = 'Please enter your password to verify your identity.';
        errorDiv.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Searching...';
    errorDiv.style.display = 'none';
    resultDiv.style.display = 'none';

    try {
        const result = await dataService.recoverUsername(fullName, password);

        if (result && result.username) {
            resultDiv.innerHTML = `
                <div class="username-result-box">
                    <div class="found-label">✅ Your username is:</div>
                    <div class="found-username">${result.username}</div>
                    <div class="found-hint">Use this username to log in with your password.</div>
                </div>
            `;
            resultDiv.style.display = 'block';
        } else {
            errorDiv.textContent = 'Could not find a matching account. Please check your full name.';
            errorDiv.style.display = 'block';
        }
    } catch (err) {
        errorDiv.textContent = err.message || 'Failed to recover username.';
        errorDiv.style.display = 'block';
    }
    btn.textContent = '🔍 Find My Username';
    btn.disabled = false;
};

// Auto-init if in browser
if (typeof window !== 'undefined') {

    window.auth = auth;
    // Wait for DOM
    document.addEventListener('DOMContentLoaded', auth.init);
}
