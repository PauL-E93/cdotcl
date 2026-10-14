import { buildAppUrl } from "../utilities/app_url.js";

let mathCaptchaFirstNumber = null;
let mathCaptchaSecondNumber = null;
let mathCaptchaChallengeId = null;
let captchaRequestSequence = 0;
let captchaExpiresAt = 0;
let captchaExpiryTimer = null;
let loginRequestInProgress = false;
let idleLogoutTimer = null;
let idleWarningTimer = null;
let idleLogoutListenersAttached = false;
let pageshowListenerAttached = false;
let idleWarningVisible = false;
let sessionSyncInProgress = false;
let sessionExpirationInProgress = false;
let logoutInProgress = false;
let lastActivityHandledAt = 0;
let lastServerActivitySyncAt = 0;
const IDLE_LOGOUT_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_WARNING_TIMEOUT_MS = 30 * 1000;
const SESSION_ACTIVITY_SYNC_INTERVAL_MS = 60 * 1000;
const ACTIVITY_EVENT_THROTTLE_MS = 5 * 1000;
const AUTH_ACTIVITY_STORAGE_KEY = "auth_last_activity_at";
const REMEMBER_SESSION_STORAGE_KEY = "auth_remember_me";

const ROLE_FOLDER_MAP = {
    "owner": "owner",
    "auditor": "auditor",
    "branch admin": "branch_admin",
    "secretary": "secretary",
    "student": "student",
    "teacher": "teacher"
};

const ROLE_DASHBOARD_PATHS = {
    "owner": "html/owner/dashboard.html",
    "auditor": "html/auditor/dashboard.html",
    "branch admin": "html/branch_admin/dashboard.html",
    "secretary": "html/secretary/dashboard.html",
    "student": "html/student/dashboard.html",
    "teacher": "html/teacher/dashboard.html"
};

const PUBLIC_AUTH_PAGES = new Set(["login.html", "signup.html", "forgetpassword.html"]);

