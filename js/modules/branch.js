// js/modules/branch.js
import {
    applyCenterPagePermissions,
    canUseCenterPermission,
    guardCenterPermission,
    initCenterPermissions
} from "./center_rbac.js";

let branches = [];
let employees = [];

function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

function formatTime(value) {
    if (!value) return '';
    const [hours, minutes] = String(value).split(':');
    const hour = Number(hours);
    if (!Number.isFinite(hour)) return String(value);
    return `${hour % 12 || 12}:${minutes || '00'} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function getScheduleLabel(branch) {
    const timeRange = branch.opening_time && branch.closing_time
        ? `${formatTime(branch.opening_time)} – ${formatTime(branch.closing_time)}`
        : '';
    return [branch.operating_days, timeRange].filter(Boolean).join(', ') || 'Not set';
}

export function loadBranches() {
    axios.get('../../api/admin/branch.php?operation=getActiveBranches')
        .then(res => {
            branches = Array.isArray(res.data) ? res.data : [];
            populateTableHead();
            populateTableBody();
            updateStats();
        })
        .catch(err => {
            console.error('Error loading branches:', err);
            Swal.fire('Error', 'Failed to load centers', 'error');
        });
}

function populateTableHead() {
    const thead = document.getElementById('tableHead');
    if (thead) {
        const showActionsColumn = canUseCenterPermission('view') || canUseCenterPermission('edit');
        thead.innerHTML = `
            <tr>
                <th>Name</th>
                <th>Location</th>
                <th>Phone</th>
                <th>Operating Schedule</th>
                <th>Employee</th>
                ${showActionsColumn ? '<th class="text-center">Actions</th>' : ''}
            </tr>
        `;
    }
}

function populateTableBody(sourceBranches = branches) {
    const tbody = document.getElementById('branchTableBody');
    if (!tbody) return;

    const showViewAction = canUseCenterPermission('view');
    const showEditAction = canUseCenterPermission('edit');
    const showActionsColumn = showViewAction || showEditAction;
    const emptyColspan = showActionsColumn ? 6 : 5;

    if (sourceBranches.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${emptyColspan}" class="text-center text-muted">No centers found</td></tr>`;
        return;
    }

    tbody.innerHTML = sourceBranches.map(branch => `
        <tr>
            <td>${escapeHtml(branch.branch_name)}</td>
            <td>${escapeHtml(branch.branch_location)}</td>
            <td>${escapeHtml(branch.phone_number || 'Not set')}</td>
            <td>${escapeHtml(getScheduleLabel(branch))}</td>
            <td>${escapeHtml(branch.employee_name || 'N/A')}</td>
            ${showActionsColumn ? `
                <td class="text-center">
                    <div class="dropdown">
                        <button class="btn btn-sm btn-link text-secondary p-0" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
                            <i class="bi bi-three-dots-vertical fs-5"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            ${showViewAction ? `<li><button class="dropdown-item" type="button" onclick="openViewCenterModal(${branch.branch_id})"><i class="bi bi-eye me-2"></i>View</button></li>` : ''}
                            ${showEditAction ? `<li><button class="dropdown-item" type="button" onclick="openEditCenterModal(${branch.branch_id})"><i class="bi bi-pencil me-2"></i>Edit</button></li>` : ''}
                        </ul>
                    </div>
                </td>
            ` : ''}
        </tr>
    `).join('');
}

function updateStats() {
    const totalCenters = branches.length;
    document.getElementById('total-centers-count').textContent = totalCenters;
    // Add more stats if needed, e.g., total sections, categories
}

