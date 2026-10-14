import { renderPasswordModal, setupPasswordModal } from "./password.js?v=20260929-password-days";
import { normalizeProfileImage } from "../utilities/profile_image.js";

let currentEmployeeData = null;
let lastLoadedEmployeeId = null;

export function initEmployeeProfile() {
    const container = document.getElementById('dashboard-content') || document.querySelector('.dashboard-content');
    if (!container) return;

    document.body.classList.add('profile-page');

    // Get logged-in employee ID from localStorage
    const userData = localStorage.getItem('user');
    const user = userData ? JSON.parse(userData) : null;

    // Try user_id first (from login), fall back to employee_id
    const employeeId = user?.user_id || user?.employee_id || 1;

    console.log('Current logged-in user:', user);
    console.log('Employee ID from localStorage:', employeeId);

    // Only load if employee_id changed or first load
    if (lastLoadedEmployeeId !== employeeId) {
        lastLoadedEmployeeId = employeeId;
        currentEmployeeData = null; // Clear cached data

        // Load employee profile
        loadEmployeeProfile(employeeId, container);
    }
}

function loadEmployeeProfile(employeeId, container) {
    // Fetch actual employee profile data from API
    axios.get(`../../api/admin/employee.php?operation=getEmployeeProfile&employee_id=${employeeId}`)
        .then(res => {
            console.log('Employee Profile API Response:', res.data);

            if (res.data && res.data.status === 'success' && res.data.data) {
                const employee = res.data.data;

                // Build profile data combining API data with defaults
                const profileData = {
                    employee_id: employee.employee_id,
                    fullName: `${employee.first_name} ${employee.last_name}`,
                    first_name: employee.first_name || '',
                    last_name: employee.last_name || '',
                    middle_name: employee.middle_name || '',
                    username: employee.username || '',
                    profile_picture: employee.profile_picture || '',
                    email: employee.email || '',
                    smtp_app_password_configured: Boolean(Number(employee.smtp_app_password_configured || 0)),
                    contact_number: employee.contact_number || '',
                    birthday: employee.birthday || '',
                    age: calculateAge(employee.birthday),
                    degree: employee.degree || '',
                    role_name: employee.role_name || '',
                    branch_name: employee.branch_name || '',
                    status: employee.status || 'Active',
                    subjects: employee.subjects || 'Not assigned',
                    programs: employee.programs || 'Not assigned',
                    date_created: employee.date_created || '',
                    password_days_remaining: Math.max(0, Number(employee.password_days_remaining ?? 72)),
                    password_change_due_at: employee.password_change_due_at || '',
                    password_expired: Boolean(Number(employee.password_expired || 0)),
                    earnings: '0.00',
                    earningsTrend: '+ 0%',
                    classes: 0,
                    students: 0,
                    paymentMethod: 'Not set'
                };

                currentEmployeeData = profileData;
                renderEmployeeProfilePage(profileData, container);
                renderPasswordModal(container);
                setupEditEmployeeProfileModal(profileData, container);
                setupPasswordModal(profileData, () => loadEmployeeProfile(employeeId, container));
                setupOwnerEmailSettings(profileData);
            } else {
                console.error('Unexpected API response:', res.data);
                loadDemoEmployeeProfile(container);
            }
        })
        .catch(err => {
            console.error('Error loading employee profile:', err.message);
            loadDemoEmployeeProfile(container);
        });
}