function normalizeRole(role) {
    return String(role || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function getAuthApiUrl() {
    return buildAppUrl("api/login.php");
}

function getCurrentPageName() {
    return window.location.pathname.split("/").pop().toLowerCase();
}

function persistAuthSession(data) {
    localStorage.setItem(REMEMBER_SESSION_STORAGE_KEY, data?.remember_me === true ? "1" : "0");
    if (data?.user) {
        localStorage.setItem("user", JSON.stringify(data.user));
    }

    if (data?.session_token) {
        localStorage.setItem("session_token", data.session_token);
    }

    lastServerActivitySyncAt = Date.now();
    recordClientActivity();
    resetIdleLogoutTimer();
}

function clearIdleLogoutTimer() {
    if (idleLogoutTimer) {
        clearTimeout(idleLogoutTimer);
        idleLogoutTimer = null;
    }
}

function clearIdleWarningTimer() {
    if (idleWarningTimer) {
        clearTimeout(idleWarningTimer);
        idleWarningTimer = null;
    }
}

function getLastClientActivityAt() {
    const storedValue = Number(localStorage.getItem(AUTH_ACTIVITY_STORAGE_KEY));
    return Number.isFinite(storedValue) && storedValue > 0 ? storedValue : Date.now();
}

function recordClientActivity(timestamp = Date.now()) {
    localStorage.setItem(AUTH_ACTIVITY_STORAGE_KEY, String(timestamp));
    lastActivityHandledAt = timestamp;
}

function clearLocalAuthSession() {
    clearIdleLogoutTimer();
    clearIdleWarningTimer();
    localStorage.removeItem("user");
    localStorage.removeItem("session_token");
    localStorage.removeItem(AUTH_ACTIVITY_STORAGE_KEY);
    localStorage.removeItem(REMEMBER_SESSION_STORAGE_KEY);
}

function redirectExpiredSessionToLogin() {
    if (sessionExpirationInProgress || isPublicAuthPage()) {
        return;
    }

    sessionExpirationInProgress = true;
    clearLocalAuthSession();

    if (typeof Swal === "undefined") {
        redirectToLogin();
        return;
    }

    Swal.fire({
        icon: "info",
        title: "Session Expired",
        text: "Your session has ended. Please log in again.",
        confirmButtonText: "Go to Login",
        allowOutsideClick: false,
        allowEscapeKey: false
    }).then(redirectToLogin);
}

async function syncActiveSession(force = false) {
    if (sessionSyncInProgress || logoutInProgress || !localStorage.getItem("user")) {
        return false;
    }

    const now = Date.now();
    if (!force && (now - lastServerActivitySyncAt) < SESSION_ACTIVITY_SYNC_INTERVAL_MS) {
        return true;
    }

    sessionSyncInProgress = true;
    try {
        const response = await fetch(getAuthApiUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({ operation: "session" })
        });
        const data = await response.json();

        if (response.ok && data.status === "success") {
            localStorage.setItem(REMEMBER_SESSION_STORAGE_KEY, data.remember_me === true ? "1" : "0");
            if (data.user) {
                localStorage.setItem("user", JSON.stringify(data.user));
            }
            if (data.session_token) {
                localStorage.setItem("session_token", data.session_token);
            }
            lastServerActivitySyncAt = Date.now();
            return true;
        }

        if (response.ok && data.message === "Not authenticated") {
            redirectExpiredSessionToLogin();
            return false;
        }

        throw new Error(data.message || "Unable to refresh the session");
    } catch (error) {
        // A temporary network failure should not erase a potentially valid
        // session. The next activity or page request will verify it again.
        console.warn("Session activity sync failed:", error);
        return false;
    } finally {
        sessionSyncInProgress = false;
    }
}

async function showIdleWarningModal() {
    if (idleWarningVisible || logoutInProgress || !localStorage.getItem("user")) {
        return;
    }

    const inactiveFor = Date.now() - getLastClientActivityAt();
    if (inactiveFor < (IDLE_LOGOUT_TIMEOUT_MS - IDLE_WARNING_TIMEOUT_MS)) {
        resetIdleLogoutTimer();
        return;
    }

    idleWarningVisible = true;
    Swal.fire({
        title: "You are about to be logged out",
        text: "You have been inactive. Choose Stay Logged In within 30 seconds to continue.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Stay Logged In",
        cancelButtonText: "Log Me Out",
        allowOutsideClick: false,
        allowEscapeKey: false,
        reverseButtons: true,
        timer: IDLE_WARNING_TIMEOUT_MS,
        timerProgressBar: true
    }).then(async (result) => {
        // Activity in a different tab may have closed this warning already.
        if (!idleWarningVisible) {
            return;
        }

        idleWarningVisible = false;
        if (result.isConfirmed) {
            recordClientActivity();
            resetIdleLogoutTimer();
            await syncActiveSession(true);
            return;
        }

        await logout();
    });
}

function resetIdleLogoutTimer() {
    clearIdleLogoutTimer();
    clearIdleWarningTimer();

    if (!localStorage.getItem("user") || localStorage.getItem(REMEMBER_SESSION_STORAGE_KEY) === "1") {
        return;
    }

    const lastActivityAt = getLastClientActivityAt();
    const now = Date.now();
    const warningDelay = Math.max(
        0,
        lastActivityAt + IDLE_LOGOUT_TIMEOUT_MS - IDLE_WARNING_TIMEOUT_MS - now
    );
    const logoutDelay = Math.max(0, lastActivityAt + IDLE_LOGOUT_TIMEOUT_MS - now);

    idleWarningTimer = window.setTimeout(() => {
        idleWarningTimer = null;
        const latestActivityAt = getLastClientActivityAt();
        if (latestActivityAt > lastActivityAt) {
            resetIdleLogoutTimer();
            return;
        }
        showIdleWarningModal();
    }, warningDelay);

    idleLogoutTimer = window.setTimeout(() => {
        idleLogoutTimer = null;
        const latestActivityAt = getLastClientActivityAt();
        if ((Date.now() - latestActivityAt) < IDLE_LOGOUT_TIMEOUT_MS) {
            resetIdleLogoutTimer();
            return;
        }
        logout().catch(() => {
            window.location.href = buildAppUrl("login.html");
        });
    }, logoutDelay);
}

function handleUserActivity() {
    if (idleWarningVisible || logoutInProgress || !localStorage.getItem("user")) {
        return;
    }

    const now = Date.now();
    if ((now - lastActivityHandledAt) < ACTIVITY_EVENT_THROTTLE_MS) {
        return;
    }

    recordClientActivity(now);
    resetIdleLogoutTimer();
    syncActiveSession();
}

function handleSharedActivity(event) {
    if (event.key === "user" && event.newValue === null && !logoutInProgress) {
        redirectExpiredSessionToLogin();
        return;
    }

    if (event.key !== AUTH_ACTIVITY_STORAGE_KEY || !event.newValue) {
        return;
    }

    lastActivityHandledAt = Number(event.newValue) || Date.now();
    if (idleWarningVisible) {
        idleWarningVisible = false;
        Swal.close();
    }
    resetIdleLogoutTimer();
}

function attachIdleLogoutListeners() {
    if (idleLogoutListenersAttached) {
        return;
    }

    idleLogoutListenersAttached = true;

    const activityEvents = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => {
        document.addEventListener(eventName, handleUserActivity, { passive: true });
    });
    window.addEventListener("storage", handleSharedActivity);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            handleUserActivity();
            syncActiveSession(true);
        }
    });
}