export function openAddCenterModal() {
    if (!guardCenterPermission('create', 'You do not currently have permission to add centers.')) {
        return;
    }

    loadEmployees().then(() => {
        const modalHTML = `
            <div class="modal fade" id="addCenterModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Add New Center</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="addCenterForm">
                                <div class="mb-3">
                                    <label class="form-label">Center Name <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="centerName" placeholder="Center Name" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Location <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="centerLocation" placeholder="Location" required>
                                </div>
                                <div class="row">
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Phone Number</label>
                                        <input type="tel" class="form-control" id="centerPhone" placeholder="e.g. 0926-113-8886">
                                    </div>
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Operating Days</label>
                                        <input type="text" class="form-control" id="centerOperatingDays" placeholder="e.g. Mon - Sat">
                                    </div>
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Opening Time</label>
                                        <input type="time" class="form-control" id="centerOpeningTime">
                                    </div>
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Closing Time</label>
                                        <input type="time" class="form-control" id="centerClosingTime">
                                    </div>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Employee (Manager) <span class="text-danger" aria-hidden="true">*</span></label>
                                    <select class="form-select" id="centerEmployee" required>
                                        <option value="">Select Employee</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                                    <select class="form-select" id="centerStatus" required>
                                        <option value="active" selected>Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            <button type="button" class="btn btn-primary" id="saveCenterBtn">Save Center</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const existingModal = document.getElementById('addCenterModal');
        if (existingModal) existingModal.remove();
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = new bootstrap.Modal(document.getElementById('addCenterModal'));
        modal.show();

        // Populate employee select
        const addSelect = document.getElementById('centerEmployee');
        const options = '<option value="">Select Employee</option>' +
            employees.map(e => `<option value="${e.employee_id}">${e.first_name} ${e.last_name}</option>`).join('');
        if (addSelect) addSelect.innerHTML = options;

        document.getElementById('saveCenterBtn').onclick = () => saveCenter();
    });
}

export function openEditCenterModal(branchId) {
    if (!guardCenterPermission('edit', 'You do not currently have permission to edit centers.')) {
        return;
    }

    const branch = branches.find(b => b.branch_id == branchId);
    if (!branch) return;

    loadEmployees().then(() => {
        const modalHTML = `
            <div class="modal fade" id="editCenterModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Edit Center</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="editCenterForm">
                                <div class="mb-3">
                                    <label class="form-label">Center Name <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editCenterName" value="${escapeHtml(branch.branch_name)}" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Location <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editCenterLocation" value="${escapeHtml(branch.branch_location)}" required>
                                </div>
                                <div class="row">
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Phone Number</label>
                                        <input type="tel" class="form-control" id="editCenterPhone" value="${escapeHtml(branch.phone_number || '')}" placeholder="e.g. 0926-113-8886">
                                    </div>
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Operating Days</label>
                                        <input type="text" class="form-control" id="editCenterOperatingDays" value="${escapeHtml(branch.operating_days || '')}" placeholder="e.g. Mon - Sat">
                                    </div>
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Opening Time</label>
                                        <input type="time" class="form-control" id="editCenterOpeningTime" value="${escapeHtml(branch.opening_time || '')}">
                                    </div>
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">Closing Time</label>
                                        <input type="time" class="form-control" id="editCenterClosingTime" value="${escapeHtml(branch.closing_time || '')}">
                                    </div>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Employee (Manager) <span class="text-danger" aria-hidden="true">*</span></label>
                                    <select class="form-select" id="editCenterEmployee" required>
                                        <option value="">Select Employee</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                                    <select class="form-select" id="editCenterStatus" required>
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                    </select>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            <button type="button" class="btn btn-primary" id="updateCenterBtn">Update Center</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const existingModal = document.getElementById('editCenterModal');
        if (existingModal) existingModal.remove();
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = new bootstrap.Modal(document.getElementById('editCenterModal'));
        modal.show();

        // Populate employee select
        const editSelect = document.getElementById('editCenterEmployee');
        const options = '<option value="">Select Employee</option>' +
            employees.map(e => `<option value="${e.employee_id}">${e.first_name} ${e.last_name}</option>`).join('');
        if (editSelect) editSelect.innerHTML = options;

        // Set employee select value after modal is shown
        setTimeout(() => {
            document.getElementById('editCenterEmployee').value = branch.employee_id;
            document.getElementById('editCenterStatus').value = String(branch.status || 'active').toLowerCase();
        }, 100);

        document.getElementById('updateCenterBtn').onclick = () => updateCenter(branchId);
    });
}

