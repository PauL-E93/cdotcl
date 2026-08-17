export const PASSWORD_MIN_LENGTH = 8;

export function getPasswordRequirementMessage() {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include at least 1 letter, 1 uppercase letter, 1 number, and 1 symbol.`;
}

export function getPasswordStrengthMarkup() {
    return `
        <div class="col-12">
            <div class="border rounded-3 p-3 bg-light-subtle">
                <div class="d-flex justify-content-between align-items-center small mb-2">
                    <span class="text-muted">Password Strength</span>
                    <span id="passwordStrengthPercent" class="fw-semibold">0%</span>
                </div>
                <div class="progress" style="height: 8px;">
                    <div
                        id="passwordStrengthBar"
                        class="progress-bar bg-danger"
                        role="progressbar"
                        style="width: 0%;"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow="0"
                    ></div>
                </div>
                <div id="passwordStrengthLabel" class="small text-muted mt-2">Start typing to check password strength.</div>
                <div class="row g-2 mt-1 small">
                    <div class="col-md-6">
                        <div id="passwordRuleLength" class="text-muted"><i class="bi bi-circle me-1"></i> At least ${PASSWORD_MIN_LENGTH} characters</div>
                    </div>
                    <div class="col-md-6">
                        <div id="passwordRuleLetter" class="text-muted"><i class="bi bi-circle me-1"></i> At least 1 letter</div>
                    </div>
                    <div class="col-md-6">
                        <div id="passwordRuleUppercase" class="text-muted"><i class="bi bi-circle me-1"></i> At least 1 uppercase letter</div>
                    </div>
                    <div class="col-md-6">
                        <div id="passwordRuleNumber" class="text-muted"><i class="bi bi-circle me-1"></i> At least 1 number</div>
                    </div>
                    <div class="col-md-6">
                        <div id="passwordRuleSymbol" class="text-muted"><i class="bi bi-circle me-1"></i> At least 1 symbol</div>
                    </div>
                </div>
                <div id="passwordConfirmStatus" class="small text-muted mt-2">Confirm your new password to continue.</div>
            </div>
        </div>
    `;
}

export function getPasswordInputMarkup({ inputId, placeholder, toggleId }) {
    return `
        <div class="input-group">
            <input type="password" class="form-control" id="${inputId}" placeholder="${placeholder}" required>
            <button
                type="button"
                class="btn btn-outline-secondary"
                id="${toggleId}"
                data-target="${inputId}"
                aria-label="Show password"
                aria-pressed="false"
            >
                <i class="bi bi-eye"></i>
            </button>
        </div>
    `;
}

export function validatePasswordStrength(password) {
    return evaluatePasswordStrength(password).isStrong;
}

export function bindPasswordStrengthUI({
    usernameInput,
    passwordInput,
    confirmInput,
    saveButton,
    scope = document
}) {
    if (!passwordInput || !confirmInput) {
        return () => {};
    }

    const progressBar = scope.getElementById('passwordStrengthBar');
    const percentLabel = scope.getElementById('passwordStrengthPercent');
    const strengthLabel = scope.getElementById('passwordStrengthLabel');
    const confirmStatus = scope.getElementById('passwordConfirmStatus');

    const ruleElements = {
        length: scope.getElementById('passwordRuleLength'),
        letter: scope.getElementById('passwordRuleLetter'),
        uppercase: scope.getElementById('passwordRuleUppercase'),
        number: scope.getElementById('passwordRuleNumber'),
        symbol: scope.getElementById('passwordRuleSymbol')
    };

    const update = () => {
        const password = passwordInput.value || '';
        const confirmPassword = confirmInput.value || '';
        const evaluation = evaluatePasswordStrength(password);
        const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

        if (progressBar) {
            progressBar.style.width = `${evaluation.percent}%`;
            progressBar.className = `progress-bar ${evaluation.barClass}`;
            progressBar.setAttribute('aria-valuenow', String(evaluation.percent));
        }

        if (percentLabel) {
            percentLabel.textContent = `${evaluation.percent}%`;
            percentLabel.className = `fw-semibold ${evaluation.textClass}`;
        }

        if (strengthLabel) {
            strengthLabel.textContent = password
                ? `${evaluation.label} password`
                : 'Start typing to check password strength.';
            strengthLabel.className = `small mt-2 ${password ? evaluation.textClass : 'text-muted'}`;
        }

        updateRuleState(ruleElements.length, evaluation.rules.length);
        updateRuleState(ruleElements.letter, evaluation.rules.letter);
        updateRuleState(ruleElements.uppercase, evaluation.rules.uppercase);
        updateRuleState(ruleElements.number, evaluation.rules.number);
        updateRuleState(ruleElements.symbol, evaluation.rules.symbol);

        if (confirmStatus) {
            if (!confirmPassword) {
                confirmStatus.textContent = 'Confirm your new password to continue.';
                confirmStatus.className = 'small text-muted mt-2';
            } else if (passwordsMatch) {
                confirmStatus.textContent = 'Passwords match.';
                confirmStatus.className = 'small text-success mt-2';
            } else {
                confirmStatus.textContent = 'Passwords do not match yet.';
                confirmStatus.className = 'small text-danger mt-2';
            }
        }

        if (saveButton) {
            const hasUsername = usernameInput ? usernameInput.value.trim().length > 0 : true;
            const canSubmit = hasUsername && evaluation.isStrong && passwordsMatch;
            saveButton.disabled = !canSubmit;
            saveButton.setAttribute('aria-disabled', String(!canSubmit));
        }
    };

    if (usernameInput) {
        usernameInput.oninput = update;
    }
    passwordInput.oninput = update;
    confirmInput.oninput = update;
    update();

    return update;
}

export function bindPasswordVisibilityToggles(scope = document) {
    const toggleButtons = scope.querySelectorAll('[data-target]');
    toggleButtons.forEach((button) => {
        button.onclick = () => {
            const targetId = button.getAttribute('data-target');
            const input = targetId ? scope.getElementById(targetId) : null;
            const icon = button.querySelector('i');

            if (!input || !icon) {
                return;
            }

            const isVisible = input.type === 'text';
            input.type = isVisible ? 'password' : 'text';
            button.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
            button.setAttribute('aria-pressed', String(!isVisible));
            icon.className = isVisible ? 'bi bi-eye' : 'bi bi-eye-slash';
        };
    });
}

function evaluatePasswordStrength(password = '') {
    const rules = {
        length: password.length >= PASSWORD_MIN_LENGTH,
        letter: /[A-Za-z]/.test(password),
        uppercase: /[A-Z]/.test(password),
        number: /[0-9]/.test(password),
        symbol: /[^A-Za-z0-9]/.test(password)
    };

    const passedChecks = Object.values(rules).filter(Boolean).length;
    const totalChecks = Object.keys(rules).length;
    const percent = Math.round((passedChecks / totalChecks) * 100);

    if (passedChecks === totalChecks) {
        return {
            rules,
            percent,
            isStrong: true,
            label: 'Strong',
            barClass: 'bg-success',
            textClass: 'text-success'
        };
    }

    if (passedChecks >= 4) {
        return {
            rules,
            percent,
            isStrong: false,
            label: 'Almost strong',
            barClass: 'bg-info',
            textClass: 'text-info'
        };
    }

    if (passedChecks >= 3) {
        return {
            rules,
            percent,
            isStrong: false,
            label: 'Fair',
            barClass: 'bg-warning',
            textClass: 'text-warning'
        };
    }

    return {
        rules,
        percent,
        isStrong: false,
        label: 'Weak',
        barClass: 'bg-danger',
        textClass: 'text-danger'
    };
}

function updateRuleState(element, isMet) {
    if (!element) {
        return;
    }

    element.classList.toggle('text-success', isMet);
    element.classList.toggle('text-muted', !isMet);

    const icon = element.querySelector('i');
    if (icon) {
        icon.className = isMet ? 'bi bi-check-circle-fill me-1' : 'bi bi-circle me-1';
    }
}