function isPublicAuthPage() {
    return PUBLIC_AUTH_PAGES.has(getCurrentPageName());
}

function isProtectedAppPage() {
    return /\/html\/[^/]+\/[^/]+\.html$/i.test(window.location.pathname);
}

function getCurrentRoleFolder() {
    const match = window.location.pathname.match(/\/html\/([^/]+)\//i);
    return match ? match[1].toLowerCase() : "";
}

function redirectToLogin() {
    window.location.replace(buildAppUrl("login.html"));
}

function attachPageShowAuthGuard() {
    if (pageshowListenerAttached) {
        return;
    }

    pageshowListenerAttached = true;
    window.addEventListener("pageshow", async () => {
        await initializeAuthGuard();
    });
}

export function getDashboardPathForRole(role) {
    const normalizedRole = normalizeRole(role);
    return buildAppUrl(ROLE_DASHBOARD_PATHS[normalizedRole] || ROLE_DASHBOARD_PATHS["branch admin"]);
}

async function fetchActiveSession() {
    const response = await fetch(getAuthApiUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            operation: "session"
        })
    });
    const data = await response.json();

    if (data.status !== "success") {
        throw new Error(data.message || "Not authenticated");
    }

    persistAuthSession(data);
    return data.user;
}

function enforceRoleFolder(user) {
    const currentFolder = getCurrentRoleFolder();
    const normalizedRole = normalizeRole(user.role_name);
    const expectedFolder = ROLE_FOLDER_MAP[normalizedRole];
    const isSharedAuthenticatedPage = currentFolder === 'shared'
        && ['notifications.html', 'agreements.html'].includes(getCurrentPageName());

    if (!expectedFolder || !currentFolder || currentFolder === expectedFolder || isSharedAuthenticatedPage) {
        return true;
    }

    window.location.replace(getDashboardPathForRole(user.role_name));
    return false;
}

export async function initializeAuthGuard() {
    const protectedPage = isProtectedAppPage();
    const publicAuthPage = isPublicAuthPage();

    attachIdleLogoutListeners();
    attachPageShowAuthGuard();

    if (!protectedPage && !publicAuthPage) {
        return true;
    }

    try {
        const user = await fetchActiveSession();

        if (publicAuthPage) {
            window.location.replace(getDashboardPathForRole(user.role_name));
            return false;
        }

        return enforceRoleFolder(user);
    } catch (error) {
        clearLocalAuthSession();

        if (protectedPage) {
            redirectToLogin();
            return false;
        }

        return true;
    }
}

