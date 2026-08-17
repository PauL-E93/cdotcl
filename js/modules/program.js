// js/modules/program.js
import { applyProgramPagePermissions, canUseProgramPermission, guardProgramPermission, initProgramPermissions } from './program_rbac.js';

let cachedProgramTypes = [];
let cachedDiscounts = [];
let cachedServices = [];
const programFilters = {
    search: '',
    status: '',
    type: ''
};

// NEW: Load types once so we can use them in the dropdown
async function fetchProgramTypes() {
    try {
        const res = await axios.get('../../api/admin/program.php', { params: { operation: 'getProgramTypes' } });
        if (res.data.status === 'success') cachedProgramTypes = res.data.data;
    } catch (err) { console.error("Error fetching types", err); }
}

async function fetchDiscounts() {
    try {
        const res = await axios.get('../../api/admin/discount.php', { params: { operation: 'getDiscounts' } });
        if (res.data.status === 'success') cachedDiscounts = res.data.data;
    } catch (err) {
        console.error("Error fetching discounts", err);
        cachedDiscounts = [];
    }
}

async function fetchServices() {
    try {
        const res = await axios.get('../../api/admin/services.php', { params: { operation: 'getServices' } });
        if (res.data.status === 'success') cachedServices = res.data.data;
    } catch (err) {
        console.error("Error fetching services", err);
        cachedServices = [];
    }
}

export function refreshProgramTypes() {
    fetchProgramTypes();
}

export function loadProgramStats() {
    if (!canUseProgramPermission('view_programs')) return;
    axios.get('../../api/admin/program.php', { params: { operation: 'getPrograms' } })
    .then(res => {
        if (res.data.status === 'success') {
            const programs = res.data.data;
            document.getElementById('total_programs').innerText = programs.length;
            document.getElementById('active_programs').innerText = programs.filter(p => p.status === 'active').length;
            document.getElementById('inactive_programs').innerText = programs.filter(p => p.status === 'inactive').length;
        }
    });
}

export function loadPrograms(searchQuery = null) {
    if (!canUseProgramPermission('view_programs')) return;
    const tableBody = document.getElementById('program_table_body');
    if (!tableBody) return;
    if (searchQuery !== null) programFilters.search = String(searchQuery).trim().toLowerCase();
    tableBody.innerHTML = '<tr><td colspan="11" class="text-center">Loading...</td></tr>';

    axios.get('../../api/admin/program.php', { params: { operation: 'getPrograms' } })
    .then(res => {
        if (res.data.status === 'success') {
            let programs = res.data.data || [];
            populateProgramListFilters(programs);
            programs = applyProgramListFilters(programs);

            tableBody.innerHTML = '';
            if (!programs.length) {
                tableBody.innerHTML = '<tr><td colspan="11" class="text-center text-muted">No programs match the selected filters.</td></tr>';
                return;
            }
            programs.forEach(p => {
                let badge = p.status === 'active' ? 'bg-success' : 'bg-danger';
                const editButton = canUseProgramPermission('edit')
                    ? `<button class="btn btn-sm btn-outline-primary" onclick="window.editProgram(${p.program_id})"><i class="bi bi-pencil"></i></button>`
                    : '<span class="text-muted">-</span>';
                tableBody.innerHTML += `
                    <tr>
                        <td class="fw-bold">${p.name}</td>
                        <td><small>${p.discription || 'N/A'}</small></td>
                        <td>₱${parseFloat(p.tuition).toLocaleString()}</td>
                        <td>${p.total_units} <small class="text-muted text-uppercase">${p.unit_type}</small></td>
                        <td><span class="badge bg-info text-dark">${p.type_name || 'No Type'}</span></td>
                        <td>₱${parseFloat(p.registration_fee || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td>
                            <div>₱${parseFloat(p.penalty_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / day</div>
                            <small class="text-muted">Starts after ${Number(p.grace_period_days || 0)} day(s)</small>
                        </td>
                        <td>${p.default_discount_name || 'None'}</td>
                        <td>${p.default_service_name || 'None'}</td>
                        <td><span class="badge ${badge}">${p.status}</span></td>
                        <td>
                            ${editButton}
                        </td>
                    </tr>`;
            });
        }
    });
}

function populateProgramListFilters(programs) {
    const statusSelect = document.getElementById('program-status-filter');
    const typeSelect = document.getElementById('program-type-filter');
    setProgramListFilterOptions(statusSelect, programs.map(program => program.status), 'All Status');
    setProgramListFilterOptions(typeSelect, programs.map(program => program.type_name || 'No Type'), 'All Program Types');
}