function loadDemoEmployeeProfile(container) {
    // Fallback demo data when API is unavailable
    const profileData = {
        employee_id: 1,
        fullName: 'John Smith',
        first_name: 'John',
        last_name: 'Smith',
        middle_name: '',
        username: 'jsmith',
        profile_picture: '',
        email: 'john.smith@example.com',
        smtp_app_password_configured: false,
        contact_number: '+1 (234) 567 8901',
        birthday: '1985-05-15',
        age: calculateAge('1985-05-15'),
        degree: 'Bachelor of Education',
        role_name: 'Teacher',
        branch_name: 'Main Branch',
        status: 'Active',
        subjects: 'Mathematics, Physics',
        programs: 'Tutorial Program (Regular), Pre-school Program (Play-school)',
        date_created: '2023-01-15',
        password_days_remaining: 72,
        password_change_due_at: '',
        password_expired: false,
        earnings: '3,250.00',
        earningsTrend: '+ 15.2%',
        classes: 8,
        students: 24,
        paymentMethod: 'Bank Transfer'
    };

    currentEmployeeData = profileData;
    renderEmployeeProfilePage(profileData, container);
    renderPasswordModal(container);
    setupEditEmployeeProfileModal(profileData, container);
    setupPasswordModal(profileData);
    setupOwnerEmailSettings(profileData);
}

