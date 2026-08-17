// js/modules/registration_amount.js
import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';

export function loadRegistrationAmounts() {
    if (!canUseProgramPermission('view_registration')) return;
    const tableBody = document.getElementById('registration_table_body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="4" class="text-center">Loading...</td></tr>';

    axios.get('../../api/admin/registratin_amount.php', { params: { operation: 'getRegistrationAmounts' } })
        .then(res => {
            if (res.data && res.data.status === 'success') {
                const items = res.data.data || [];
                tableBody.innerHTML = '';

                if (items.length === 0) {
                    tableBody.innerHTML = '<tr><td colspan="4" class="text-center">No registration amounts found</td></tr>';
                    return;
                }

                items.forEach(item => {
                    const amount = parseFloat(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const status = (item.status || '').toLowerCase();
                    const badge = status === 'active'
                        ? '<span class="badge bg-success">Active</span>'
                        : status === 'inactive'
                            ? '<span class="badge bg-secondary">Inactive</span>'
                            : '<span class="badge bg-warning">Unknown</span>';

                    const row = `
                        <tr>
                            <td class="fw-bold">${item.registration_name || 'N/A'}</td>
                            <td>₱${amount}</td>
                            <td>${badge}</td>
                            <td>
                                ${canUseProgramPermission('edit_registration')
                                    ? `<button class="btn btn-sm btn-outline-primary me-1" onclick="window.editRegistrationAmount(${item.registration_id})">
                                        <i class="bi bi-pencil-square"></i>
                                    </button>`
                                    : '<span class="text-muted">-</span>'
                                }
                            </td>
                        </tr>
                    `;
                    tableBody.innerHTML += row;
                });
            } else {
                tableBody.innerHTML = '<tr><td colspan="4" class="text-center">Failed to load data</td></tr>';
            }
        })
        .catch(() => {
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center">Request failed</td></tr>';
        });
}

export function setupAddRegistrationAmountModal() {
    if (!guardProgramPermission('create_registration', 'You do not have permission to add registration amounts.')) {
        return;
    }

    const modalEl = document.getElementById('addRegistrationAmountModal');
    if (!modalEl) return;

    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();

    document.getElementById('registrationModalLabel').innerText = 'Add Registration Amount';
    document.getElementById('registrationForm').innerHTML = getRegistrationFormHTML();

    document.getElementById('registrationModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveRegistrationAmount">Save</button>
    `;

    document.getElementById('btnSaveRegistrationAmount').addEventListener('click', () => submitRegistrationData('insertRegistrationAmount'));
}

function setupEditRegistrationAmountModal(data) {
    const modalEl = document.getElementById('addRegistrationAmountModal');
    if (!modalEl) return;

    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();

    document.getElementById('registrationModalLabel').innerText = 'Edit Registration Amount';
    document.getElementById('registrationForm').innerHTML = getRegistrationFormHTML({
        name: data.registration_name,
        amount: data.amount,
        status: data.status
    });

    document.getElementById('registrationModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateRegistrationAmount">Update</button>
    `;

    document.getElementById('btnUpdateRegistrationAmount').addEventListener('click', () => submitRegistrationData('updateRegistrationAmount', data.registration_id));
}

function getRegistrationFormHTML(data = {}) {
    const name = data.name || '';
    const amount = data.amount || '';
    const status = data.status || 'active';

    return `
        <div class="row">
            <div class="col-md-12 mb-3">
                <label class="form-label">Registration Name <span class="text-danger">*</span></label>
                <input type="text" id="registration_name" class="form-control" value="${name}" required>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Amount <span class="text-danger">*</span></label>
                <input type="number" id="registration_amount" class="form-control" value="${amount}" placeholder="0.00" step="0.01" required>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Status <span class="text-danger">*</span></label>
                <select id="registration_status" class="form-select" required>
                    <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
            </div>
        </div>
    `;
}

function submitRegistrationData(operation, id = null) {
    const name = document.getElementById('registration_name')?.value.trim();
    const amount = document.getElementById('registration_amount')?.value;
    const status = document.getElementById('registration_status')?.value;

    if (!name || amount === '' || amount === null || !status) {
        Swal.fire('Error', 'Please fill in all required fields', 'warning');
        return;
    }

    const payload = {
        registration_name: name,
        amount: amount,
        status: status
    };
    if (id) payload.registration_id = id;

    Swal.fire({ title: 'Processing...', didOpen: () => Swal.showLoading() });
    axios.post('../../api/admin/registratin_amount.php', {
        operation: operation,
        json: JSON.stringify(payload)
    })
    .then(res => {
        Swal.close();
        if (res.data && res.data.status === 'success') {
            Swal.fire('Success', res.data.message, 'success');
            const modalEl = document.getElementById('addRegistrationAmountModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            document.body.classList.remove('modal-open');
            loadRegistrationAmounts();
        } else {
            Swal.fire('Error', res.data?.message || 'Failed to save', 'error');
        }
    })
    .catch(err => {
        console.error(err);
        Swal.fire('Error', 'Request failed', 'error');
    });
}

window.editRegistrationAmount = function(id) {
    if (!guardProgramPermission('edit_registration', 'You do not have permission to edit registration amounts.')) {
        return;
    }

    Swal.fire({ title: 'Loading...', didOpen: () => Swal.showLoading() });
    axios.post('../../api/admin/registratin_amount.php', {
        operation: 'getRegistrationAmount',
        json: JSON.stringify({ registration_id: id })
    })
    .then(res => {
        Swal.close();
        if (res.data && res.data.status === 'success') {
            setupEditRegistrationAmountModal(res.data.data);
        } else {
            Swal.fire('Error', res.data?.message || 'Unable to load details', 'error');
        }
    })
    .catch(err => {
        Swal.close();
        console.error(err);
        Swal.fire('Error', 'Failed to fetch details', 'error');
    });
};

// window.deleteRegistrationAmount = function(id) {
//     Swal.fire({
//         title: 'Are you sure?',
//         text: 'This registration amount will be removed.',
//         icon: 'warning',
//         showCancelButton: true,
//         confirmButtonColor: '#3085d6',
//         cancelButtonColor: '#d33',
//         confirmButtonText: 'Yes, delete it!'
//     }).then(result => {
//         if (!result.isConfirmed) return;
//         Swal.fire({ title: 'Deleting...', didOpen: () => Swal.showLoading() });

//         axios.post('../../api/admin/registratin_amount.php', {
//             operation: 'deleteRegistrationAmount',
//             json: JSON.stringify({ registration_id: id })
//         })
//         .then(res => {
//             Swal.close();
//             if (res.data && res.data.status === 'success') {
//                 Swal.fire('Deleted!', res.data.message, 'success');
//                 loadRegistrationAmounts();
//             } else {
//                 Swal.fire('Error', res.data?.message || 'Delete failed', 'error');
//             }
//         })
//         .catch(err => {
//             Swal.close();
//             console.error(err);
//             Swal.fire('Error', 'Request failed', 'error');
//         });
//     });
// };
