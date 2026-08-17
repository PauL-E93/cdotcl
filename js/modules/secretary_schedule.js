import OwnerCalendarModule from './owner_schedule.js?v=20260814-all-schedule-details';

const SECRETARY_SCHEDULE_ENDPOINT = '../../api/admin/secetary_schedule.php';
const ALL_BRANCHES = 'all';

export default class SecretaryCalendarModule extends OwnerCalendarModule {
    constructor(containerId) {
        super(containerId);
        this.notificationSenderType = 'secretary';
    }

    init() {
        super.init();
        const headerLabel = this.container?.querySelector('.notif-header span');
        if (headerLabel) headerLabel.textContent = 'SECRETARY SCHEDULE LOG';
    }

    bindPageFilters() {
        const branchSelect = document.getElementById('secretary-schedule-branch-filter');
        const statusSelect = document.getElementById('secretary-schedule-status-filter');
        const searchInput = document.getElementById('search-input');
        const applyButton = document.querySelector('.apply-filters-btn');
        const filterToggle = document.querySelector('.filter-toggle-btn');
        const filterContainer = document.querySelector('.filter-container');

        branchSelect?.addEventListener('change', () => {
            this.filters.branch = branchSelect.value || ALL_BRANCHES;
            this.renderCalendar();
        });

        statusSelect?.addEventListener('change', () => {
            this.filters.status = statusSelect.value || ALL_BRANCHES;
            this.renderCalendar();
        });

        if (searchInput) {
            let searchTimer = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    this.filters.search = searchInput.value.trim().toLowerCase();
                    this.renderCalendar();
                }, 200);
            });
        }

        applyButton?.addEventListener('click', () => {
            this.filters.branch = branchSelect?.value || ALL_BRANCHES;
            this.filters.status = statusSelect?.value || ALL_BRANCHES;
            this.filters.search = searchInput?.value.trim().toLowerCase() || '';
            this.renderCalendar();
        });

        filterToggle?.addEventListener('click', () => {
            filterContainer?.classList.toggle('filter-open');
        });
    }

    async loadOwnerSchedules() {
        try {
            const response = await axios.get(`${SECRETARY_SCHEDULE_ENDPOINT}?operation=getSchedules`);
            const data = response.data;
            const rawSchedules = data && Array.isArray(data.schedules)
                ? data.schedules
                : (Array.isArray(data) ? data : []);

            this.schedules = rawSchedules.map(schedule => this.normalizeScheduleRow(schedule));
            this.branches = Array.isArray(data?.branches)
                ? data.branches
                : this.extractBranches(this.schedules);

            this.populateBranchFilter();
            this.visibleSchedules = this.applyFilters(this.schedules);
        } catch (error) {
            console.error('Failed to load secretary schedules:', error);
            this.schedules = [];
            this.visibleSchedules = [];
            this.branches = [];
        }
    }

    populateBranchFilter() {
        const select = document.getElementById('secretary-schedule-branch-filter');
        if (!select) return;

        const currentValue = select.value || this.filters.branch || ALL_BRANCHES;
        const options = [
            '<option value="all">All Centers</option>',
            ...this.branches.map(branch => {
                const id = this.escapeHtml(branch.branch_id);
                const name = this.escapeHtml(branch.branch_name || 'Unnamed Center');
                return `<option value="${id}">${name}</option>`;
            })
        ];

        select.innerHTML = options.join('');
        const hasCurrent = Array.from(select.options).some(option => option.value === currentValue);
        select.value = hasCurrent ? currentValue : ALL_BRANCHES;
        this.filters.branch = select.value || ALL_BRANCHES;
    }

    async updateScheduleStatus(preferenceId, enrollmentDetailsId, scheduleDate, newStatus) {
        const payload = {
            operation: 'updateScheduleStatus',
            preference_id: preferenceId,
            enrollment_details_id: enrollmentDetailsId,
            schedule_date: scheduleDate,
            new_status: newStatus
        };

        try {
            const response = await axios.post(SECRETARY_SCHEDULE_ENDPOINT, payload);

            if (response.data.status === 'success') {
                Swal.fire({
                    icon: 'success',
                    title: 'Status Updated',
                    text: `Schedule status changed to ${newStatus}.`,
                    timer: 2000,
                    timerProgressBar: true
                }).then(() => {
                    this.renderCalendar();
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: response.data.message || 'Failed to update schedule status'
                });
            }
        } catch (error) {
            console.error('Error updating secretary schedule status:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.response?.data?.message || 'Network error occurred'
            });
        }
    }
}
