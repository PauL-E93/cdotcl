import { buildAppUrl } from './app_url.js';

const API_URL = "api/forgetpassword.php";

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
let timerSection;
let otpCountdown;
let countdownInterval = null;

// Helper: Show/Hide elements
function showElement(element) {
    if (element) element.classList.remove('d-none');
}

function hideElement(element) {
    if (element) element.classList.add('d-none');
}

// Helper: Format seconds to MM:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
}

// OTP Countdown Logic
function startCountdown(duration = 60) {
    let timeLeft = duration;
    if (!otpCountdown || !timerSection) return;

    clearInterval(countdownInterval);
    otpCountdown.textContent = formatTime(timeLeft);
    showElement(timerSection);
    
    // Disable resend button during countdown
    if (resendOtpButton) {
        resendOtpButton.classList.add('disabled');
        resendOtpButton.setAttribute('disabled', 'disabled');
    }

    countdownInterval = setInterval(() => {
        timeLeft -= 1;
        otpCountdown.textContent = formatTime(timeLeft);

        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            otpCountdown.textContent = '00:00';
            showMessage('OTP Expired', 'OTP has expired. Please request a new code.', 'warning');
            
            // Re-enable resend button
            if (resendOtpButton) {
                resendOtpButton.classList.remove('disabled');
                resendOtpButton.removeAttribute('disabled');
            }
            hideElement(verifyOtpButton);
        }
    }, 1000);
}

function resetOtpTimer() {
    clearInterval(countdownInterval);
    startCountdown(60);
}

// SweetAlert Wrapper
function showMessage(title, text, icon) {
    Swal.fire({ 
        title, 
        text, 
        icon, 
        confirmButtonColor: '#3085d6' 
    });
}

function validateEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * STEP 1: Send OTP via Email
 */
async function sendOtp() {
    const email = emailInput.value.trim();
    if (!validateEmail(email)) {
        showMessage('Invalid Email', 'Please enter a valid email address.', 'warning');
        return;
    }

    // UI Loading State
    sendOtpButton.disabled = true;
    const originalText = sendOtpButton.innerHTML;
    sendOtpButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';

    try {
        const response = await axios.post(API_URL, new URLSearchParams({
            operation: 'send_otp',
            json: JSON.stringify({ email })
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const result = response.data;
        
        if (result.status === 'success') {
            // Success: Show OTP Input section
            showMessage('OTP Sent', result.message, 'success');
            showElement(otpSection);
            showElement(verifyOtpButton);
            showElement(resendOtpButton);
            hideElement(resetPasswordButton);
            hideElement(passwordSection);
            
            resetOtpTimer();
            otpInput.focus(); // Auto-focus OTP input
        } else {
            showMessage('Error', result.message || 'Unable to send OTP.', 'error');
        }
    } catch (error) {
        const errorMessage = error?.response?.data?.message || 'Unable to contact server. Please check your internet connection.';
        showMessage('Error', errorMessage, 'error');
    } finally {
        // Restore Button UI
        sendOtpButton.disabled = false;
        sendOtpButton.innerHTML = originalText;
    }
}

async function handleResendOtp(event) {
    event.preventDefault();
    if (resendOtpButton?.hasAttribute('disabled')) return;
    await sendOtp();
}

/**
 * STEP 2: Verify the received OTP
 */
async function verifyOtp() {
    const email = emailInput.value.trim();
    const otp = otpInput.value.trim();

    if (!validateEmail(email) || otp.length === 0) {
        showMessage('Missing Data', 'Please enter both your email and the OTP.', 'warning');
        return;
    }

    try {
        const response = await axios.post(API_URL, new URLSearchParams({
            operation: 'verify_otp',
            json: JSON.stringify({ email, otp })
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const result = response.data;
        if (result.status === 'success') {
            showMessage('OTP Verified', result.message, 'success');
            
            // UI Transition to Password Reset
            showElement(passwordSection);
            showElement(resetPasswordButton);
            hideElement(verifyOtpButton);
            hideElement(resendOtpButton);
            hideElement(timerSection);
            
            clearInterval(countdownInterval);
            passwordInput.focus(); // Auto-focus the new password field
        } else {
            showMessage('Invalid OTP', result.message || 'Please check your code and try again.', 'error');
        }
    } catch (error) {
        showMessage('Error', 'An error occurred during verification.', 'error');
    }
}

/**
 * STEP 3: Final Password Reset
 */
async function resetPassword() {
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    const confirmPassword = confirmPasswordInput.value.trim();

    if (!validateEmail(email)) {
        showMessage('Invalid Email', 'Please enter a valid email address.', 'warning');
        return;
    }

    if (password.length < 6) {
        showMessage('Weak Password', 'Password should be at least 6 characters long.', 'warning');
        return;
    }

    if (password !== confirmPassword) {
        showMessage('Password Mismatch', 'The new password and confirmation do not match.', 'warning');
        return;
    }

    try {
        const response = await axios.post(API_URL, new URLSearchParams({
            operation: 'reset_password',
            json: JSON.stringify({ email, password, confirm_password: confirmPassword })
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const result = response.data;
        if (result.status === 'success') {
            showMessage('Password Updated', result.message, 'success');
            
            // Reset and Clear UI
            passwordInput.value = '';
            confirmPasswordInput.value = '';
            otpInput.value = '';
            emailInput.value = '';
            
            hideElement(otpSection);
            hideElement(passwordSection);
            hideElement(verifyOtpButton);
            hideElement(resetPasswordButton);
            hideElement(resendOtpButton);
            hideElement(timerSection);
            
            // Redirect to login after 2 seconds
            setTimeout(() => {
                window.location.href = buildAppUrl('login.html');
            }, 2000);
        } else {
            showMessage('Unable to Reset', result.message || 'There was a problem updating your password.', 'error');
        }
    } catch (error) {
        showMessage('Error', 'Failed to update password. Please try again.', 'error');
    }
}

function bindEvents() {
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
    timerSection = document.getElementById('timerSection');
    otpCountdown = document.getElementById('otpCountdown');

    sendOtpButton?.addEventListener('click', sendOtp);
    verifyOtpButton?.addEventListener('click', verifyOtp);
    resetPasswordButton?.addEventListener('click', resetPassword);
    resendOtpButton?.addEventListener('click', handleResendOtp);
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
} else {
    bindEvents();
}