function renderEmployeeProfilePage(profileData, container) {
    const primaryColor = '#ea9aa6';
    const passwordDaysRemaining = Math.max(0, Math.min(72, Number(profileData.password_days_remaining ?? 72)));
    const passwordExpired = Boolean(profileData.password_expired);
    const passwordProgress = Math.round((passwordDaysRemaining / 72) * 100);
    const passwordDueDate = formatPasswordDueDate(profileData.password_change_due_at);
    const passwordStatusText = passwordExpired
        ? 'Password change required'
        : `${passwordDaysRemaining} day${passwordDaysRemaining === 1 ? '' : 's'} remaining`;
    const passwordStatusColor = passwordExpired ? '#dc3545' : (passwordDaysRemaining <= 14 ? '#d98200' : '#198754');

    container.innerHTML = `
        <style>
            .profile-card { border-radius: 12px; border: none; box-shadow: 0 2px 12px rgba(0,0,0,0.04); background: #fff; margin-bottom: 1rem; }
            .compact-header { padding: 1.5rem !important; }
            .section-title { font-size: 1rem; font-weight: 600; color: #333; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px; }
            .btn-action { border: 1px solid #eee; border-radius: 6px; padding: 6px 12px; font-size: 0.85rem; background: #fff; color: #666; transition: 0.2s; }
            .btn-action:hover { background: ${primaryColor}; color: white; border-color: ${primaryColor}; }
            .info-label { color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
            .info-value { color: #333; font-weight: 500; font-size: 0.9rem; margin-bottom: 12px; }
            .password-expiry-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
            .password-expiry-count { color: ${passwordStatusColor}; font-size: 1.05rem; font-weight: 700; }
            .password-expiry-track { height: 8px; overflow: hidden; border-radius: 999px; background: #f0edf0; }
            .password-expiry-fill { width: ${passwordProgress}%; height: 100%; border-radius: inherit; background: ${passwordStatusColor}; }
        </style>

        <div class="container-fluid p-0">
            <div class="row g-3">
                <div class="col-12">

                    <div class="card profile-card compact-header">
                        <div class="row align-items-center profile-summary-row">
                            <div class="col-auto position-relative profile-avatar">
                                ${profileData.profile_picture ? 
                                    `<img src="${resolveProfilePictureUrl(profileData.profile_picture)}" alt="Profile" class="rounded-circle profile-picture-image" style="width: 80px; height: 80px; object-fit: cover; border: 3px solid ${primaryColor};">` :
                                    `<div class="rounded-circle d-flex align-items-center justify-content-center fw-bold" 
                                        style="width: 80px; height: 80px; background: ${primaryColor}; color: white; font-size: 1.5rem;">
                                        ${getInitials(profileData.first_name, profileData.last_name)}
                                    </div>`
                                }
                            </div>
                            <div class="col profile-identity">
                                <h4 class="mb-0 fw-bold">${profileData.fullName}</h4>
                                <div class="d-flex align-items-center gap-2 mt-1 profile-meta" style="font-size: 0.85rem;">
                                    <span style="color: ${primaryColor}"><i class="bi bi-person-badge"></i> ${profileData.role_name}</span>
                                    <span class="text-muted">|</span>
                                    <span class="text-success">● ${profileData.status}</span>
                                </div>
                                <div class="d-flex gap-3 mt-2 profile-contact-list" style="font-size: 0.8rem; color: #777;">
                                    <span><i class="bi bi-envelope"></i> ${profileData.email || 'Not set'}</span>
                                    <span><i class="bi bi-telephone"></i> ${profileData.contact_number || 'Not set'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="d-flex gap-2 mt-3 profile-action-list">
                            <button type="button" class="btn btn-action flex-grow-1" id="editEmployeeProfileBtn"><i class="bi bi-pencil"></i> Edit Profile</button>
                            <button type="button" class="btn btn-action flex-grow-1" id="passwordEmployeeProfileBtn"><i class="bi bi-shield-lock"></i> Password</button>
                            ${String(profileData.role_name).trim().toLowerCase() === 'owner'
                                ? `<button type="button" class="btn btn-action flex-grow-1" id="ownerEmailSettingsBtn"><i class="bi bi-envelope-lock"></i> Email Sending</button>`
                                : ''}
                        </div>
                    </div>

                    <div class="row g-3">
                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3">
                                <h6 class="section-title"><i class="bi bi-person" style="color:${primaryColor}"></i> Personal Info</h6>
                                <div class="info-label">Full Name</div>
                                <div class="info-value">${profileData.fullName}</div>
                                <div class="info-label">Username</div>
                                <div class="info-value">${profileData.username}</div>
                                <div class="info-label">Age</div>
                                <div class="info-value">${profileData.age}</div>
                                <div class="info-label">Degree</div>
                                <div class="info-value mb-0">${profileData.degree || 'Not specified'}</div>
                            </div>
                        </div>

                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3 h-100">
                                <h6 class="section-title"><i class="bi bi-building" style="color:${primaryColor}"></i> Employment</h6>
                                <div class="info-label">Role</div>
                                <div class="info-value">${profileData.role_name}</div>
                                <div class="info-label">Branch</div>
                                <div class="info-value">${profileData.branch_name || 'Not assigned'}</div>
                                <div class="info-label">Date Joined</div>
                                <div class="info-value mb-0">${new Date(profileData.date_created).toLocaleDateString()}</div>
                            </div>
                        </div>

                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3 h-100">
                                <h6 class="section-title"><i class="bi bi-book" style="color:${primaryColor}"></i> Teaching</h6>
                                <div class="info-label">Subjects</div>
                                <div class="info-value">${profileData.subjects}</div>
                                <div class="info-label">Programs</div>
                                <div class="info-value mb-0">${profileData.programs}</div>
                            </div>
                        </div>

                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3 h-100">
                                <h6 class="section-title"><i class="bi bi-telephone" style="color:${primaryColor}"></i> Contact Details</h6>
                                <div class="info-label">Email Address</div>
                                <div class="info-value">${profileData.email || 'Not set'}</div>
                                <div class="info-label">Contact Number</div>
                                <div class="info-value">${profileData.contact_number || 'Not set'}</div>
                                <div class="info-label">Status</div>
                                <div class="info-value mb-0">${profileData.status}</div>
                            </div>
                        </div>

                        <div class="col-12">
                            <div class="card profile-card p-3">
                                <div class="password-expiry-summary">
                                    <div>
                                        <h6 class="section-title mb-1"><i class="bi bi-shield-lock" style="color:${passwordStatusColor}"></i> Password Security</h6>
                                        <div class="text-muted small">${passwordExpired ? 'Change your password to continue using your account.' : `Next password change is due ${passwordDueDate}.`}</div>
                                    </div>
                                    <div class="password-expiry-count">${passwordStatusText}</div>
                                </div>
                                <div class="password-expiry-track mt-3" role="progressbar" aria-label="Password validity remaining" aria-valuemin="0" aria-valuemax="72" aria-valuenow="${passwordDaysRemaining}">
                                    <div class="password-expiry-fill"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        ${String(profileData.role_name).trim().toLowerCase() === 'owner' ? `
        <div class="modal fade" id="ownerEmailSettingsModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Email Sending Settings</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info small">
                            Sender: <strong>${profileData.email}</strong><br>
                            Status: <strong id="ownerSmtpStatus">${profileData.smtp_app_password_configured ? 'App password configured' : 'App password not configured'}</strong>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="ownerGmailAppPassword">Gmail app password</label>
                            <input type="password" class="form-control" id="ownerGmailAppPassword" autocomplete="new-password" placeholder="16-character app password">
                            <small class="text-muted">Generate this from the same Gmail account shown above. Spaces are removed automatically.</small>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="ownerCurrentAccountPassword">Current system account password</label>
                            <input type="password" class="form-control" id="ownerCurrentAccountPassword" autocomplete="current-password" placeholder="Confirm your identity">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="saveOwnerEmailSettingsBtn">Save Email Settings</button>
                    </div>
                </div>
            </div>
        </div>` : ''}

        <!-- Edit Profile Modal -->
        <div class="modal fade" id="editEmployeeProfileModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Edit Profile</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="editEmployeeProfileForm" enctype="multipart/form-data">
                            <h6 class="text-primary mb-3">Profile Picture</h6>
                            <div class="mb-3">
                                <label class="form-label">Profile Picture</label>
                                <div class="d-flex align-items-center gap-3">
                                    <div id="previewEmployeeProfilePicture" class="rounded-circle d-flex align-items-center justify-content-center fw-bold"
                                         style="width: 80px; height: 80px; background: #ea9aa6; color: white; font-size: 1.5rem; overflow: hidden;"></div>
                                    <input type="file" class="form-control" id="editEmployeeProfilePicture" accept="image/*">
                                </div>
                                <small class="text-muted d-block mt-2">Accepted formats: JPG, PNG, GIF (Max 5MB)</small>
                            </div>

                            <h6 class="text-primary mb-3 border-top pt-3">Employee Details</h6>
                            <div class="row">
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">First Name <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editEmployeeFirstName" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Middle Name</label>
                                    <input type="text" class="form-control" id="editEmployeeMiddleName">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Last Name <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editEmployeeLastName" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Degree</label>
                                    <input type="text" class="form-control" id="editEmployeeDegree">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Birthday</label>
                                    <input type="date" class="form-control" id="editEmployeeBirthday">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Contact Number <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="tel" class="form-control" id="editEmployeeContact" required>
                                </div>
                                <div class="col-md-12 mb-3">
                                    <label class="form-label">Email <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="email" class="form-control" id="editEmployeeEmail" required>
                                </div>
                                ${String(profileData.role_name).trim().toLowerCase() !== 'owner' ? `
                                <div class="col-md-12 mb-3">
                                    <label class="form-label" for="editEmployeeCurrentPassword">Current Password (required to change email)</label>
                                    <input type="password" class="form-control" id="editEmployeeCurrentPassword" autocomplete="current-password">
                                </div>` : ''}
                                ${String(profileData.role_name).trim().toLowerCase() === 'owner' ? `
                                <div class="col-12"><h6 class="text-primary mb-3 border-top pt-3">Email Sending</h6></div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label" for="editOwnerGmailAppPassword">Gmail App Password</label>
                                    <input type="password" class="form-control" id="editOwnerGmailAppPassword" autocomplete="new-password" placeholder="16-character app password">
                                    <small class="text-muted">${profileData.smtp_app_password_configured ? 'An app password is configured. Leave blank to keep it.' : 'No app password is configured.'} Spaces are removed automatically.</small>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label" for="editOwnerCurrentPassword">Current System Password</label>
                                    <input type="password" class="form-control" id="editOwnerCurrentPassword" autocomplete="current-password" placeholder="Required when changing email settings">
                                    <small class="text-muted">This confirms that the logged-in owner authorized the change.</small>
                                </div>` : ''}
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="saveEmployeeProfileBtn">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
    
        <!-- Change Password Modal -->
    `;
}

