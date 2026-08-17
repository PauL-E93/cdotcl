// js/modules/services.js

import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';

let cachedBranches = [];

async function fetchBranches() {
    try {
        const res = await axios.get('../../api/admin/services.php', { params: { operation: 'getBranches' } });
        cachedBranches = res.data && res.data.status === 'success' ? (res.data.data || []) : [];
    } catch (err) {
        console.error('Error fetching branches', err);
        cachedBranches = [];
    }
}

export function initServicesPage() {
    if (canUseProgramPermission('view_services') || canUseProgramPermission('create_services') || canUseProgramPermission('edit_services')) {
        fetchBranches();
    }
    if (canUseProgramPermission('view_services')) loadServices();
    const addButton = document.getElementById('btnAddService');
    if (addButton) {
        addButton.addEventListener('click', setupAddServiceModal);
    }
}

export function loadServices() {
    if (!canUseProgramPermission('view_services')) return;
    const tableBody = document.getElementById('services_table_body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';

    axios.get('../../api/admin/services.php', { params: { operation: 'getServices' } })
        .then(res => {
            if (res.data && res.data.status === 'success') {
                const services = res.data.data || [];
                if (services.length === 0) {
                    tableBody.innerHTML = '<tr><td colspan="5" class="text-center">No services found</td></tr>';
                    return;
                }

                tableBody.innerHTML = '';
                services.forEach(service => {
                    const amount = parseFloat(service.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const status = (service.status || '').toLowerCase();
                    const badge = status === 'active'
                        ? '<span class="badge bg-success">Active</span>'
                        : '<span class="badge bg-secondary">Inactive</span>';

                    tableBody.innerHTML += `
                        <tr>
                            <td class="fw-bold">${service.service_name || 'N/A'}</td>
                            <td>₱${amount}</td>
                            <td>${service.branch_names || '<span class="text-muted">Not offered</span>'}</td>
                            <td>${badge}</td>
                            <td>
                                ${canUseProgramPermission('edit_services')
                                    ? `<button class="btn btn-sm btn-outline-primary me-1" onclick="window.editService(${service.service_id})">
                                        <i class="bi bi-pencil-square"></i>
                                    </button>`
                                    : '<span class="text-muted">-</span>'
                                }
                            </td>
                        </tr>`;
                });
            } else {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Failed to load services</td></tr>';
            }
        })
        .catch(() => {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Request failed</td></tr>';
        });
}

export async function setupAddServiceModal() {
    if (!guardProgramPermission('create_services', 'You do not have permission to add services.')) {
        return;
    }

    const modalEl = document.getElementById('addServiceModal');
    if (!modalEl) return;
    if (cachedBranches.length === 0) await fetchBranches();

    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    document.getElementById('serviceModalLabel').innerText = 'Add Service';
    document.getElementById('serviceForm').innerHTML = getServiceFormHTML();
    document.getElementById('serviceModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveService">Save Service</button>
    `;

    document.getElementById('btnSaveService').addEventListener('click', () => submitServiceData('insertService'));
}

async function setupEditServiceModal(data) {
    const modalEl = document.getElementById('addServiceModal');
    if (!modalEl) return;
    if (cachedBranches.length === 0) await fetchBranches();

    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    document.getElementById('serviceModalLabel').innerText = 'Edit Service';
    document.getElementById('serviceForm').innerHTML = getServiceFormHTML(data);
    document.getElementById('serviceModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateService">Update Service</button>
    `;

    document.getElementById('btnUpdateService').addEventListener('click', () => submitServiceData('updateService', data.service_id));
}

function getServiceFormHTML(data = {}) {
    const name = data.service_name || '';
    const amount = data.amount || '';
    const status = data.status || 'active';
    const selectedBranchIds = (data.branch_ids || []).map(String);
    const branchOptions = cachedBranches.length > 0
        ? cachedBranches.map(branch => `
            <div class="form-check">
                <input class="form-check-input" type="checkbox" name="service_branch_ids" id="service_branch_${branch.branch_id}" value="${branch.branch_id}" ${selectedBranchIds.includes(String(branch.branch_id)) ? 'checked' : ''}>
                <label class="form-check-label" for="service_branch_${branch.branch_id}">${branch.branch_name}</label>
            </div>
        `).join('')
        : '<div class="text-muted small">No branches found. Add a branch before assigning this service.</div>';

    return `
        <div class="row">
            <div class="col-md-12 mb-3">
                <label class="form-label">Service Name <span class="text-danger">*</span></label>
                <input type="text" id="service_name" class="form-control" value="${name}" placeholder="Enter service name" required>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Amount <span class="text-danger">*</span></label>
                <input type="number" id="service_amount" class="form-control" value="${amount}" placeholder="0.00" step="0.01" min="0" required>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Status</label>
                <select id="service_status" class="form-select">
                    <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
            </div>
            <div class="col-md-12 mb-3">
                <label class="form-label">Available Branches</label>
                <div class="border rounded p-3">
                    ${branchOptions}
                </div>
                <small class="text-muted">Only checked branches can add this service during enrollment.</small>
            </div>
        </div>`;
}

function submitServiceData(operation, id = null) {
    const name = document.getElementById('service_name')?.value.trim();
    const amount = document.getElementById('service_amount')?.value;
    const status = document.getElementById('service_status')?.value;

    if (!name || amount === '' || amount === null) {
        Swal.fire('Error', 'Please provide service name and amount.', 'warning');
        return;
    }

    const payload = {
        service_name: name,
        amount: amount,
        status: status || 'active',
        branch_ids: Array.from(document.querySelectorAll('input[name="service_branch_ids"]:checked'))
            .map(input => Number(input.value))
    };
    if (id) payload.service_id = id;

    Swal.fire({ title: 'Saving...', didOpen: () => Swal.showLoading() });
    axios.post('../../api/admin/services.php', { operation, json: JSON.stringify(payload) })
        .then(res => {
            Swal.close();
            if (res.data && res.data.status === 'success') {
                const modalEl = document.getElementById('addServiceModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();
                loadServices();
                Swal.fire('Success', res.data.message, 'success');
            } else {
                Swal.fire('Error', res.data?.message || 'Save failed.', 'error');
            }
        })
        .catch(err => {
            console.error(err);
            Swal.close();
            Swal.fire('Error', 'Request failed.', 'error');
        });
}

window.editService = function(id) {
    if (!guardProgramPermission('edit_services', 'You do not have permission to edit services.')) {
        return;
    }

    Swal.fire({ title: 'Loading service...', didOpen: () => Swal.showLoading() });
    axios.post('../../api/admin/services.php', {
        operation: 'getService',
        json: JSON.stringify({ service_id: id })
    })
        .then(res => {
            Swal.close();
            if (res.data && res.data.status === 'success') {
                setupEditServiceModal(res.data.data);
            } else {
                Swal.fire('Error', res.data?.message || 'Unable to load service.', 'error');
            }
        })
        .catch(err => {
            console.error(err);
            Swal.close();
            Swal.fire('Error', 'Request failed.', 'error');
        });
};

// window.deleteService = function(id) {
//     Swal.fire({
//         title: 'Are you sure?',
//         text: 'This service will be permanently removed.',
//         icon: 'warning',
//         showCancelButton: true,
//         confirmButtonColor: '#3085d6',
//         cancelButtonColor: '#d33',
//         confirmButtonText: 'Delete'
//     }).then(result => {
//         if (!result.isConfirmed) return;

//         Swal.fire({ title: 'Deleting...', didOpen: () => Swal.showLoading() });
//         axios.post('../../api/admin/services.php', {
//             operation: 'deleteService',
//             json: JSON.stringify({ service_id: id })
//         })
//             .then(res => {
//                 Swal.close();
//                 if (res.data && res.data.status === 'success') {
//                     loadServices();
//                     Swal.fire('Deleted!', res.data.message, 'success');
//                 } else {
//                     Swal.fire('Error', res.data?.message || 'Delete failed.', 'error');
//                 }
//             })
//             .catch(err => {
//                 console.error(err);
//                 Swal.close();
//                 Swal.fire('Error', 'Request failed.', 'error');
//             });
//     });
// };
