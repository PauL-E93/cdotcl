import { canUseSchedulePermission } from './schedule_rbac.js';
import { normalizeRbacRoleKey } from '../utilities/rbac_navigation.js';
import { initEmployeeScheduleModal, openEmployeeScheduleModal } from './employee_schedule_modal.js?v=20261013-theme-plus';

const fullName = employee => [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ');

export function initScheduleAddButton() {
    const button = document.getElementById('add-schedule-button');
    if (!button) return;
    let user;
    try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { return; }
    const role = normalizeRbacRoleKey(user?.role_name);
    const canManage = () => ['owner', 'secretary', 'teacher'].includes(role)
        && canUseSchedulePermission('view') && canUseSchedulePermission('create');
    button.classList.toggle('d-none', !canManage());
    button.disabled = !canManage();
    if (!canManage()) return;
    initEmployeeScheduleModal(canManage);
    button.addEventListener('click', async () => {
        if (!canManage()) return;
        if (role === 'teacher') {
            const id = Number(user.employee_id || user.user_id);
            if (!id) {
                Swal.fire('Unable to Open Schedule', 'Please sign in again to load your employee account.', 'error');
                return;
            }
            openEmployeeScheduleModal(id, fullName(user));
            return;
        }
        button.disabled = true;
        try {
            const response = await axios.get('../../api/admin/employee.php?operation=getEmployees');
            if (response.data.status !== 'success' || !Array.isArray(response.data.data)) {
                throw new Error(response.data.message || 'Unable to load employees.');
            }
            const employees = response.data.data;
            let selectedEmployee = null;
            const result = await Swal.fire({
                title: 'Select Employee',
                html: '<div class="schedule-picker-intro"><span class="schedule-picker-icon"><i class="bi bi-calendar2-plus" aria-hidden="true"></i></span>'
                    + '<div><span class="schedule-picker-eyebrow">WEEKLY SCHEDULE</span><p>Choose a team member to plan their weekly shifts.</p></div></div>'
                    + '<label for="schedule-employee-search" class="schedule-picker-label">Find a team member</label>'
                    + '<div class="schedule-picker-search"><i class="bi bi-search" aria-hidden="true"></i>'
                    + '<input id="schedule-employee-search" type="search" placeholder="Search name, role, or center…" autocomplete="off"></div>'
                    + '<div class="schedule-picker-list-heading"><span>Team members</span><span id="schedule-employee-count" aria-live="polite"></span></div>'
                    + '<div id="schedule-employee-list" class="schedule-picker-list" role="group" aria-label="Select an employee"></div>'
                    + '<div id="schedule-employee-empty" class="schedule-picker-empty" hidden><i class="bi bi-person-search" aria-hidden="true"></i>'
                    + '<strong>No team members found</strong><span>Try a different name, role, or center.</span></div>'
                    + '<div class="schedule-picker-selection"><i class="bi bi-info-circle" aria-hidden="true"></i>'
                    + '<span id="schedule-employee-selection" aria-live="polite">Select a team member to continue.</span></div>',
                width: 620,
                buttonsStyling: false,
                customClass: {
                    popup: 'schedule-picker-popup', title: 'schedule-picker-title',
                    htmlContainer: 'schedule-picker-body', actions: 'schedule-picker-actions',
                    confirmButton: 'schedule-picker-confirm', cancelButton: 'schedule-picker-cancel'
                },
                showCancelButton: true,
                showCloseButton: true,
                confirmButtonText: '<i class="bi bi-calendar2-plus" aria-hidden="true"></i> Add Schedule',
                cancelButtonText: 'Cancel',
                reverseButtons: true,
                focusConfirm: false,
                didOpen: () => {
                    const root = Swal.getPopup();
                    const search = root.querySelector('#schedule-employee-search');
                    const list = root.querySelector('#schedule-employee-list');
                    const render = () => {
                        const query = search.value.trim().toLowerCase();
                        list.replaceChildren();
                        const matches = employees.filter(employee => `${fullName(employee)} ${employee.role_name || ''} ${employee.branch_name || ''}`.toLowerCase().includes(query));
                        matches.forEach(employee => {
                                const card = document.createElement('label');
                                card.className = 'schedule-picker-card';
                                const radio = document.createElement('input');
                                radio.type = 'radio';
                                radio.name = 'schedule-employee';
                                radio.value = employee.employee_id;
                                radio.checked = selectedEmployee?.employee_id === employee.employee_id;
                                const avatar = document.createElement('span');
                                avatar.className = 'schedule-picker-avatar';
                                avatar.setAttribute('aria-hidden', 'true');
                                avatar.textContent = [employee.first_name, employee.last_name].filter(Boolean).map(name => name.trim().charAt(0)).join('').toUpperCase() || 'TM';
                                const copy = document.createElement('span');
                                copy.className = 'schedule-picker-card-copy';
                                const name = document.createElement('strong');
                                name.textContent = fullName(employee) || 'Employee';
                                const meta = document.createElement('span');
                                meta.className = 'schedule-picker-card-meta';
                                const role = document.createElement('span');
                                role.className = 'schedule-picker-role';
                                role.textContent = employee.role_name || 'Employee';
                                const center = document.createElement('span');
                                center.textContent = employee.branch_name || 'No center assigned';
                                meta.append(role, center);
                                copy.append(name, meta);
                                card.append(radio, avatar, copy);
                                radio.addEventListener('change', () => {
                                    selectedEmployee = employee;
                                    root.querySelector('#schedule-employee-selection').textContent = `${fullName(employee)} selected`;
                                    Swal.resetValidationMessage();
                                });
                                list.appendChild(card);
                            });
                        root.querySelector('#schedule-employee-count').textContent = `${matches.length} available`;
                        root.querySelector('#schedule-employee-empty').hidden = matches.length > 0;
                        list.hidden = matches.length === 0;
                    };
                    search.addEventListener('input', render);
                    render();
                    search.focus();
                },
                preConfirm: () => {
                    if (!selectedEmployee) {
                        Swal.showValidationMessage('Select an employee to add a schedule.');
                        return false;
                    }
                    return selectedEmployee;
                }
            });
            if (result.isConfirmed && canManage()) {
                openEmployeeScheduleModal(result.value.employee_id, fullName(result.value));
            }
        } catch (error) {
            console.error('Unable to open employee schedules:', error);
            Swal.fire('Unable to Load Employees', 'Please try again.', 'error');
        } finally {
            button.disabled = !canManage();
        }
    });
}
