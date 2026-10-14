import { buildAppUrl } from './app_url.js';

const API_URL = buildAppUrl('api/forgetpassword.php');
const DEFAULT_OTP_LIFETIME_SECONDS = 600;
const RESEND_COOLDOWN_SECONDS = 60;

let firstNameInput;
let accountTypeInput;
let lastNameInput;
let birthdayInput;
let emailInput;
let otpSection;
let passwordSection;
let otpInput;
let passwordInput;
let confirmPasswordInput;
let sendOtpButton;
let verifyOtpButton;
let resetPasswordButton;
let resendOtpButton;
let changeDetailsButton;
let timerSection;
let otpCountdown;
let countdownInterval = null;
let resetRequestId = null;
let otpExpiresAt = 0;
let resendAvailableAt = 0;
let requestInProgress = false;
let expirationMessageShown = false;

function showElement(element) {
    element?.classList.remove('d-none');
}

function hideElement(element) {
    element?.classList.add('d-none');
}

function formatTime(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
    const remainder = (safeSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
}

function localToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function showMessage(title, text, icon) {
    return Swal.fire({
        title,
        text,
        icon,
        confirmButtonColor: '#3085d6'
    });
}

function validateEmail(email) {
    return typeof email === 'string'
        && email.length <= 150
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getIdentity() {
    return {
        account_type: accountTypeInput?.value || '',
        first_name: firstNameInput.value.trim(),
        last_name: lastNameInput.value.trim(),
        birthday: birthdayInput.value,
        email: emailInput.value.trim().toLowerCase()
    };
}

function validateIdentity(identity) {
    if (!['student', 'employee'].includes(identity.account_type)) {
        showMessage('Account Type Required', 'Please choose Student or Employee.', 'warning');
        return false;
    }
    if (!identity.first_name || !identity.last_name) {
        showMessage('Missing Name', 'Please enter the account holder\'s first and last name.', 'warning');
        return false;
    }
    if (identity.first_name.length > 100 || identity.last_name.length > 100) {
        showMessage('Invalid Name', 'First and last names must each be 100 characters or fewer.', 'warning');
        return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(identity.birthday) || identity.birthday > localToday()) {
        showMessage('Invalid Birthday', 'Please enter a valid birthday that is not in the future.', 'warning');
        return false;
    }
    if (!validateEmail(identity.email)) {
        showMessage('Invalid Email', 'Please enter the registered email address for this account.', 'warning');
        return false;
    }

    return true;
}

function setIdentityLocked(locked) {
    [accountTypeInput, firstNameInput, lastNameInput, birthdayInput, emailInput].forEach((input) => {
        if (input) input.disabled = locked;
    });
}

function setButtonLoading(button, loading, loadingText) {
    if (!button) return;
    if (loading) {
        button.dataset.originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${loadingText}`;
        return;
    }

    button.innerHTML = button.dataset.originalText || button.innerHTML;
    button.disabled = false;
}

function updateCountdown() {
    if (!otpCountdown || !timerSection || otpExpiresAt <= 0) return;

    const now = Date.now();
    const secondsLeft = Math.max(0, Math.ceil((otpExpiresAt - now) / 1000));
    const resendSecondsLeft = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));
    otpCountdown.textContent = formatTime(secondsLeft);

    if (resendOtpButton) {
        resendOtpButton.disabled = requestInProgress || resendSecondsLeft > 0;
        resendOtpButton.textContent = resendSecondsLeft > 0
            ? `RESEND OTP (${resendSecondsLeft}s)`
            : 'RESEND OTP';
    }

    if (secondsLeft > 0) return;

    clearInterval(countdownInterval);
    countdownInterval = null;
    resetRequestId = null;
    hideElement(verifyOtpButton);
    if (resendOtpButton) {
        resendOtpButton.disabled = requestInProgress;
        resendOtpButton.textContent = 'RESEND OTP';
    }

    if (!expirationMessageShown) {
        expirationMessageShown = true;
        showMessage('OTP Expired', 'The OTP has expired. Request a new code to continue.', 'warning');
    }
}

function startCountdown(durationSeconds = DEFAULT_OTP_LIFETIME_SECONDS) {
    clearInterval(countdownInterval);
    expirationMessageShown = false;
    otpExpiresAt = Date.now() + (durationSeconds * 1000);
    resendAvailableAt = Date.now() + (RESEND_COOLDOWN_SECONDS * 1000);
    showElement(timerSection);
    updateCountdown();
    countdownInterval = window.setInterval(updateCountdown, 1000);
}

function resetFlow({ clearIdentity = false } = {}) {
    clearInterval(countdownInterval);
    countdownInterval = null;
    resetRequestId = null;
    otpExpiresAt = 0;
    resendAvailableAt = 0;
    expirationMessageShown = false;

    if (otpInput) otpInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    if (clearIdentity) {
        [firstNameInput, lastNameInput, birthdayInput, emailInput].forEach((input) => {
            if (input) input.value = '';
        });
    }

    setIdentityLocked(false);
    showElement(sendOtpButton);
    hideElement(otpSection);
    hideElement(passwordSection);
    hideElement(verifyOtpButton);
    hideElement(resetPasswordButton);
    hideElement(resendOtpButton);
    hideElement(changeDetailsButton);
    hideElement(timerSection);
}

function responseMessage(error, fallback) {
    return error?.response?.data?.message || fallback;
}

async function sendOtp(event) {
    event?.preventDefault?.();
    if (requestInProgress) return;

    const identity = getIdentity();
    if (!validateIdentity(identity)) return;

    requestInProgress = true;
    const activeButton = event?.currentTarget || (resetRequestId ? resendOtpButton : sendOtpButton);
    setButtonLoading(activeButton, true, 'Sending...');

    try {
        const response = await axios.post(API_URL, new URLSearchParams({
            operation: 'send_otp',
            json: JSON.stringify(identity)
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const result = response.data;

        if (result.status !== 'success' || !result.request_id) {
            showMessage('Unable to Send OTP', result.message || 'Unable to send OTP.', 'error');
            return;
        }

        resetRequestId = result.request_id;
        otpInput.value = '';
        setIdentityLocked(true);
        hideElement(sendOtpButton);
        hideElement(passwordSection);
        hideElement(resetPasswordButton);
        showElement(otpSection);
        showElement(verifyOtpButton);
        showElement(resendOtpButton);
        showElement(changeDetailsButton);
        startCountdown(Number(result.expires_in_seconds) || DEFAULT_OTP_LIFETIME_SECONDS);
        await showMessage('Check Your Email', result.message, 'success');
        otpInput.focus();
    } catch (error) {
        showMessage(
            'Unable to Send OTP',
            responseMessage(error, 'Unable to contact the server. Please try again.'),
            'error'
        );
    } finally {
        requestInProgress = false;
        setButtonLoading(activeButton, false, 'Sending...');
        updateCountdown();
    }
}

async function verifyOtp() {
    if (requestInProgress) return;
    const otp = otpInput.value.trim();

    if (!resetRequestId) {
        showMessage('Request a New OTP', 'This OTP request has expired or is no longer available.', 'warning');
        return;
    }
    if (!/^\d{6}$/.test(otp)) {
        showMessage('Invalid OTP', 'Enter the 6-digit OTP sent to the registered email.', 'warning');
        return;
    }

    requestInProgress = true;
    setButtonLoading(verifyOtpButton, true, 'Verifying...');
    try {
        const response = await axios.post(API_URL, new URLSearchParams({
            operation: 'verify_otp',
            json: JSON.stringify({ request_id: resetRequestId, otp })
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const result = response.data;

        if (result.status !== 'success') {
            showMessage('Unable to Verify OTP', result.message || 'Please check the OTP and try again.', 'error');
            return;
        }

        clearInterval(countdownInterval);
        countdownInterval = null;
        hideElement(otpSection);
        hideElement(verifyOtpButton);
        hideElement(resendOtpButton);
        hideElement(timerSection);
        hideElement(changeDetailsButton);
        showElement(passwordSection);
        showElement(resetPasswordButton);
        await showMessage('OTP Verified', result.message, 'success');
        passwordInput.focus();
    } catch (error) {
        showMessage(
            'Unable to Verify OTP',
            responseMessage(error, 'An error occurred during verification.'),
            'error'
        );
    } finally {
        requestInProgress = false;
        setButtonLoading(verifyOtpButton, false, 'Verifying...');
    }
}

async function resetPassword() {
    if (requestInProgress) return;
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!resetRequestId) {
        showMessage('Verification Required', 'Please request and verify a new OTP.', 'warning');
        return;
    }
    if (password.length < 12 || !/[A-Za-z]/.test(password) || !/[A-Z]/.test(password)
        || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        showMessage('Weak Password', 'Use at least 12 characters with an uppercase letter, number, and symbol.', 'warning');
        return;
    }
    if (password !== confirmPassword) {
        showMessage('Password Mismatch', 'The new password and confirmation do not match.', 'warning');
        return;
    }

    requestInProgress = true;
    setButtonLoading(resetPasswordButton, true, 'Updating...');
    try {
        const response = await axios.post(API_URL, new URLSearchParams({
            operation: 'reset_password',
            json: JSON.stringify({
                request_id: resetRequestId,
                password,
                confirm_password: confirmPassword
            })
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const result = response.data;

        if (result.status !== 'success') {
            showMessage('Unable to Reset', result.message || 'The password could not be updated.', 'error');
            return;
        }

        resetFlow({ clearIdentity: true });
        await showMessage('Password Updated', result.message, 'success');
        window.location.replace(buildAppUrl('login.html'));
    } catch (error) {
        showMessage(
            'Unable to Reset',
            responseMessage(error, 'Failed to update the password. Please try again.'),
            'error'
        );
    } finally {
        requestInProgress = false;
        setButtonLoading(resetPasswordButton, false, 'Updating...');
    }
}

function bindEvents() {
    accountTypeInput = document.getElementById('resetAccountType');
    firstNameInput = document.getElementById('resetFirstName');
    lastNameInput = document.getElementById('resetLastName');
    birthdayInput = document.getElementById('resetBirthday');
    emailInput = document.getElementById('resetEmail');
    otpSection = document.getElementById('otpSection');
    passwordSection = document.getElementById('passwordSection');
    otpInput = document.getElementById('resetOtp');
    passwordInput = document.getElementById('resetPassword');
    confirmPasswordInput = document.getElementById('resetConfirmPassword');
    sendOtpButton = document.getElementById('sendOtpButton');
    verifyOtpButton = document.getElementById('verifyOtpButton');
    resetPasswordButton = document.getElementById('resetPasswordButton');
    resendOtpButton = document.getElementById('resendOtpButton');
    changeDetailsButton = document.getElementById('changeDetailsButton');
    timerSection = document.getElementById('timerSection');
    otpCountdown = document.getElementById('otpCountdown');

    if (birthdayInput) birthdayInput.max = localToday();
    sendOtpButton?.addEventListener('click', sendOtp);
    verifyOtpButton?.addEventListener('click', verifyOtp);
    resetPasswordButton?.addEventListener('click', resetPassword);
    resendOtpButton?.addEventListener('click', sendOtp);
    changeDetailsButton?.addEventListener('click', () => {
        resetFlow();
        firstNameInput?.focus();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
} else {
    bindEvents();
}