function formatPasswordDueDate(value) {
    if (!value) return 'in 72 days';
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime())
        ? 'in 72 days'
        : `on ${date.toLocaleDateString()}`;
}

function setupOwnerEmailSettings(profileData) {
    if (String(profileData.role_name).trim().toLowerCase() !== 'owner') return;

    const openButton = document.getElementById('ownerEmailSettingsBtn');
    const modalElement = document.getElementById('ownerEmailSettingsModal');
    const saveButton = document.getElementById('saveOwnerEmailSettingsBtn');
    if (!openButton || !modalElement || !saveButton) return;

    openButton.addEventListener('click', () => {
        document.getElementById('ownerGmailAppPassword').value = '';
        document.getElementById('ownerCurrentAccountPassword').value = '';
        new bootstrap.Modal(modalElement).show();
    });

    saveButton.addEventListener('click', async () => {
        const appPassword = document.getElementById('ownerGmailAppPassword').value.replace(/\s+/g, '');
        const accountPassword = document.getElementById('ownerCurrentAccountPassword').value;

        if (!/^[A-Za-z0-9]{16}$/.test(appPassword) || !accountPassword) {
            Swal.fire('Required', 'Enter the 16-character Gmail app password and your current system password.', 'warning');
            return;
        }

        saveButton.disabled = true;
        try {
            const response = await axios.post('../../api/admin/employee.php', {
                operation: 'updateOwnerSmtpSettings',
                json: JSON.stringify({
                    smtp_app_password: appPassword,
                    account_password: accountPassword
                })
            });

            if (response.data?.status !== 'success') {
                throw new Error(response.data?.message || 'Unable to save email settings.');
            }

            profileData.smtp_app_password_configured = true;
            document.getElementById('ownerSmtpStatus').textContent = 'App password configured';
            document.getElementById('ownerGmailAppPassword').value = '';
            document.getElementById('ownerCurrentAccountPassword').value = '';
            bootstrap.Modal.getInstance(modalElement)?.hide();
            Swal.fire('Saved', response.data.message, 'success');
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || error.message || 'Unable to save email settings.', 'error');
        } finally {
            saveButton.disabled = false;
        }
    });
}