function validateMathCaptcha() {
    const answerInput = document.getElementById("captcha-answer");

    if (!answerInput) return false;

    const answer = answerInput.value.trim();
    const hasAnswer = answer !== "";
    const hasActiveChallenge = mathCaptchaChallengeId !== null
        && captchaExpiresAt > Date.now();
    const isCorrect = hasAnswer
        && hasActiveChallenge
        && mathCaptchaFirstNumber !== null
        && mathCaptchaSecondNumber !== null
        && Number(answer) === mathCaptchaFirstNumber + mathCaptchaSecondNumber;

    answerInput.classList.toggle("captcha-answer-correct", isCorrect);
    answerInput.classList.toggle("captcha-answer-incorrect", hasAnswer && !isCorrect);
    answerInput.setAttribute("aria-invalid", String(hasAnswer && !isCorrect));

    return isCorrect;
}

function generateMathCaptcha() {
    const firstNumberElement = document.getElementById("captcha-first-number");
    const secondNumberElement = document.getElementById("captcha-second-number");
    const answerInput = document.getElementById("captcha-answer");

    if (!firstNumberElement || !secondNumberElement || !answerInput) return;

    const requestSequence = ++captchaRequestSequence;
    const refreshCaptchaButton = document.getElementById("refresh-captcha");

    mathCaptchaFirstNumber = null;
    mathCaptchaSecondNumber = null;
    mathCaptchaChallengeId = null;
    captchaExpiresAt = 0;
    if (captchaExpiryTimer) {
        clearTimeout(captchaExpiryTimer);
        captchaExpiryTimer = null;
    }
    firstNumberElement.textContent = "--";
    secondNumberElement.textContent = "--";
    answerInput.value = "";
    answerInput.disabled = true;
    refreshCaptchaButton?.setAttribute("disabled", "");
    const captchaStatus = document.getElementById("captcha-status");
    if (captchaStatus) {
        captchaStatus.hidden = true;
        captchaStatus.textContent = "";
    }
    validateMathCaptcha();

    fetch(getAuthApiUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            operation: "captcha"
        })
    })
    .then(response => response.json())
    .then(data => {
        if (requestSequence !== captchaRequestSequence) return;

        if (data.status !== "success") {
            throw new Error(data.message || data.error || "Unable to load CAPTCHA");
        }

        mathCaptchaChallengeId = String(data.captcha.challenge_id || "");
        mathCaptchaFirstNumber = Number(data.captcha.first_number);
        mathCaptchaSecondNumber = Number(data.captcha.second_number);
        const expiresInSeconds = Number(data.captcha.expires_in_seconds);

        if (!mathCaptchaChallengeId || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
            throw new Error("The CAPTCHA response is incomplete");
        }

        // Refresh slightly before the server deadline so a green answer can
        // never be submitted after its server-side challenge has expired.
        const clientLifetimeMs = Math.max(1000, (expiresInSeconds * 1000) - 3000);
        captchaExpiresAt = Date.now() + clientLifetimeMs;
        captchaExpiryTimer = window.setTimeout(() => {
            if (requestSequence === captchaRequestSequence) {
                generateMathCaptcha();
            }
        }, clientLifetimeMs);

        firstNumberElement.textContent = data.captcha.first_number;
        secondNumberElement.textContent = data.captcha.second_number;
        answerInput.value = "";
        validateMathCaptcha();
    })
    .catch(() => {
        if (requestSequence !== captchaRequestSequence) return;

        mathCaptchaChallengeId = null;
        mathCaptchaFirstNumber = null;
        mathCaptchaSecondNumber = null;
        captchaExpiresAt = 0;
        firstNumberElement.textContent = "?";
        secondNumberElement.textContent = "?";
        answerInput.value = "";
        if (captchaStatus) {
            captchaStatus.textContent = "Unable to load CAPTCHA. Please try the refresh button again.";
            captchaStatus.hidden = false;
        }
    })
    .finally(() => {
        if (requestSequence !== captchaRequestSequence) return;

        answerInput.disabled = !mathCaptchaChallengeId;
        refreshCaptchaButton?.removeAttribute("disabled");
    });
}

