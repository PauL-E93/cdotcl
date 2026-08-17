import { openRescheduleModal } from '../studentmodule/reschedule.js';
import { canUseSchedulePermission } from './schedule_rbac.js';
import {
    getManagerScheduleModalActions,
    openScheduleDetailsModal
} from '../utilities/schedule_details_modal.js';

const OWNER_SCHEDULE_ENDPOINT = '../../api/admin/owner_schedule.php';
const SEND_NOTIFICATION_ENDPOINT = '../../api/send_schedule_notification.php';
const ALL_BRANCHES = 'all';

export default class OwnerCalendarModule {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.date = new Date();
        this.currYear = this.date.getFullYear();
        this.currMonth = this.date.getMonth();
        this.schedules = [];
        this.visibleSchedules = [];
        this.branches = [];
        this.selectedDate = this.formatDateKey(this.date);
        this.filters = {
            branch: ALL_BRANCHES,
            status: ALL_BRANCHES,
            search: ''
        };

        this.months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];

        this.bindPageFilters();
        this.init();
    }

    init() {
        this.container.innerHTML = `
            <div class="calendar-wrapper">
                <header class="calendar-header">
                    <button class="nav-btn" id="prev-month" type="button">&#10094;</button>
                    <h2 id="current-date"></h2>
                    <button class="nav-btn" id="next-month" type="button">&#10095;</button>
                </header>
                <div class="calendar-body">
                    <div class="calendar-grid" id="calendar-grid"></div>
                </div>
            </div>

            <div class="notification-wrapper">
                <div class="notif-header owner-schedule-log-header">
                    <span>OWNER SCHEDULE LOG</span>
                    <button type="button" id="owner-notify-all" class="owner-notify-all-btn" title="Email everyone in this schedule log" aria-label="Email everyone in this schedule log">
                        <i class="bi bi-envelope"></i>
                    </button>
                </div>
                <div id="notif-content" style="padding:20px; color:#777; font-size:0.9rem;">
                    <p>No schedules for this month.</p>
                </div>
            </div>
        `;

        this.container.querySelector('#prev-month').addEventListener('click', () => {
            this.currMonth--;
            this.checkDateBounds();
            this.renderCalendar();
        });

        this.container.querySelector('#next-month').addEventListener('click', () => {
            this.currMonth++;
            this.checkDateBounds();
            this.renderCalendar();
        });

        this.container.querySelector('#owner-notify-all').addEventListener('click', () => {
            this.sendAllScheduleNotifications();
        });

        this.renderCalendar();
    }

    bindPageFilters() {
        const branchSelect = document.getElementById('owner-schedule-branch-filter');
        const statusSelect = document.getElementById('owner-schedule-status-filter');
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

    checkDateBounds() {
        if (this.currMonth < 0) {
            this.currMonth = 11;
            this.currYear--;
        } else if (this.currMonth > 11) {
            this.currMonth = 0;
            this.currYear++;
        }
    }

    async loadOwnerSchedules() {
        try {
            const response = await axios.get(`${OWNER_SCHEDULE_ENDPOINT}?operation=getSchedules`);
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
            this.updateScheduleSummary();
        } catch (error) {
            console.error('Failed to load owner schedules:', error);
            this.schedules = [];
            this.visibleSchedules = [];
            this.branches = [];
            this.updateScheduleSummary();
        }
    }

    updateScheduleSummary() {
        const totalSchedules = document.getElementById('owner-total-schedules');
        const pendingSchedules = document.getElementById('owner-pending-schedules');
        const ongoingSchedules = document.getElementById('owner-ongoing-schedules');
        const doneSchedules = document.getElementById('owner-done-schedules');
        const resultsBadge = document.getElementById('owner-schedule-results-badge');

        const rows = Array.isArray(this.visibleSchedules) ? this.visibleSchedules : [];
        const statusCounts = rows.reduce((counts, schedule) => {
            const status = this.normalizeStatus(schedule.status);
            counts[status] = (counts[status] || 0) + 1;
            return counts;
        }, {});

        if (totalSchedules) totalSchedules.textContent = String(rows.length);
        if (pendingSchedules) pendingSchedules.textContent = String(statusCounts.pending || 0);
        if (ongoingSchedules) ongoingSchedules.textContent = String(statusCounts.ongoing || 0);
        if (doneSchedules) doneSchedules.textContent = String(statusCounts.done || 0);
        if (resultsBadge) {
            const label = rows.length === 1 ? 'matched schedule' : 'matched schedules';
            resultsBadge.textContent = `${rows.length} ${label}`;
        }
    }

    normalizeScheduleRow(row) {
        return {
            preference_id: Number(row.preference_id || 0),
            enrollment_details_id: Number(row.enrollment_details_id || 0),
            date: row.date || row.schedule_date || '',
            day: row.day || row.day_name || '',
            time: row.time || row.start_time || row.startTime || '',
            endTime: row.endTime || row.end_time || '',
            program: row.program || row.program_name || '',
            subject: row.subject || row.subject_name || '',
            student: row.student || row.student_name || '',
            teacher: row.teacher || row.teacher_name || '',
            preferred_teacher: row.preferred_teacher || row.teacher_id || '',
            branch_id: row.branch_id === null || row.branch_id === undefined ? '' : String(row.branch_id),
            branch: row.branch || row.branch_name || 'Unassigned Center',
            branch_location: row.branch_location || '',
            status: row.status || 'pending',
            isNotified: this.toBoolean(row.isNotified ?? row.is_notified)
        };
    }

    extractBranches(schedules) {
        const branchMap = new Map();
        schedules.forEach(schedule => {
            if (!schedule.branch_id || branchMap.has(schedule.branch_id)) return;
            branchMap.set(schedule.branch_id, {
                branch_id: schedule.branch_id,
                branch_name: schedule.branch,
                branch_location: schedule.branch_location
            });
        });

        return Array.from(branchMap.values()).sort((a, b) => String(a.branch_name).localeCompare(String(b.branch_name)));
    }

    populateBranchFilter() {
        const select = document.getElementById('owner-schedule-branch-filter');
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

    applyFilters(rows) {
        const branch = this.filters.branch || ALL_BRANCHES;
        const status = this.filters.status || ALL_BRANCHES;
        const search = this.filters.search || '';

        return rows.filter(schedule => {
            const matchesBranch = branch === ALL_BRANCHES || schedule.branch_id === branch;
            const matchesStatus = status === ALL_BRANCHES || this.normalizeStatus(schedule.status) === status;
            const searchableText = [
                schedule.date,
                schedule.day,
                schedule.time,
                schedule.endTime,
                schedule.program,
                schedule.subject,
                schedule.student,
                schedule.teacher,
                schedule.branch,
                schedule.status
            ].join(' ').toLowerCase();
            const matchesSearch = !search || searchableText.includes(search);

            return matchesBranch && matchesStatus && matchesSearch;
        });
    }

    markScheduleDays() {
        const days = this.container.querySelectorAll('.calendar-day:not(.empty)');

        days.forEach(dayElement => {
            const formattedDate = dayElement.dataset.date;
            if (!formattedDate) return;

            const daySchedules = this.getSchedulesForDate(formattedDate);

            if (daySchedules.length > 0) {
                dayElement.classList.add('has-schedule');
                dayElement.title = daySchedules.map(schedule => {
                    return `${schedule.branch || 'Center'} | ${schedule.subject || 'Scheduled'} | ${schedule.student || 'TBA'} | ${schedule.teacher || 'TBA'}`;
                }).join('\n');
            }
        });
    }

    async renderCalendar() {
        await this.loadOwnerSchedules();

        const firstDayOfMonth = new Date(this.currYear, this.currMonth, 1).getDay();
        const lastDateOfMonth = new Date(this.currYear, this.currMonth + 1, 0).getDate();
        const lastDateOfLastMonth = new Date(this.currYear, this.currMonth, 0).getDate();

        let gridHTML = "";
        const dayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        dayHeaders.forEach(day => gridHTML += `<div class="day-name" style="font-weight:bold; text-align:center;">${day}</div>`);

        for (let i = firstDayOfMonth; i > 0; i--) {
            gridHTML += `<div class="calendar-day empty" style="color:#ccc; text-align:center; padding:10px;">${lastDateOfLastMonth - i + 1}</div>`;
        }

        for (let i = 1; i <= lastDateOfMonth; i++) {
            const dateStr = `${this.currYear}-${String(this.currMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            const today = new Date();
            const isToday = i === today.getDate() &&
                            this.currMonth === today.getMonth() &&
                            this.currYear === today.getFullYear() ? "today" : "";
            const daySchedules = this.getSchedulesForDate(dateStr);
            const visibleSchedules = daySchedules.slice(0, 1);
            const scheduleHtml = visibleSchedules.map(schedule => `
                <div class="schedule-entry" style="background:#eef2ff; color:#0f172a; border-radius:8px; padding:4px 6px; margin:3px 0; font-size:0.68rem; text-align:left; line-height:1.2; display:flex; flex-direction:column; gap:2px; overflow:hidden;">
                    <div style="font-weight:700; font-size:0.66rem; color:#111827; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(this.formatTime(schedule.time))}${schedule.endTime ? ' - ' + this.escapeHtml(this.formatTime(schedule.endTime)) : ''}</div>
                    <div style="font-size:0.66rem; color:#1e293b; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(schedule.subject || 'Scheduled')} - ${this.escapeHtml(schedule.student || 'TBA')}</div>
                </div>
            `).join('');
            const moreLabel = daySchedules.length > 1 ? `<div style="margin-top:4px; font-size:0.62rem; color:#334155; font-weight:700;">+${daySchedules.length - 1} more</div>` : '';

            gridHTML += `
                <div class="calendar-day ${isToday}" data-date="${dateStr}"
                     style="padding:8px; border:1px solid #f0f0f0; position:relative; min-height: 125px; display:flex; flex-direction:column; justify-content:flex-start; overflow:hidden;">
                    <div class="day-number" style="font-weight:700; margin-bottom:6px; font-size:0.85rem;">${i}</div>
                    <div class="schedule-items" style="flex:1; width:100%;">${scheduleHtml}${moreLabel}</div>
                </div>`;
        }

        this.container.querySelector("#current-date").innerText = `${this.months[this.currMonth]} ${this.currYear}`;
        this.container.querySelector("#calendar-grid").innerHTML = gridHTML;

        if (!this.selectedDate.startsWith(`${this.currYear}-${String(this.currMonth + 1).padStart(2, '0')}`)) {
            this.selectedDate = `${this.currYear}-${String(this.currMonth + 1).padStart(2, '0')}-01`;
        }

        this.markScheduleDays();
        this.setupClickListeners();
        this.updateScheduleLog();
    }

    updateScheduleLog() {
        const log = this.container.querySelector('#notif-content');
        if (!log) return;

        const daySchedules = this.getSchedulesForDate(this.selectedDate);
        const displayDate = this.selectedDate ? this.selectedDate : `${this.currYear}-${String(this.currMonth + 1).padStart(2, '0')}-01`;
        const notifyAllButton = this.container.querySelector('#owner-notify-all');
        if (notifyAllButton) {
            notifyAllButton.disabled = daySchedules.length === 0;
            notifyAllButton.title = daySchedules.length === 0
                ? 'No schedules to email for this date'
                : `Email all ${daySchedules.length} schedule${daySchedules.length === 1 ? '' : 's'} in this log`;
        }

        if (daySchedules.length === 0) {
            log.innerHTML = `<p>No schedules for ${this.escapeHtml(this.formatShortDate(displayDate))}.</p>`;
            return;
        }

        const cards = daySchedules.map((schedule, index) => `
            <div class="schedule-log-card" data-log-index="${index}" style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:18px; padding:16px; margin-bottom:14px; box-shadow:0 8px 20px rgba(15, 23, 42, 0.05); cursor:pointer; transition: all 0.2s ease; position:relative;">
                <div style="position:absolute; top:12px; right:12px; width:32px; height:32px; border-radius:10px; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#334155; font-size:1rem;">
                    <i class="bi bi-calendar3"></i>
                </div>
                <button type="button" class="owner-schedule-session" data-enrollment-id="${schedule.enrollment_details_id || 0}" style="position:absolute; top:12px; right:50px; width:32px; height:32px; border-radius:10px; border:0; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#7c3aed; font-size:1rem; cursor:pointer; transition: all 0.2s ease;" title="Open Session">
                    <i class="bi bi-box-arrow-up-right"></i>
                </button>
                <button type="button" class="owner-schedule-notify" data-enrollment-id="${schedule.enrollment_details_id || 0}" data-schedule-date="${this.escapeHtml(schedule.date)}" style="position:absolute; top:12px; right:88px; width:32px; height:32px; border-radius:10px; border:0; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#2563eb; font-size:1rem; cursor:pointer; transition: all 0.2s ease;" title="Send Notification">
                    <i class="bi bi-envelope"></i>
                </button>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; padding-right:112px;">
                    <div style="width:36px; height:36px; border-radius:12px; background:rgba(59, 130, 246, 0.12); color:#2563eb; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                        <i class="bi bi-clock"></i>
                    </div>
                    <div>
                        <div style="font-size:0.75rem; color:#475569; font-weight:700; text-transform:uppercase; letter-spacing:0.08em;">Schedule</div>
                        <div style="font-size:0.78rem; color:#64748b; font-weight:700;">${this.escapeHtml(schedule.branch || 'Unassigned Center')}</div>
                    </div>
                </div>
                <div style="font-size:1rem; font-weight:800; color:#0f172a; margin-bottom:12px;">${this.escapeHtml(this.formatTime(schedule.time))}${schedule.endTime ? ' - ' + this.escapeHtml(this.formatTime(schedule.endTime)) : ''}</div>
                <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.8rem; color:#475569; margin-bottom:12px;">
                    <span><strong>Day:</strong> ${this.escapeHtml(schedule.day || 'TBA')}</span>
                    <span><strong>Registered:</strong> ${this.escapeHtml(this.formatShortDate(schedule.date))}</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.78rem; color:#475569; margin-bottom:12px;">
                    <span><strong>Student:</strong> ${this.escapeHtml(schedule.student || 'TBA')}</span>
                    <span><strong>Teacher:</strong> ${this.escapeHtml(schedule.teacher || 'TBA')}</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.78rem; color:#475569;">
                    <span style="font-weight:700; color:#0f172a;"><i class="bi bi-check-circle"></i> Status:</span> ${this.escapeHtml(this.capitalizeStatus(schedule.status))}
                    <span style="font-weight:700; color:#0f172a;"><i class="bi bi-bell"></i> Notification:</span> ${schedule.isNotified ? 'Sent' : 'Pending'}
                </div>
            </div>
        `).join('');

        log.innerHTML = `<div style="padding-right:6px;">${cards}</div>`;
        this.attachLogCardListeners();
    }

    attachLogCardListeners() {
        const sessionButtons = this.container.querySelectorAll('.owner-schedule-session');
        sessionButtons.forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                this.openSessionPage(Number(button.dataset.enrollmentId || 0));
            });
        });

        const notifyButtons = this.container.querySelectorAll('.owner-schedule-notify');
        notifyButtons.forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                this.sendScheduleNotification(Number(button.dataset.enrollmentId || 0), button.dataset.scheduleDate || '');
            });
        });

        const logCards = this.container.querySelectorAll('.schedule-log-card');
        logCards.forEach(card => {
            card.addEventListener('click', () => {
                const index = Number(card.dataset.logIndex);
                const daySchedules = this.getSchedulesForDate(this.selectedDate);
                const schedule = daySchedules[index];
                if (!schedule) return;
                this.openScheduleDetailModal(schedule);
            });
        });
    }

    openSessionPage(enrollmentDetailsId) {
        if (enrollmentDetailsId <= 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Session Unavailable',
                text: 'This schedule does not have a valid session record yet.'
            });
            return;
        }

        const sessionUrl = new URL('./session.html', window.location.href);
        sessionUrl.searchParams.set('enrollment_details_id', String(enrollmentDetailsId));
        window.location.href = sessionUrl.href;
    }

    openScheduleDetailModal(schedule) {
        const canEdit = canUseSchedulePermission('edit');
        const actions = getManagerScheduleModalActions(schedule.status, {
            canEdit,
            canReschedule: true
        });

        openScheduleDetailsModal({
            schedule,
            actions,
            formatTime: value => this.formatTime(value),
            showCenter: true,
            personLabel: 'Student',
            personValue: schedule.student,
            showTeacher: true
        }).then(({ action }) => {
            if (['no-show', 'ongoing', 'done'].includes(action)) {
                this.updateScheduleStatus(schedule.preference_id, schedule.enrollment_details_id, schedule.date, action);
                return;
            }

            if (action === 'reschedule') {
                openRescheduleModal({
                    ...schedule,
                    last_session_date: this.getLastScheduledDate(schedule)
                }, () => this.renderCalendar(), {
                    isAdminAction: true
                });
            }
        });
    }

    getLastScheduledDate(schedule) {
        const enrollmentId = Number(schedule.enrollment_details_id || 0);
        return this.schedules
            .filter(row => Number(row.enrollment_details_id || 0) === enrollmentId)
            .map(row => row.date || '')
            .filter(Boolean)
            .sort()
            .pop() || schedule.date || '';
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
            const response = await axios.post(OWNER_SCHEDULE_ENDPOINT, payload);

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
            console.error('Error updating owner schedule status:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.response?.data?.message || 'Network error occurred'
            });
        }
    }

    async sendScheduleNotification(enrollmentDetailsId, scheduleDate) {
        if (enrollmentDetailsId <= 0 || !scheduleDate || scheduleDate.trim() === '') {
            Swal.fire({
                icon: 'warning',
                title: 'Invalid Schedule',
                text: 'Cannot send notification - missing schedule ID.'
            });
            return;
        }

        const result = await Swal.fire({
            icon: 'question',
            title: 'Send Email Notification?',
            text: 'This will send an email notification to the student and teacher about this schedule.',
            showCancelButton: true,
            confirmButtonText: 'Yes, Send',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#6c757d'
        });

        if (!result.isConfirmed) return;

        Swal.fire({
            title: 'Sending Notification...',
            text: 'Please wait while we send the email notification.',
            allowOutsideClick: false,
            showConfirmButton: false,
            willOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            const apiUrl = new URL(SEND_NOTIFICATION_ENDPOINT, window.location.href).href;
            const response = await axios.post(apiUrl, {
                enrollment_details_id: enrollmentDetailsId,
                schedule_date: scheduleDate,
                sender_type: this.notificationSenderType || 'owner'
            });

            const payload = response.data;
            Swal.close();

            if (payload.success) {
                let recipientText = 'Notification sent successfully.';
                if (Array.isArray(payload.recipients) && payload.recipients.length > 0) {
                    recipientText = 'Notification sent to:';
                    payload.recipients.forEach(recipient => {
                        recipientText += `\n- ${recipient.name} (${recipient.type})`;
                    });
                }

                Swal.fire({
                    icon: 'success',
                    title: 'Notification Sent!',
                    text: recipientText,
                    confirmButtonText: 'OK'
                }).then(() => {
                    this.renderCalendar();
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Failed to Send',
                    text: payload.message || 'Unknown error occurred'
                });
            }
        } catch (error) {
            const responseData = error.response?.data;
            console.error(`Error sending ${this.notificationSenderType || 'owner'} schedule notification:`, responseData || error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: responseData?.message || error.message || 'Failed to send notification. Please try again.'
            });
        }
    }

    async sendAllScheduleNotifications() {
        const schedules = this.getSchedulesForDate(this.selectedDate).filter(schedule =>
            schedule.enrollment_details_id > 0 && schedule.date
        );

        if (schedules.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'No Schedules to Email',
                text: 'There are no valid schedules in the selected schedule log.'
            });
            return;
        }

        const result = await Swal.fire({
            icon: 'question',
            title: 'Email All Schedules?',
            text: `This will send email notifications to the student and teacher for all ${schedules.length} schedule${schedules.length === 1 ? '' : 's'} shown for ${this.formatShortDate(this.selectedDate)}.`,
            showCancelButton: true,
            confirmButtonText: 'Yes, Send All',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#6c757d'
        });

        if (!result.isConfirmed) return;

        const notifyAllButton = this.container.querySelector('#owner-notify-all');
        if (notifyAllButton) notifyAllButton.disabled = true;

        Swal.fire({
            title: 'Sending Notifications...',
            html: `<span id="owner-notify-progress">Sending 0 of ${schedules.length} schedules.</span>`,
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => Swal.showLoading()
        });

        const sent = [];
        const failed = [];
        const apiUrl = new URL(SEND_NOTIFICATION_ENDPOINT, window.location.href).href;

        for (let index = 0; index < schedules.length; index++) {
            const schedule = schedules[index];
            const progress = Swal.getHtmlContainer()?.querySelector('#owner-notify-progress');
            if (progress) {
                progress.textContent = `Sending ${index + 1} of ${schedules.length} schedules.`;
            }

            try {
                const response = await axios.post(apiUrl, {
                    enrollment_details_id: schedule.enrollment_details_id,
                    schedule_date: schedule.date,
                    sender_type: this.notificationSenderType || 'owner'
                });

                if (response.data?.success) {
                    sent.push(schedule);
                } else {
                    failed.push({
                        schedule,
                        reason: response.data?.message || 'Notification could not be sent'
                    });
                }
            } catch (error) {
                failed.push({
                    schedule,
                    reason: error.response?.data?.message || error.message || 'Network error'
                });
            }
        }

        Swal.close();

        const failureDetails = failed.length > 0
            ? `<div style="margin-top:12px; text-align:left; max-height:160px; overflow-y:auto;">
                ${failed.map(item => `<div style="margin-bottom:6px;"><strong>${this.escapeHtml(item.schedule.student || 'Schedule')}</strong>: ${this.escapeHtml(item.reason)}</div>`).join('')}
               </div>`
            : '';

        await Swal.fire({
            icon: failed.length === 0 ? 'success' : (sent.length > 0 ? 'warning' : 'error'),
            title: failed.length === 0 ? 'All Notifications Sent!' : 'Bulk Send Complete',
            html: `<p style="margin-bottom:4px;"><strong>${sent.length}</strong> schedule${sent.length === 1 ? '' : 's'} sent successfully.</p>
                   <p style="margin-bottom:0;"><strong>${failed.length}</strong> schedule${failed.length === 1 ? '' : 's'} failed.</p>
                   ${failureDetails}`,
            confirmButtonText: 'OK'
        });

        this.renderCalendar();
    }

    setupClickListeners() {
        const calendarDays = this.container.querySelectorAll('.calendar-day:not(.empty)');

        calendarDays.forEach(day => {
            day.style.cursor = 'pointer';
            day.addEventListener('click', () => {
                const dateStr = day.dataset.date;
                if (!dateStr) return;

                this.selectedDate = dateStr;
                this.updateScheduleLog();
            });
        });
    }

    getSchedulesForDate(dateStr) {
        return this.visibleSchedules.filter(schedule => schedule.date === dateStr);
    }

    formatDateKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    formatShortDate(dateValue) {
        const value = String(dateValue || '').trim();
        if (!value) return 'TBA';

        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
            return `${match[2]}/${match[3]}/${match[1].slice(-2)}`;
        }

        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) return value;

        return `${String(parsedDate.getMonth() + 1).padStart(2, '0')}/${String(parsedDate.getDate()).padStart(2, '0')}/${String(parsedDate.getFullYear()).slice(-2)}`;
    }

    formatTime(time24) {
        if (!time24) return '';
        const [hours, minutes = '00'] = String(time24).split(':');
        const hourNum = parseInt(hours, 10);
        if (Number.isNaN(hourNum)) return time24;
        const suffix = hourNum >= 12 ? 'PM' : 'AM';
        const normalizedHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
        return `${normalizedHour}:${minutes} ${suffix}`;
    }

    capitalizeStatus(status) {
        if (!status) return 'Pending';
        if (status === 'no-show') return 'No-show';
        return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    normalizeStatus(status) {
        return String(status || '').trim().toLowerCase();
    }

    toBoolean(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        const normalized = String(value ?? '').trim().toLowerCase();
        return ['1', 'true', 'yes', 'sent'].includes(normalized);
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }
}