function setupEditEmployeeProfileModal(profileData, container) {
    const editBtn = document.getElementById('editEmployeeProfileBtn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            openEditEmployeeProfileModal(profileData);
        });
    }
}

function openEditEmployeeProfileModal(profileData) {
    // Populate form with current data
    document.getElementById('editEmployeeFirstName').value = profileData.first_name || '';
    document.getElementById('editEmployeeMiddleName').value = profileData.middle_name || '';
    document.getElementById('editEmployeeLastName').value = profileData.last_name || '';
    document.getElementById('editEmployeeDegree').value = profileData.degree || '';
    document.getElementById('editEmployeeBirthday').value = profileData.birthday || '';
    document.getElementById('editEmployeeContact').value = profileData.contact_number || '';
    document.getElementById('editEmployeeEmail').value = profileData.email || '';
    const smtpPasswordInput = document.getElementById('editOwnerGmailAppPassword');
    const currentPasswordInput = document.getElementById('editOwnerCurrentPassword');
    if (smtpPasswordInput) smtpPasswordInput.value = '';
    if (currentPasswordInput) currentPasswordInput.value = '';

    const previewDiv = document.getElementById('previewEmployeeProfilePicture');
    const fileInput = document.getElementById('editEmployeeProfilePicture');

    if (profileData.profile_picture) {
        previewDiv.innerHTML = `<img src="${resolveProfilePictureUrl(profileData.profile_picture)}" alt="Profile" class="profile-picture-image" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
        previewDiv.innerHTML = getInitials(profileData.first_name, profileData.last_name);
    }

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                previewDiv.innerHTML = `<img src="${event.target.result}" alt="Preview" style="width: 100%; height: 100%; object-fit: cover;">`;
            };
            reader.readAsDataURL(file);
        }
    };

    // Setup save handler
    const saveBtn = document.getElementById('saveEmployeeProfileBtn');
    if (saveBtn) {
        saveBtn.onclick = () => handleSaveEmployeeProfile(profileData.employee_id);
    }

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('editEmployeeProfileModal'));
    modal.show();
}

async function handleSaveEmployeeProfile(employeeId) {
    const data = {
        employee_id: employeeId,
        first_name: document.getElementById('editEmployeeFirstName').value,
        middle_name: document.getElementById('editEmployeeMiddleName').value,
        last_name: document.getElementById('editEmployeeLastName').value,
        degree: document.getElementById('editEmployeeDegree').value,
        birthday: document.getElementById('editEmployeeBirthday').value,
        contact_number: document.getElementById('editEmployeeContact').value,
        email: document.getElementById('editEmployeeEmail').value
    };
    const smtpPasswordInput = document.getElementById('editOwnerGmailAppPassword');
    const currentPasswordInput = document.getElementById('editOwnerCurrentPassword');
    const smtpAppPassword = smtpPasswordInput?.value.replace(/\s+/g, '') || '';
    const currentAccountPassword = currentPasswordInput?.value || document.getElementById('editEmployeeCurrentPassword')?.value || '';
    data.current_password = currentAccountPassword;
    const ownerEmailChanged = Boolean(smtpPasswordInput)
        && data.email.trim().toLowerCase() !== String(currentEmployeeData?.email || '').trim().toLowerCase();

    // Validation
    if (!data.first_name || !data.last_name || !data.email || !data.contact_number) {
        Swal.fire('Required', 'Please fill in all required fields', 'warning');
        return;
    }

    if (!isValidEmail(data.email)) {
        Swal.fire('Invalid Email', 'Please enter a valid email address', 'warning');
        return;
    }

    if (!isValidContactNumber(data.contact_number)) {
        Swal.fire('Invalid Contact', 'Please enter a valid contact number', 'warning');
        return;
    }

    if (smtpPasswordInput && (ownerEmailChanged || smtpAppPassword !== '')) {
        if (!/^[A-Za-z0-9]{16}$/.test(smtpAppPassword)) {
            Swal.fire('App Password Required', 'Enter the 16-character Gmail app password for the owner email.', 'warning');
            return;
        }
        if (!currentAccountPassword) {
            Swal.fire('Password Required', 'Enter your current system password to update email sending settings.', 'warning');
            return;
        }

        data.smtp_app_password = smtpAppPassword;
        data.current_account_password = currentAccountPassword;
    }

    const formData = new FormData();
    formData.append('operation', 'updateEmployeeProfile');
    formData.append('json', JSON.stringify(data));

    const fileInput = document.getElementById('editEmployeeProfilePicture');
    if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (file.size > 5 * 1024 * 1024) {
            Swal.fire('File Too Large', 'Profile picture must be less than 5MB', 'warning');
            return;
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            Swal.fire('Invalid File', 'Please upload a JPG, PNG, or GIF image', 'warning');
            return;
        }

        formData.append('profile_picture', await normalizeProfileImage(file));
    }

    axios.post('../../api/admin/employee.php', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    })
    .then(res => {
        if (res.data.status === 'success') {
            Swal.fire('Success', res.data.message || 'Profile updated successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editEmployeeProfileModal')).hide();
            // Reload profile
            location.reload();
        } else {
            Swal.fire('Error', res.data.message, 'error');
        }
    })
    .catch(err => {
        console.error('Error:', err);
        Swal.fire('Error', 'Network error occurred', 'error');
    });
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidContactNumber(contact) {
    return typeof contact === 'string' && /^[0-9+()\\s-]{7,20}$/.test(contact);
}

function getInitials(firstName, lastName) {
    const first = (firstName || '').charAt(0).toUpperCase();
    const last = (lastName || '').charAt(0).toUpperCase();
    return (first + last) || '?';
}

function resolveProfilePictureUrl(profilePicture) {
    return window.resolveUploadUrl(profilePicture);
}

function calculateAge(birthday) {
    if (!birthday) return 'N/A';

    const birthDate = new Date(birthday);
    if (Number.isNaN(birthDate.getTime())) return 'N/A';

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const birthdayThisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());

    if (today < birthdayThisYear) {
        age -= 1;
    }

    return age >= 0 ? `${age} years old` : 'N/A';
}