export function initLoginPage() {
    document.querySelector('.login-form')?.addEventListener('submit', event => {
        event.preventDefault();
        handleLogin();
    });
    const passwordInput = document.getElementById("password");
    const togglePasswordButton = document.getElementById("toggle-password");
    const refreshCaptchaButton = document.getElementById("refresh-captcha");
    const captchaAnswerInput = document.getElementById("captcha-answer");

    if (!captchaAnswerInput) return;

    generateMathCaptcha();

    refreshCaptchaButton?.addEventListener("click", () => {
        generateMathCaptcha();
        captchaAnswerInput.focus();
    });

    captchaAnswerInput.addEventListener("input", validateMathCaptcha);

    togglePasswordButton?.addEventListener("click", () => {
        const isPasswordVisible = passwordInput.type === "text";
        const icon = togglePasswordButton.querySelector("i");

        passwordInput.type = isPasswordVisible ? "password" : "text";
        togglePasswordButton.setAttribute("aria-label", isPasswordVisible ? "Show password" : "Hide password");
        togglePasswordButton.setAttribute("aria-pressed", String(!isPasswordVisible));
        icon.classList.toggle("fa-eye", isPasswordVisible);
        icon.classList.toggle("fa-eye-slash", !isPasswordVisible);
    });

    captchaAnswerInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") handleLogin();
    });
}

export function performLogin(username, password, captchaAnswer, captchaChallengeId, rememberMe = false) {
    return fetch(getAuthApiUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            operation: "login",
            json: JSON.stringify({
                username,
                password,
                captcha_answer: captchaAnswer,
                captcha_challenge_id: captchaChallengeId,
                remember_me: rememberMe
            })
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === "success" || data.status === "already_authenticated") {
            persistAuthSession(data);
            return data;
        } else if (data.status === "password_expired" || data.status === "password_change_required") {
            return data;
        } else {
            throw new Error(data.message);
        }
    });
}

