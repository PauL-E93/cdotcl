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
const IDLE_LOGOUT_TIMEOUT_MS = 10 * 60 * 1000;
const IDLE_WARNING_TIMEOUT_MS = 30 * 1000;

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
    if (data?.user) {
        localStorage.setItem("user", JSON.stringify(data.user));
    }

    if (data?.session_token) {
        localStorage.setItem("session_token", data.session_token);
    }

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

function showIdleWarningModal() {
    Swal.fire({
        title: "You are about to be logged out",
        text: "Click OK to stay logged in. Otherwise you will be logged out in 30 seconds.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Stay Logged In",
        cancelButtonText: "Log Me Out",
        allowOutsideClick: false,
        allowEscapeKey: false,
        reverseButtons: true
    }).then((result) => {
        if (result.isConfirmed) {
            resetIdleLogoutTimer();
        }
    });
}

function resetIdleLogoutTimer() {
    clearIdleLogoutTimer();
    clearIdleWarningTimer();

    if (!localStorage.getItem("user")) {
        return;
    }

    idleWarningTimer = window.setTimeout(() => {
        showIdleWarningModal();
    }, IDLE_LOGOUT_TIMEOUT_MS - IDLE_WARNING_TIMEOUT_MS);

    idleLogoutTimer = window.setTimeout(() => {
        logout().catch(() => {
            window.location.href = buildAppUrl("login.html");
        });
    }, IDLE_LOGOUT_TIMEOUT_MS);
}

function attachIdleLogoutListeners() {
    if (idleLogoutListenersAttached) {
        return;
    }

    idleLogoutListenersAttached = true;

    const activityEvents = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => {
        document.addEventListener(eventName, resetIdleLogoutTimer, { passive: true });
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

    if (!expectedFolder || !currentFolder || currentFolder === expectedFolder) {
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
        localStorage.removeItem("user");
        localStorage.removeItem("session_token");

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
            throw new Error(data.message || "Unable to load CAPTCHA");
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
    })
    .finally(() => {
        if (requestSequence !== captchaRequestSequence) return;

        answerInput.disabled = false;
        refreshCaptchaButton?.removeAttribute("disabled");
    });
}

export function initLoginPage() {
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

export function performLogin(username, password, captchaAnswer, captchaChallengeId) {
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
                captcha_challenge_id: captchaChallengeId
            })
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === "success" || data.status === "already_authenticated") {
            persistAuthSession(data);
            return data;
        } else {
            throw new Error(data.message);
        }
    });
}

export function handleLogin() {
    if (loginRequestInProgress) return;

    const username = document.getElementById("username").value.trim();  
    const password = document.getElementById("password").value.trim();
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
        mathCaptchaChallengeId
    )
    .then(data => {
        Swal.close();

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
        clearIdleLogoutTimer();
        localStorage.removeItem('user');
        localStorage.removeItem('session_token');
        window.history.replaceState(null, '', buildAppUrl('login.html'));
        window.location.replace(buildAppUrl('login.html'));
    }
}