export function openViewCenterModal(branchId) {
    if (!guardCenterPermission('view', 'You do not currently have permission to view centers.')) {
        return;
    }

    const branch = branches.find(b => b.branch_id == branchId);
    if (!branch) return;

    document.getElementById('viewCenterModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="viewCenterModal" tabindex="-1" aria-labelledby="viewCenterModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="viewCenterModalLabel">Center Details</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <dl class="row mb-0">
                            <dt class="col-sm-4">Center Name</dt><dd class="col-sm-8">${escapeHtml(branch.branch_name || 'N/A')}</dd>
                            <dt class="col-sm-4">Location</dt><dd class="col-sm-8">${escapeHtml(branch.branch_location || 'N/A')}</dd>
                            <dt class="col-sm-4">Phone Number</dt><dd class="col-sm-8">${escapeHtml(branch.phone_number || 'Not set')}</dd>
                            <dt class="col-sm-4">Operating Schedule</dt><dd class="col-sm-8">${escapeHtml(getScheduleLabel(branch))}</dd>
                            <dt class="col-sm-4">Manager</dt><dd class="col-sm-8">${escapeHtml(branch.employee_name || 'N/A')}</dd>
                            <dt class="col-sm-4">Status</dt><dd class="col-sm-8 text-capitalize">${escapeHtml(branch.status || 'active')}</dd>
                        </dl>
                    </div>
                    <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button></div>
                </div>
            </div>
        </div>
    `);

    new bootstrap.Modal(document.getElementById('viewCenterModal')).show();
}

function saveCenter() {
    if (!guardCenterPermission('create', 'You do not currently have permission to add centers.')) {
        return;
    }

    const name = document.getElementById('centerName').value;
    const location = document.getElementById('centerLocation').value;
    const phoneNumber = document.getElementById('centerPhone').value.trim();
    const operatingDays = document.getElementById('centerOperatingDays').value.trim();
    const openingTime = document.getElementById('centerOpeningTime').value;
    const closingTime = document.getElementById('centerClosingTime').value;
    const employeeId = document.getElementById('centerEmployee').value;
    const status = document.getElementById('centerStatus').value;

    if (!name || !location || !employeeId || !status) {
        Swal.fire('Error', 'Please fill all fields', 'error');
        return;
    }

    const data = {
        branch_name: name,
        branch_location: location,
        phone_number: phoneNumber,
        operating_days: operatingDays,
        opening_time: openingTime,
        closing_time: closingTime,
        employee_id: employeeId,
        status
    };

    const params = new URLSearchParams();
    params.append('operation', 'insertBranch');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/branch.php', params)
        .then(res => {
            if (res.data == 1) {
                Swal.fire('Success', 'Center added successfully!', 'success');
                bootstrap.Modal.getInstance(document.getElementById('addCenterModal')).hide();
                loadBranches();
            } else {
                Swal.fire('Error', 'Failed to add center', 'error');
            }
        })
        .catch(err => {
            console.error('Error:', err);
            Swal.fire('Error', 'Network error', 'error');
        });
}

function updateCenter(branchId) {
    if (!guardCenterPermission('edit', 'You do not currently have permission to edit centers.')) {
        return;
    }

    const name = document.getElementById('editCenterName').value;
    const location = document.getElementById('editCenterLocation').value;
    const phoneNumber = document.getElementById('editCenterPhone').value.trim();
    const operatingDays = document.getElementById('editCenterOperatingDays').value.trim();
    const openingTime = document.getElementById('editCenterOpeningTime').value;
    const closingTime = document.getElementById('editCenterClosingTime').value;
    const employeeId = document.getElementById('editCenterEmployee').value;
    const status = document.getElementById('editCenterStatus').value;

    if (!name || !location || !employeeId || !status) {
        Swal.fire('Error', 'Please fill all fields', 'error');
        return;
    }

    const data = {
        branch_id: branchId,
        branch_name: name,
        branch_location: location,
        phone_number: phoneNumber,
        operating_days: operatingDays,
        opening_time: openingTime,
        closing_time: closingTime,
        employee_id: employeeId,
        status
    };

    const params = new URLSearchParams();
    params.append('operation', 'updateBranch');
    params.append('json', JSON.stringify(data));

    axios.post('../../api/admin/branch.php', params)
        .then(res => {
            if (res.data == 1) {
                Swal.fire('Success', 'Center updated successfully!', 'success');
                bootstrap.Modal.getInstance(document.getElementById('editCenterModal')).hide();
                loadBranches();
            } else {
                Swal.fire('Error', 'Failed to update center', 'error');
            }
        })
        .catch(err => {
            console.error('Error:', err);
            Swal.fire('Error', 'Network error', 'error');
        });
}

export function deleteCenter(branchId) {
    if (!guardCenterPermission('delete', 'You do not currently have permission to delete centers.')) {
        return;
    }

    Swal.fire({
        title: 'Are you sure?',
        text: 'This will delete the center permanently.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, delete it!'
    }).then(result => {
        if (result.isConfirmed) {
            const data = { branch_id: branchId };
            const params = new URLSearchParams();
            params.append('operation', 'deleteBranch');
            params.append('json', JSON.stringify(data));

            axios.post('../../api/admin/branch.php', params)
                .then(res => {
                    if (res.data == 1) {
                        Swal.fire('Deleted!', 'Center has been deleted.', 'success');
                        loadBranches();
                    } else {
                        Swal.fire('Error', 'Failed to delete center', 'error');
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    Swal.fire('Error', 'Network error', 'error');
                });
        }
    });
}

function loadEmployees() {
    return axios.get('../../api/admin/employee.php?operation=getAllEmployees')
        .then(res => {
            employees = Array.isArray(res.data) ? res.data : [];
        })
        .catch(err => console.error('Error loading employees:', err));
}

function setupCenterMoreOptions() {
    const moreOptionBtn = document.getElementById('more_option');
    const moreOptionDropdown = document.getElementById('more_option_dropdown');
    const moreOptionWrapper = moreOptionBtn?.closest('.position-relative');
    const canCreate = canUseCenterPermission('create');

    if (!moreOptionBtn || !moreOptionDropdown || !moreOptionWrapper) return;

    moreOptionDropdown.innerHTML = '';
    moreOptionWrapper.classList.toggle('d-none', !canCreate);

    if (!canCreate) {
        return;
    }

    moreOptionBtn.onclick = event => {
        event.stopPropagation();

        if (moreOptionDropdown.innerHTML !== '') {
            moreOptionDropdown.innerHTML = '';
            return;
        }

        const optionList = document.createElement('ul');
        optionList.classList.add('list-group', 'shadow', 'rounded', 'bg-white', 'mt-1', 'fw-normal');
        optionList.style.minWidth = '180px';

        const option = document.createElement('li');
        option.classList.add('list-group-item', 'list-group-item-action', 'small', 'py-2');
        option.style.cursor = 'pointer';
        option.textContent = 'Add Center';
        option.addEventListener('click', () => {
            openAddCenterModal();
            moreOptionDropdown.innerHTML = '';
        });

        optionList.appendChild(option);
        moreOptionDropdown.appendChild(optionList);
    };

    document.addEventListener('click', event => {
        if (!moreOptionBtn.contains(event.target) && !moreOptionDropdown.contains(event.target)) {
            moreOptionDropdown.innerHTML = '';
        }
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await initCenterPermissions();
    const access = applyCenterPagePermissions();
    if (!access.allowed) {
        return;
    }

    loadBranches();
    setupCenterMoreOptions();

    // Add button event
    const addBtn = document.getElementById('addCenterBtn');
    if (addBtn) {
        addBtn.onclick = openAddCenterModal;
    }

    // Search functionality (basic)
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            const filtered = branches.filter(b =>
                String(b.branch_name || '').toLowerCase().includes(query) ||
                String(b.branch_location || '').toLowerCase().includes(query) ||
                String(b.phone_number || '').toLowerCase().includes(query) ||
                String(b.operating_days || '').toLowerCase().includes(query)
            );
            populateTableBody(filtered);
        });
    }
});

// Expose functions to window for onclick
window.openEditCenterModal = openEditCenterModal;
window.openViewCenterModal = openViewCenterModal;