async function promptForExpiredPassword(loginData) {
    const isTemporaryPassword = loginData.code === "TEMPORARY_PASSWORD";
    const result = await Swal.fire({
        title: isTemporaryPassword ? "Replace Temporary Password" : "Password Change Required",
        width: "min(92vw, 560px)",
        customClass: {
            popup: "password-change-popup",
            title: "password-change-title",
            confirmButton: "password-change-confirm",
            cancelButton: "password-change-cancel",
            actions: "password-change-actions"
        },
        html: `
            <div class="password-change-intro">
                <span class="password-change-intro__icon" aria-hidden="true">🔐</span>
                <div>
                    <span class="password-change-eyebrow">Secure your account</span>
                    <p class="expired-password-message">${loginData.message}</p>
                </div>
            </div>
            <label class="expired-password-label" for="expired-password-new">New password</label>
            <div class="expired-password-field">
                <input id="expired-password-new" class="swal2-input expired-password-input" type="password" autocomplete="new-password" placeholder="New password">
                <button type="button" class="expired-password-toggle" data-password-target="expired-password-new" aria-label="Show new password" aria-pressed="false">
                    <i class="fa-solid fa-eye" aria-hidden="true"></i>
                </button>
            </div>
            <label class="expired-password-label" for="expired-password-confirm">Confirm new password</label>
            <div class="expired-password-field">
                <input id="expired-password-confirm" class="swal2-input expired-password-input" type="password" autocomplete="new-password" placeholder="Confirm new password">
                <button type="button" class="expired-password-toggle" data-password-target="expired-password-confirm" aria-label="Show confirmed password" aria-pressed="false">
                    <i class="fa-solid fa-eye" aria-hidden="true"></i>
                </button>
            </div>
            <div class="password-strength-card" aria-live="polite">
                <div class="password-strength-heading">
                    <span>Password strength</span>
                    <strong id="expired-password-strength-percent">0%</strong>
                </div>
                <div class="password-strength-track" role="progressbar" aria-label="Password strength" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                    <span id="expired-password-strength-bar" class="password-strength-bar"></span>
                </div>
                <div id="expired-password-strength-label" class="password-strength-label">Start typing to build a strong password.</div>
                <ul class="password-rule-list" aria-label="Password requirements">
                    <li data-password-rule="length"><i class="fa-regular fa-circle" aria-hidden="true"></i><span>At least 12 characters</span></li>
                    <li data-password-rule="letter"><i class="fa-regular fa-circle" aria-hidden="true"></i><span>At least 1 letter</span></li>
                    <li data-password-rule="uppercase"><i class="fa-regular fa-circle" aria-hidden="true"></i><span>At least 1 uppercase letter</span></li>
                    <li data-password-rule="number"><i class="fa-regular fa-circle" aria-hidden="true"></i><span>At least 1 number</span></li>
                    <li data-password-rule="symbol"><i class="fa-regular fa-circle" aria-hidden="true"></i><span>At least 1 symbol</span></li>
                </ul>
                <div id="expired-password-match" class="password-match-status"><i class="fa-regular fa-circle" aria-hidden="true"></i> Confirm your new password.</div>
            </div>
        `,
        confirmButtonText: "Change password",
        cancelButtonText: "Back to login",
        showCancelButton: true,
        allowOutsideClick: false,
        allowEscapeKey: false,
        focusConfirm: false,
        showLoaderOnConfirm: true,
        didOpen: () => {
            const newPasswordInput = document.getElementById("expired-password-new");
            const confirmPasswordInput = document.getElementById("expired-password-confirm");
            const strengthBar = document.getElementById("expired-password-strength-bar");
            const strengthTrack = strengthBar?.parentElement;
            const strengthPercent = document.getElementById("expired-password-strength-percent");
            const strengthLabel = document.getElementById("expired-password-strength-label");
            const matchStatus = document.getElementById("expired-password-match");
            const confirmButton = Swal.getConfirmButton();

            const updatePasswordStrength = () => {
                const password = newPasswordInput?.value || "";
                const confirmation = confirmPasswordInput?.value || "";
                const rules = {
                    length: password.length >= 12,
                    letter: /[A-Za-z]/.test(password),
                    uppercase: /[A-Z]/.test(password),
                    number: /[0-9]/.test(password),
                    symbol: /[^A-Za-z0-9]/.test(password)
                };
                const passedRules = Object.values(rules).filter(Boolean).length;
                const percent = passedRules * 20;
                const isStrong = passedRules === 5;
                const passwordsMatch = confirmation.length > 0 && password === confirmation;
                const strengthState = isStrong ? "strong" : (passedRules >= 3 ? "fair" : "weak");
                const strengthText = password
                    ? (isStrong ? "Strong password — you’re all set!" : (passedRules >= 3 ? "Almost there — complete the checklist." : "Keep going — make it harder to guess."))
                    : "Start typing to build a strong password.";

                if (strengthBar) {
                    strengthBar.style.width = `${percent}%`;
                    strengthBar.className = `password-strength-bar ${strengthState}`;
                }
                strengthTrack?.setAttribute("aria-valuenow", String(percent));
                if (strengthPercent) strengthPercent.textContent = `${percent}%`;
                if (strengthLabel) {
                    strengthLabel.textContent = strengthText;
                    strengthLabel.className = `password-strength-label ${password ? strengthState : ""}`;
                }

                Object.entries(rules).forEach(([rule, passed]) => {
                    const item = document.querySelector(`[data-password-rule="${rule}"]`);
                    const icon = item?.querySelector("i");
                    item?.classList.toggle("passed", passed);
                    if (icon) icon.className = passed ? "fa-solid fa-circle-check" : "fa-regular fa-circle";
                });

                if (matchStatus) {
                    matchStatus.classList.toggle("matched", passwordsMatch);
                    matchStatus.classList.toggle("unmatched", confirmation.length > 0 && !passwordsMatch);
                    matchStatus.innerHTML = passwordsMatch
                        ? '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Passwords match.'
                        : confirmation
                            ? '<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i> Passwords do not match yet.'
                            : '<i class="fa-regular fa-circle" aria-hidden="true"></i> Confirm your new password.';
                }

                if (confirmButton) {
                    confirmButton.disabled = !(isStrong && passwordsMatch);
                }
            };

            document.querySelectorAll(".expired-password-toggle").forEach(button => {
                button.addEventListener("click", () => {
                    const input = document.getElementById(button.dataset.passwordTarget);
                    if (!input) return;

                    const showPassword = input.type === "password";
                    input.type = showPassword ? "text" : "password";
                    button.setAttribute("aria-pressed", String(showPassword));
                    button.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
                    button.querySelector("i")?.classList.toggle("fa-eye", !showPassword);
                    button.querySelector("i")?.classList.toggle("fa-eye-slash", showPassword);
                    input.focus();
                });
            });
            newPasswordInput?.addEventListener("input", updatePasswordStrength);
            confirmPasswordInput?.addEventListener("input", updatePasswordStrength);
            updatePasswordStrength();
            newPasswordInput?.focus();
        },
        preConfirm: async () => {
            const newPassword = document.getElementById("expired-password-new")?.value || "";
            const confirmPassword = document.getElementById("expired-password-confirm")?.value || "";
            const isStrong = newPassword.length >= 12
                && /[A-Za-z]/.test(newPassword)
                && /[A-Z]/.test(newPassword)
                && /[0-9]/.test(newPassword)
                && /[^A-Za-z0-9]/.test(newPassword);

            if (!isStrong) {
                Swal.showValidationMessage("Use at least 12 characters with an uppercase letter, number, and symbol.");
                return false;
            }
            if (newPassword !== confirmPassword) {
                Swal.showValidationMessage("The new passwords do not match.");
                return false;
            }

            try {
                const response = await fetch(getAuthApiUrl(), {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        operation: "change_expired_password",
                        json: JSON.stringify({
                            new_password: newPassword,
                            confirm_password: confirmPassword
                        })
                    })
                });
                const data = await response.json();
                if (data.status !== "success") {
                    throw new Error(data.message || "Unable to change password.");
                }
                return data;
            } catch (error) {
                Swal.showValidationMessage(error.message || "Unable to change password.");
                return false;
            }
        }
    });

    if (!result.isConfirmed || !result.value) {
        await fetch(getAuthApiUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ operation: "logout" })
        }).catch(() => {});
        return null;
    }

    if (result.value.reauthenticate) {
        clearLocalAuthSession();
    } else {
        persistAuthSession(result.value);
    }
    await Swal.fire({
        icon: "success",
        title: "Password Updated",
        text: result.value.message || "Your password was changed successfully.",
        timer: result.value.reauthenticate ? undefined : 1400,
        showConfirmButton: Boolean(result.value.reauthenticate),
        confirmButtonText: "Return to login"
    });
    return result.value;
}