function setProgramListFilterOptions(select, values, placeholder) {
    if (!select) return;
    const currentValue = select.value;
    const options = [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    select.innerHTML = [`<option value="">${placeholder}</option>`, ...options.map(value => `<option value="${escapeProgramFilterValue(value)}">${escapeProgramFilterValue(value)}</option>`)].join('');
    if (options.some(value => String(value) === currentValue)) select.value = currentValue;
}

function applyProgramListFilters(programs) {
    return programs.filter(program => {
        const searchableText = [program.name, program.discription, program.type_name, program.status].filter(Boolean).join(' ').toLowerCase();
        const matchesSearch = !programFilters.search || searchableText.includes(programFilters.search);
        const matchesStatus = !programFilters.status || String(program.status || '').toLowerCase() === programFilters.status.toLowerCase();
        const matchesType = !programFilters.type || String(program.type_name || 'No Type').toLowerCase() === programFilters.type.toLowerCase();
        return matchesSearch && matchesStatus && matchesType;
    });
}

function escapeProgramFilterValue(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function setupProgramFilterControls() {
    const statusSelect = document.getElementById('program-status-filter');
    const typeSelect = document.getElementById('program-type-filter');
    const filterToggle = document.querySelector('.filter-toggle-btn');
    const filterContainer = document.querySelector('.filter-container');

    statusSelect?.addEventListener('change', () => {
        programFilters.status = statusSelect.value;
        loadPrograms();
    });
    typeSelect?.addEventListener('change', () => {
        programFilters.type = typeSelect.value;
        loadPrograms();
    });
    filterToggle?.addEventListener('click', () => filterContainer?.classList.toggle('filter-open'));
}

export async function setupAddProgramModal() {
    if (!guardProgramPermission('create', 'You do not have permission to add program records.')) {
        return;
    }

    if (cachedProgramTypes.length === 0) await fetchProgramTypes();
    if (cachedDiscounts.length === 0) await fetchDiscounts();
    if (cachedServices.length === 0) await fetchServices();
    document.getElementById('dynamicModalLabel').innerText = "Add New Program";
    document.getElementById('dynamicForm').innerHTML = getFormHTML();
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-primary" id="btnSaveProgram">Save Program</button>`;
    document.getElementById('btnSaveProgram').onclick = () => submitProgramData('addProgram');
    const modal = new bootstrap.Modal(document.getElementById('addProgramModal'));
    modal.show();
}

async function setupEditProgramModal(data) {
    if (cachedProgramTypes.length === 0) await fetchProgramTypes();
    if (cachedDiscounts.length === 0) await fetchDiscounts();
    if (cachedServices.length === 0) await fetchServices();

    // Fetch associated products for view
    const ProgramProducts = await import('./program_products.js');
    const [programProducts, allProducts] = await Promise.all([
        ProgramProducts.ProgramProductsModule.getProgramProductsForProgram(data.program_id),
        ProgramProducts.ProgramProductsModule.getProducts()
    ]);
    const productViewHTML = ProgramProducts.createProductViewList(programProducts, allProducts);

    const modal = new bootstrap.Modal(document.getElementById('addProgramModal'));
    modal.show();
    document.getElementById('dynamicModalLabel').innerText = "Edit Program";
    document.getElementById('dynamicForm').innerHTML = getFormHTML(data) + productViewHTML; 
    document.getElementById('dynamicModalFooter').innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success" id="btnUpdateProgram">Update</button>`;
    document.getElementById('btnUpdateProgram').onclick = () => submitProgramData('updateProgram', data.program_id);
}

function getFormHTML(data = {}) {
    // Dynamically build the Type dropdown from cached data
    let typeOptions = cachedProgramTypes.map(t => 
        `<option value="${t.program_type_id}" ${data.program_type == t.program_type_id ? 'selected' : ''}>${t.type}</option>`
    ).join('');

    return `
        <div class="row">
            <div class="col-md-12 mb-3"><label class="form-label">Program Name <span class="text-danger" aria-hidden="true">*</span></label><input type="text" id="prog_name" class="form-control" value="${data.name || ''}" required></div>
            <div class="col-md-12 mb-3"><label class="form-label">Description</label><textarea id="prog_desc" class="form-control">${data.discription || ''}</textarea></div>
            <div class="col-md-4 mb-3"><label class="form-label">Tuition <span class="text-danger" aria-hidden="true">*</span></label><input type="number" id="prog_tuition" class="form-control" value="${data.tuition || ''}" required></div>
            <div class="col-md-4 mb-3"><label class="form-label">Unit Count <span class="text-danger" aria-hidden="true">*</span></label><input type="number" id="prog_units" class="form-control" value="${data.total_units || 1}" required></div>
            <div class="col-md-4 mb-3"><label class="form-label">Unit Type <span class="text-danger" aria-hidden="true">*</span></label>
                <select id="prog_unit_type" class="form-select" required>
                    <option value="session" ${data.unit_type === 'session' ? 'selected' : ''}>Session</option>
                    <option value="month" ${data.unit_type === 'month' ? 'selected' : ''}>Month</option>
                    <option value="year" ${data.unit_type === 'year' ? 'selected' : ''}>Year</option>
                </select>
            </div>
            <div class="col-md-6 mb-3"><label class="form-label">Type <span class="text-danger" aria-hidden="true">*</span></label><select id="prog_type" class="form-select" required>${typeOptions}</select></div>
            <div class="col-md-6 mb-3"><label class="form-label">Status <span class="text-danger" aria-hidden="true">*</span></label>
                <select id="prog_status" class="form-select" required>
                    <option value="active" ${data.status === 'active' ? 'selected' : ''}>Active</option>
                    <option value="inactive" ${data.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
            </div>
            <div class="col-md-6 mb-3"><label class="form-label">Registration Fee</label><input type="number" id="prog_registration_fee" class="form-control" value="${data.registration_fee || ''}" step="0.01" min="0" placeholder="e.g., 500.00"></div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Penalty Amount Per Day</label>
                <input type="number" id="prog_penalty" class="form-control" value="${data.penalty_amount ?? data.penalty ?? 0}" step="0.01" min="0" placeholder="e.g., 100.00">
            </div>
            <div class="col-md-6 mb-3">
                <label class="form-label">Apply Penalty After (Days)</label>
                <input type="number" id="prog_penalty_days" class="form-control" value="${data.grace_period_days ?? 2}" step="1" min="0" required>
                <div class="form-text">The due date is followed by this many grace days; the penalty starts the next day.</div>
            </div>
            <div class="col-md-6 mb-3"><label class="form-label">Default Discount</label><select id="prog_default_discount" class="form-select">${getDiscountOptions(data)}</select></div>
            <div class="col-md-6 mb-3"><label class="form-label">Default Service</label><select id="prog_service" class="form-select">${getServiceOptions(data)}</select></div>
            <div class="col-md-6 mb-3"><label class="form-label">Default Downpayment Amount</label><input type="number" id="prog_downpayment" class="form-control" value="${data.downpayment || ''}" step="0.01" min="0" placeholder="e.g., 1000"></div>
        </div>`;
}

function getDiscountOptions(data = {}) {
    const selected = data.default_discount_id || '';
    const options = [`
        <option value="">None</option>
        ${cachedDiscounts.map(d => `
            <option value="${d.discount_id}" ${String(d.discount_id) === String(selected) ? 'selected' : ''}>${d.discount_name}</option>
        `).join('')}
    `];
    return options.join('');
}

function getServiceOptions(data = {}) {
    const selected = data.service_id || '';
    const options = [`
        <option value="">None</option>
        ${cachedServices.map(s => `
            <option value="${s.service_id}" ${String(s.service_id) === String(selected) ? 'selected' : ''}>${s.service_name}</option>
        `).join('')}
    `];
    return options.join('');
}

function submitProgramData(operation, id = null) {
    const payload = {
        name: document.getElementById('prog_name').value,
        discription: document.getElementById('prog_desc').value,
        tuition: document.getElementById('prog_tuition').value,
        total_units: document.getElementById('prog_units').value,
        unit_type: document.getElementById('prog_unit_type').value,
        program_type: document.getElementById('prog_type').value,
        status: document.getElementById('prog_status').value,
        registration_fee: document.getElementById('prog_registration_fee').value || 0.00,
        penalty_amount: document.getElementById('prog_penalty').value || 0,
        grace_period_days: document.getElementById('prog_penalty_days').value,
        default_discount_id: document.getElementById('prog_default_discount').value || null,
        service_id: document.getElementById('prog_service').value || null,
        downpayment: document.getElementById('prog_downpayment').value || null
    };
    if (id) payload.program_id = id;

    if (!payload.name || !payload.tuition || !payload.total_units || !payload.unit_type || !payload.program_type || !payload.status) {
        Swal.fire('Error', 'Please fill in all required program fields.', 'warning');
        return;
    }

    if (!/^\d+$/.test(payload.grace_period_days) || Number(payload.grace_period_days) < 0) {
        Swal.fire('Error', 'Penalty delay must be a non-negative whole number of days.', 'warning');
        return;
    }

    axios.post('../../api/admin/program.php', { operation, json: JSON.stringify(payload) })
    .then(res => {
        if (res.data.status === 'success') {
            bootstrap.Modal.getInstance(document.getElementById('addProgramModal')).hide();
            loadPrograms();
            loadProgramStats();
        }
    });
}

export async function initProgramPage() {
    await initProgramPermissions();
    const access = applyProgramPagePermissions();
    if (!access.allowed) {
        return;
    }

    if (canUseProgramPermission('view_programs') || canUseProgramPermission('create') || canUseProgramPermission('edit')) {
        fetchProgramTypes();
        fetchDiscounts();
        fetchServices();
    }
    if (canUseProgramPermission('view_programs')) {
        setupProgramFilterControls();
        loadPrograms();
        loadProgramStats();
    }

    const searchInput = document.getElementById('search-input');
    if (canUseProgramPermission('view_programs') && searchInput && !searchInput.dataset.programSearchBound) {
        searchInput.dataset.programSearchBound = 'true';
        searchInput.addEventListener('input', event => {
            loadPrograms(event.target.value.trim());
        });
    }
}

window.editProgram = (id) => {
    if (!guardProgramPermission('edit', 'You do not have permission to update program records.')) {
        return;
    }

    axios.get('../../api/admin/program.php', {
        params: {
            operation: 'getProgram',
            json: JSON.stringify({ program_id: id })
        }
    }).then(res => setupEditProgramModal(res.data.data));
};
