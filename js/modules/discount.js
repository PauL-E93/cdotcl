// js/modules/discount.js
import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';

// 1. Load Discount Table
export function loadDiscounts() {
    if (!canUseProgramPermission('view_discounts')) return;
    const tableBody = document.getElementById('discount_table_body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';

    axios.get('../../api/admin/discount.php', { params: { operation: 'getDiscounts' } })
    .then(res => {
        if (res.data.status === 'success') {
            const discounts = res.data.data;
            tableBody.innerHTML = '';

            if (discounts.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center">No discounts found</td></tr>';
                return;
            }

            discounts.forEach(d => {
                const name = d.discount_name || d.name;
                const value = parseFloat(d.discount_value ?? d.price ?? d.percentage ?? 0);
                const type = (d.discount_type || d.type || 'percentage').toLowerCase();
                const status = (d.status || '').toLowerCase();

                const displayValue = type === 'percentage'
                    ? `${value.toFixed(2)}%`
                    : `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                const statusBadge = status === 'active'
                    ? '<span class="badge bg-success">Active</span>'
                    : status === 'inactive'
                        ? '<span class="badge bg-secondary">Inactive</span>'
                        : '<span class="badge bg-warning">Unknown</span>';

                const typeLabel = type === 'full_waiver' ? 'Full Waiver' : type.charAt(0).toUpperCase() + type.slice(1);

                const row = `
                    <tr>
                        <td class="fw-bold">${name}</td>
                        <td>${typeLabel}</td>
                        <td>${displayValue}</td>
                        <td>${statusBadge}</td>
                        <td>
                            ${canUseProgramPermission('edit_discounts')
                                ? `<button class="btn btn-sm btn-outline-primary me-1" onclick="window.editDiscount(${d.discount_id})">
                                    <i class="bi bi-pencil-square"></i>
                                </button>`
                                : '<span class="text-muted">-</span>'
                            }
                        </td>
                    </tr>
                `;
                tableBody.innerHTML += row;
            });
        }
    })
    .catch(err => console.error(err));
}

// ... (rest of the file is the same until the new delete function)

// 7. GLOBAL DELETE FUNCTION
// window.deleteDiscount = function(id) {
//     Swal.fire({
//         title: 'Are you sure?',
//         text: "You won't be able to revert this!",
//         icon: 'warning',
//         showCancelButton: true,
//         confirmButtonColor: '#3085d6',
//         cancelButtonColor: '#d33',
//         confirmButtonText: 'Yes, delete it!'
//     }).then((result) => {
//         if (result.isConfirmed) {
//             Swal.fire({ title: 'Deleting...', didOpen: () => Swal.showLoading() });

//             axios.post('../../api/admin/discount.php', {
//                 operation: 'deleteDiscount',
//                 json: JSON.stringify({ discount_id: id })
//             })
//             .then(res => {
//                 Swal.close();
//                 if (res.data.status === 'success') {
//                     Swal.fire('Deleted!', 'Your file has been deleted.', 'success');
//                     loadDiscounts();
//                 } else {
//                     Swal.fire('Error', res.data.message, 'error');
//                 }
//             })
//             .catch(err => {
//                 Swal.close();
//                 console.error(err);
//                 Swal.fire('Error', 'Request failed', 'error');
//             });
//         }
//     });
// };

// 2. SETUP ADD MODAL
export function setupAddDiscountModal() {
    if (!guardProgramPermission('create_discounts', 'You do not have permission to add discounts.')) {
        return;
    }

    const modalEl = document.getElementById('addDiscountModal');
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();

    document.getElementById('discountModalLabel').innerText = "Add New Discount";
    const formContainer = document.getElementById('discountForm');
    formContainer.innerHTML = getDiscountFormHTML(); 

    const footerContainer = document.getElementById('discountModalFooter');
    footerContainer.innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveDiscount">Save Discount</button>
    `;
    
    document.getElementById('btnSaveDiscount').addEventListener('click', () => submitDiscountData('addDiscount'));
}

// 3. SETUP EDIT MODAL
function setupEditDiscountModal(data) {
    const modalEl = document.getElementById('addDiscountModal');
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();

    document.getElementById('discountModalLabel').innerText = "Edit Discount";
    
    // Map DB data to Form
    const formData = {
        name: data.discount_name,
        value: data.discount_value ?? data.price ?? data.percentage,
        type: data.discount_type || 'percentage',
        status: data.status || 'active'
    };

    const formContainer = document.getElementById('discountForm');
    formContainer.innerHTML = getDiscountFormHTML(formData); 

    const footerContainer = document.getElementById('discountModalFooter');
    footerContainer.innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateDiscount">Update Changes</button>
    `;

    document.getElementById('btnUpdateDiscount').addEventListener('click', () => submitDiscountData('updateDiscount', data.discount_id));
}

// 4. HELPER: FORM HTML
function getDiscountFormHTML(data = {}) {
    const name = data.name || '';
    const value = data.value ?? '';
    const type = data.type || 'percentage';
    const status = data.status || 'active';

    return `
        <div class="row">
            <div class="col-md-12 mb-3">
                <label class="form-label">Discount Name <span class="text-danger">*</span></label>
                <input type="text" id="disc_name" class="form-control" value="${name}" required>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Discount Type <span class="text-danger">*</span></label>
                <select id="disc_type" class="form-select" required>
                    <option value="percentage" ${type === 'percentage' ? 'selected' : ''}>Percentage</option>
                    <option value="fixed" ${type === 'fixed' ? 'selected' : ''}>Fixed Amount</option>
                    <option value="full_waiver" ${type === 'full_waiver' ? 'selected' : ''}>Full Waiver</option>
                </select>
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Value <span class="text-danger">*</span></label>
                <input type="number" id="disc_value" class="form-control" value="${value}" placeholder="0.00" step="0.01" required>
            </div>
            <div class="col-md-12 mb-3">
                <label class="form-label">Status <span class="text-danger">*</span></label>
                <select id="disc_status" class="form-select" required>
                    <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
            </div>
        </div>
    `;
}

// 5. SUBMIT LOGIC
function submitDiscountData(operation, id = null) {
    const name = document.getElementById('disc_name').value.trim();
    const value = document.getElementById('disc_value').value;
    const type = document.getElementById('disc_type').value;
    const status = document.getElementById('disc_status').value;

    if (!name || value === '' || value === null || !type || !status) {
        Swal.fire('Error', 'Please fill in required fields', 'warning');
        return;
    }

    const payload = {
        name: name,
        discount_value: value,
        discount_type: type,
        status: status
    };

    if (id) payload.discount_id = id;

    Swal.fire({ title: 'Processing...', didOpen: () => Swal.showLoading() });

    axios.post('../../api/admin/discount.php', {
        operation: operation,
        json: JSON.stringify(payload)
    })
    .then(res => {
        Swal.close();
        if (res.data.status === 'success') {
            Swal.fire('Success', res.data.message, 'success');
            
            const modalEl = document.getElementById('addDiscountModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
            
            const backdrops = document.querySelectorAll('.modal-backdrop');
            backdrops.forEach(backdrop => backdrop.remove());
            document.body.classList.remove('modal-open');

            loadDiscounts(); 
        } else {
            Swal.fire('Error', res.data.message, 'error');
        }
    })
    .catch(err => {
        console.error(err);
        Swal.fire('Error', 'Request failed', 'error');
    });
}

// 6. GLOBAL EDIT FUNCTION
window.editDiscount = function(id) {
    if (!guardProgramPermission('edit_discounts', 'You do not have permission to edit discounts.')) {
        return;
    }

    Swal.fire({ title: 'Loading...', didOpen: () => Swal.showLoading() });

    axios.post('../../api/admin/discount.php', { 
        operation: 'getDiscount', 
        json: JSON.stringify({ discount_id: id }) 
    })
    .then(res => {
        Swal.close();
        if (res.data.status === 'success') {
            setupEditDiscountModal(res.data.data);
        } else {
            Swal.fire('Error', res.data.message, 'error');
        }
    })
    .catch(err => {
        Swal.close();
        console.error(err);
        Swal.fire('Error', 'Failed to fetch details', 'error');
    });
};
