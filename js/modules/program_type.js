// js/modules/program_type.js

import { refreshProgramTypes } from './program.js';
import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';

// Function to load program types into the table
export function loadProgramTypes() {
    if (!canUseProgramPermission('view_types')) return;
    const tableBody = document.getElementById('program_type_table_body');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="2" class="text-center">Loading...</td></tr>';

    axios.get('../../api/admin/progra_type.php', { params: { operation: 'getTypes' } })
    .then(res => {
        if (res.data.status === 'success') {
            let types = res.data.data || [];
            tableBody.innerHTML = '';
            types.forEach(type => {
                const actionButton = canUseProgramPermission('edit_types')
                    ? `<button class="btn btn-sm btn-outline-primary" onclick="window.editProgramType(${type.program_type_id})"><i class="bi bi-pencil"></i></button>`
                    : '<span class="text-muted">-</span>';
                tableBody.innerHTML += `
                    <tr>    
                        <td class="fw-bold">${type.type}</td>
                        <td>
                            ${actionButton}
                        </td>
                    </tr>`;
            });
        }
    })
    .catch(err => {
        console.error('Error loading program types:', err);
        tableBody.innerHTML = '<tr><td colspan="2" class="text-center text-danger">Error loading data</td></tr>';
    });
}

// Function to set up the add program type modal
export function setupAddProgramTypeModal() {
    if (!guardProgramPermission('create_types', 'You do not have permission to add program types.')) {
        return;
    }

    // Set modal title
    document.getElementById('dynamicModalLabel').innerText = "Add New Program Type";

    // Create form HTML
    document.getElementById('dynamicForm').innerHTML = `
        <div class="mb-3">
            <label for="program_type_name" class="form-label">Program Type Name <span class="text-danger" aria-hidden="true">*</span></label>
            <input type="text" class="form-control" id="program_type_name" placeholder="Enter program type name" required>
        </div>
    `;

    // Set modal footer
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveProgramType">Save Program Type</button>
    `;

    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('addProgramModal'));
    modal.show();

    // Add event listener to save button
    document.getElementById('btnSaveProgramType').onclick = () => submitProgramType();
}

// Function to set up the edit program type modal
function setupEditProgramTypeModal(data) {
    // Set modal title
    document.getElementById('dynamicModalLabel').innerText = "Edit Program Type";

    // Create form HTML
    document.getElementById('dynamicForm').innerHTML = `
        <div class="mb-3">
            <label for="edit_program_type_name" class="form-label">Program Type Name <span class="text-danger" aria-hidden="true">*</span></label>
            <input type="text" class="form-control" id="edit_program_type_name" value="${data.type}" placeholder="Enter program type name" required>
        </div>
    `;

    // Set modal footer
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateProgramType">Update Program Type</button>
    `;

    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('addProgramModal'));
    modal.show();

    // Add event listener to update button
    document.getElementById('btnUpdateProgramType').onclick = () => submitEditProgramType(data.program_type_id);
}

// Function to submit the program type data
function submitProgramType() {
    const typeName = document.getElementById('program_type_name').value.trim();

    if (!typeName) {
        Swal.fire({
            icon: 'warning',
            title: 'Required Field',
            text: 'Please enter a program type name.',
        });
        return;
    }

    const payload = { type: typeName };

    axios.post('../../api/admin/progra_type.php', { operation: 'addType', json: JSON.stringify(payload) })
    .then(res => {
        if (res.data.status === 'success') {
            // Hide modal
            bootstrap.Modal.getInstance(document.getElementById('addProgramModal')).hide();
            // Refresh program types cache and table
            refreshProgramTypes();
            loadProgramTypes();
            Swal.fire({
                icon: 'success',
                title: 'Success',
                text: 'Program type added successfully!',
                timer: 2000,
                showConfirmButton: false
            });
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: res.data.message,
            });
        }
    })
    .catch(err => {
        console.error('Error adding program type:', err);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'An error occurred while adding the program type.',
        });
    });
}

// Function to submit the edit program type data
function submitEditProgramType(id) {
    const typeName = document.getElementById('edit_program_type_name').value.trim();

    if (!typeName) {
        Swal.fire({
            icon: 'warning',
            title: 'Required Field',
            text: 'Please enter a program type name.',
        });
        return;
    }

    const payload = { program_type_id: id, type: typeName };

    axios.post('../../api/admin/progra_type.php', { operation: 'updateType', json: JSON.stringify(payload) })
    .then(res => {
        if (res.data.status === 'success') {
            // Hide modal
            bootstrap.Modal.getInstance(document.getElementById('addProgramModal')).hide();
            // Refresh program types cache and table
            refreshProgramTypes();
            loadProgramTypes();
            Swal.fire({
                icon: 'success',
                title: 'Success',
                text: 'Program type updated successfully!',
                timer: 2000,
                showConfirmButton: false
            });
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: res.data.message,
            });
        }
    })
    .catch(err => {
        console.error('Error updating program type:', err);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'An error occurred while updating the program type.',
        });
    });
}

// Global function for editing program type
window.editProgramType = (id) => {
    if (!guardProgramPermission('edit_types', 'You do not have permission to edit program types.')) {
        return;
    }

    axios.get('../../api/admin/progra_type.php', { params: { operation: 'getTypes' } })
    .then(res => {
        if (res.data.status === 'success') {
            const type = res.data.data.find(t => t.program_type_id == id);
            if (type) setupEditProgramTypeModal(type);
        }
    })
    .catch(err => console.error('Error fetching program type for edit:', err));
};
