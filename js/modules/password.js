import {
    bindPasswordVisibilityToggles,
    bindPasswordStrengthUI,
    getPasswordInputMarkup,
    getPasswordRequirementMessage,
    getPasswordStrengthMarkup,
    validatePasswordStrength
} from "./passwordStrength.js";

export function renderPasswordModal(container = document.body) {
    const parent = container || document.body;
    if (document.getElementById('changePasswordModal')) return;

    parent.insertAdjacentHTML('beforeend', getPasswordModalTemplate());
}

function getPasswordModalTemplate() {
    return `
        <div class="modal fade" id="changePasswordModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Update Login Credentials</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="changePasswordForm">
                            <div class="row g-3">
                                <div class="col-md-12">
                                    <label class="form-label">Username</label>
                                    <input type="text" class="form-control" id="passwordUsername" placeholder="Enter new username" required>
                                </div>
                                <div class="col-md-12">
                                    <label class="form-label">Email</label>
                                    <input type="email" class="form-control" id="passwordEmail" placeholder="Enter email address" required>
                                </div>
                                <div class="col-md-12">
                                    <label class="form-label">New Password</label>
                                    ${getPasswordInputMarkup({
                                        inputId: 'passwordNew',
                                        placeholder: 'Enter new password',
                                        toggleId: 'togglePasswordNew'
                                    })}
                                </div>
                                ${getPasswordStrengthMarkup()}
                                <div class="col-md-12">
                                    <label class="form-label">Confirm New Password</label>
                                    ${getPasswordInputMarkup({
                                        inputId: 'passwordConfirm',
                                        placeholder: 'Re-enter new password',
                                        toggleId: 'togglePasswordConfirm'
                                    })}
                                </div>
                                <div class="col-12">
                                    <small class="text-muted">${getPasswordRequirementMessage()}</small>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="savePasswordBtn">Save Credentials</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function setupPasswordModal(profileData) {
    const passwordBtn = document.getElementById('passwordEmployeeProfileBtn');
    if (!passwordBtn) return;

    passwordBtn.addEventListener('click', () => {
        openEmployeeCredentialsModal(profileData);
    });
}

export function openEmployeeCredentialsModal(profileData, onComplete) {
    const usernameInput = document.getElementById('passwordUsername');
    const emailInput = document.getElementById('passwordEmail');
    const newPasswordInput = document.getElementById('passwordNew');
    const confirmPasswordInput = document.getElementById('passwordConfirm');

    if (!usernameInput || !emailInput || !newPasswordInput || !confirmPasswordInput) {
        return;
    }

    usernameInput.value = profileData.username || '';
    emailInput.value = profileData.email || '';
    newPasswordInput.value = '';
    confirmPasswordInput.value = '';

    const modalElement = document.getElementById('changePasswordModal');
    const saveButton = document.getElementById('savePasswordBtn');

    if (!modalElement || !saveButton) {
        return;
    }

    bindPasswordVisibilityToggles();
    bindPasswordStrengthUI({
        usernameInput,
        passwordInput: newPasswordInput,
        confirmInput: confirmPasswordInput,
        saveButton
    });

    saveButton.onclick = () => handleSavePassword(profileData.employee_id, onComplete);

    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

function handleSavePassword(employeeId, onComplete) {
    const username = document.getElementById('passwordUsername')?.value.trim();
    const email = document.getElementById('passwordEmail')?.value.trim();
    const newPassword = document.getElementById('passwordNew')?.value.trim();
    const confirmPassword = document.getElementById('passwordConfirm')?.value.trim();

    if (!username || !email || !newPassword || !confirmPassword) {
        Swal.fire('Required fields', 'Please complete all fields before saving.', 'warning');
        return;
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
        Swal.fire('Invalid email', 'Please enter a valid email address.', 'warning');
        return;
    }

    if (newPassword !== confirmPassword) {
        Swal.fire('Password mismatch', 'The new password and confirmation do not match.', 'warning');
        return;
    }

    if (!validatePasswordStrength(newPassword)) {
        Swal.fire(
            'Weak password',
            getPasswordRequirementMessage(),
            'warning'
        );
        return;
    }

    axios.post('../../api/admin/employee.php', {
        operation: 'updateEmployeePassword',
        json: JSON.stringify({
            employee_id: employeeId,
            username,
            email,
            new_password: newPassword,
            confirm_password: confirmPassword
        })
    })
    .then(response => {
        const res = response.data;
        if (res.status === 'success') {
            Swal.fire('Updated', res.message, 'success');
            const modalElement = document.getElementById('changePasswordModal');
            const modalInstance = bootstrap.Modal.getInstance(modalElement);
            modalInstance?.hide();
            onComplete?.(res);
        } else {
            Swal.fire('Error', res.message || 'Unable to update password.', 'error');
        }
    })
    .catch(err => {
        console.error('Password update error:', err);
        Swal.fire('Error', 'Network error occurred while updating password.', 'error');
    });
}