export function handleLogin() {
    if (loginRequestInProgress) return;

    const username = document.getElementById("username").value.trim();  
    const password = document.getElementById("password").value;
    const captchaAnswerInput = document.getElementById("captcha-answer");
    const loginButton = document.querySelector(".btn-signin");

    if (!username || !password) {
        Swal.fire({
            icon: "warning",
            title: "Missing Fields",
            text: "Please enter both username and password"
        });
        return;
    }

    if (!captchaAnswerInput.value.trim()) {
        Swal.fire({
            icon: "warning",
            title: "Missing CAPTCHA",
            text: "Please answer the math CAPTCHA"
        });
        return;
    }

    const captchaHasExpired = captchaExpiresAt <= Date.now();

    if (!mathCaptchaChallengeId || captchaHasExpired) {
        generateMathCaptcha();
        Swal.fire({
            icon: "warning",
            title: "CAPTCHA Expired",
            text: "A new CAPTCHA has been generated. Please solve it and try again."
        });
        return;
    }

    if (!validateMathCaptcha()) {
        Swal.fire({
            icon: "warning",
            title: "Incorrect CAPTCHA",
            text: "Please enter the correct answer shown"
        });
        return;
    }

    loginRequestInProgress = true;
    loginButton?.setAttribute("disabled", "");

    // Show loading
    Swal.fire({
        title: "Logging in...",
        text: "Please wait",
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    performLogin(
        username,
        password,
        captchaAnswerInput.value.trim(),
        mathCaptchaChallengeId,
        document.getElementById("keep-signed-in")?.checked === true
    )
    .then(async data => {
        Swal.close();

        if (data.status === "password_expired" || data.status === "password_change_required") {
            const updatedLogin = await promptForExpiredPassword(data);
            if (updatedLogin?.reauthenticate) {
                loginRequestInProgress = false;
                loginButton?.removeAttribute("disabled");
                document.getElementById("username").value = "";
                document.getElementById("password").value = "";
                generateMathCaptcha();
                document.getElementById("username").focus();
                return;
            }
            if (updatedLogin?.user) {
                window.location.href = getDashboardPathForRole(updatedLogin.user.role_name);
                return;
            }

            loginRequestInProgress = false;
            loginButton?.removeAttribute("disabled");
            document.getElementById("password").value = "";
            generateMathCaptcha();
            return;
        }

        const alreadyAuthenticated = data.status === "already_authenticated";

        Swal.fire({
            icon: alreadyAuthenticated ? "info" : "success",
            title: alreadyAuthenticated ? "Already Logged In" : "Login Successful",
            text: alreadyAuthenticated ? data.message : `Welcome ${data.user.username}`,
            timer: 1500,
            showConfirmButton: false
        }).then(() => {
            window.location.href = getDashboardPathForRole(data.user.role_name);
        });
    })
    .catch(error => {
        Swal.close();
        loginRequestInProgress = false;
        loginButton?.removeAttribute("disabled");
        generateMathCaptcha();
        Swal.fire({
            icon: "error",
            title: "Login Failed",
            text: error.message
        });
    });
}

export function handleEmployeeSignup() {
    const first_name = document.getElementById("first_name").value.trim();
    const middle_name = document.getElementById("middle_name").value.trim();
    const last_name = document.getElementById("last_name").value.trim();
    const role = document.getElementById("role").value;
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!first_name || !last_name || !username || !password) {
        Swal.fire({
            icon: "warning",
            title: "Missing Fields",
            text: "Please fill in all required fields"
        });
        return;
    }

    // Show loading
    Swal.fire({
        title: "Signing up...",
        text: "Please wait",
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    axios.post(buildAppUrl("api/admin/employee.php"), new URLSearchParams({
        operation: "signup",
        json: JSON.stringify({ first_name, middle_name, last_name, role, username, password })
    }))
    .then(res => {
        Swal.close();

        if (res.data.status === "success") {
            Swal.fire({
                icon: "success",
                title: "Signup Successful",
                text: res.data.message,
                timer: 1500,
                showConfirmButton: false
            }).then(() => {
                window.location.href = buildAppUrl("login.html");
            });
        } else {
            Swal.fire({
                icon: "error",
                title: "Signup Failed",
                text: res.data.message
            });
        }
    })
    .catch(() => {
        Swal.close();
        Swal.fire({
            icon: "error",
            title: "Server Error",
            text: "Unable to connect to the server"
        });
    });
}

export function handleSignup() {
    const first_name = document.getElementById("first_name").value.trim();
    const middle_name = document.getElementById("middle_name").value.trim();
    const last_name = document.getElementById("last_name").value.trim();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!first_name || !last_name || !username || !password) {
        Swal.fire({
            icon: "warning",
            title: "Missing Fields",
            text: "Please fill in all required fields"
        });
        return;
    }

    // Show loading
    Swal.fire({
        title: "Signing up...",
        text: "Please wait",
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    axios.post(buildAppUrl("api/login.php"), new URLSearchParams({
        operation: "signup",
        json: JSON.stringify({ first_name, middle_name, last_name, username, password })
    }))
    .then(res => {
        Swal.close();

        if (res.data.status === "success") {
            Swal.fire({
                icon: "success",
                title: "Signup Successful",
                text: res.data.message,
                timer: 1500,
                showConfirmButton: false
            }).then(() => {
                window.location.href = buildAppUrl("login.html");
            });
        } else {
            Swal.fire({
                icon: "error",
                title: "Signup Failed",
                text: res.data.message
            });
        }
    })
    .catch(() => {
        Swal.close();
        Swal.fire({
            icon: "error",
            title: "Server Error",
            text: "Unable to connect to the server"
        });
    });
}

export async function logout() {
    if (logoutInProgress) {
        return;
    }

    logoutInProgress = true;
    try {
        await fetch(getAuthApiUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                operation: 'logout'
            })
        });
    } catch (error) {
        console.error('Server logout failed:', error);
    } finally {
        idleWarningVisible = false;
        clearLocalAuthSession();
        window.history.replaceState(null, '', buildAppUrl('login.html'));
        window.location.replace(buildAppUrl('login.html'));
    }
}
