import { openRescheduleModal } from './reschedule.js';

export default class CalendarModule {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.date = new Date();
        this.currYear = this.date.getFullYear();
        this.currMonth = this.date.getMonth();
        this.allStudentSchedules = [];
        this.studentSchedules = [];
        this.scheduleFilters = { search: '', status: '', subject: '', teacher: '', enrollmentType: '' };
        this.selectedDate = `${this.date.getFullYear()}-${String(this.date.getMonth() + 1).padStart(2, '0')}-${String(this.date.getDate()).padStart(2, '0')}`;
        
        this.months = [
            "January", "February", "March", "April", "May", "June", 
            "July", "August", "September", "October", "November", "December"
        ];

        this.init();
    }

    init() {
        this.container.innerHTML = `
            <div class="calendar-wrapper">
                <header class="calendar-header">
                    <button class="nav-btn" id="prev-month">&#10094;</button>
                    <h2 id="current-date"></h2>
                    <button class="nav-btn" id="next-month">&#10095;</button>
                </header>
                <div class="calendar-body">
                    <div class="calendar-grid" id="calendar-grid"></div>
                </div>
            </div>
            
            <div class="notification-wrapper">
                <div class="notif-header">SCHEDULE LOG</div>
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

        this.setupScheduleFilters();
        this.renderCalendar();
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

    async loadStudentSchedules() {
        try {
            const response = await axios.get('../../api/student/schedule.php', {
                params: {
                    operation: 'getSchedules',
                    month: this.getVisibleMonthKey()
                }
            });
            const data = response.data;

            if (data && Array.isArray(data.schedules)) {
                this.allStudentSchedules = data.schedules.map(schedule => this.normalizeScheduleRow(schedule));
            } else if (Array.isArray(data)) {
                this.allStudentSchedules = data.map(schedule => this.normalizeScheduleRow(schedule));
            } else {
                this.allStudentSchedules = [];
            }
            this.populateScheduleFilterOptions();
            this.applyScheduleFilters();
        } catch (error) {
            console.error('Failed to load schedules:', error);
            this.allStudentSchedules = [];
            this.studentSchedules = [];
        }
    }

    normalizeScheduleRow(row) {
        return {
            enrollment_details_id: row.enrollment_details_id || 0,
            preferred_teacher: row.preferred_teacher || row.teacher_id || null,
            date: row.date || row.schedule_date || '',
            last_session_date: row.last_session_date || row.lastSessionDate || row.latest_session_date || '',
            day: row.day || row.day_name || '',
            time: row.time || row.start_time || row.startTime || '',
            endTime: row.endTime || row.end_time || row.endTime || '',
            program: row.program || row.program_name || '',
            enrollmentType: row.enrollmentType || row.enrollment_type || this.deriveEnrollmentType(row),
            subject: row.subject || row.subject_name || '',
            teacher: row.teacher || row.teacher_name || '',
            branch: row.branch || row.branch_name || '',
            status: row.status || 'pending',
            isNotified: row.isNotified || false,
            scheduleType: row.scheduleType || row.schedule_type || 'preferred',
            sectionName: row.sectionName || row.section_name || '',
            schoolYear: row.schoolYear || row.school_year || '',
            allowConfirmation: row.allowConfirmation !== undefined ? Boolean(row.allowConfirmation) : true,
            allowReschedule: row.allowReschedule !== undefined ? Boolean(row.allowReschedule) : true,
            allowNotification: row.allowNotification !== undefined ? Boolean(row.allowNotification) : true
        };
    }

    deriveEnrollmentType(schedule) {
        const program = String(schedule?.program || schedule?.program_name || '').toLowerCase();
        if (/play[\s-]*school/.test(program)) return 'Play School';
        if (/pre[\s-]*school/.test(program)) return 'Preschool';
        return 'Tutorial';
    }

    setupScheduleFilters() {
        const searchInput = document.getElementById('search-input');
        const statusSelect = document.getElementById('schedule-status-filter');
        const subjectSelect = document.getElementById('schedule-subject-filter');
        const teacherSelect = document.getElementById('schedule-teacher-filter');
        const typeSelect = document.getElementById('schedule-type-filter');
        const applyButton = document.getElementById('schedule-apply-filters');
        let searchTimer;

        const refresh = () => {
            this.scheduleFilters.search = searchInput?.value.trim() || '';
            this.scheduleFilters.status = statusSelect?.value || '';
            this.scheduleFilters.subject = subjectSelect?.value || '';
            this.scheduleFilters.teacher = teacherSelect?.value || '';
            this.scheduleFilters.enrollmentType = typeSelect?.value || '';
            this.applyScheduleFilters();
            this.renderCalendar(false);
        };

        searchInput?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(refresh, 250);
        });
        [statusSelect, subjectSelect, teacherSelect, typeSelect]
            .forEach(select => select?.addEventListener('change', refresh));
        applyButton?.addEventListener('click', refresh);
    }

    setScheduleFilterOptions(selectId, values, placeholder) {
        const select = document.getElementById(selectId);
        if (!select) return;

        const selected = select.value;
        select.replaceChildren(new Option(placeholder, ''));
        values.forEach(value => select.add(new Option(value, value)));
        if (values.includes(selected)) select.value = selected;
    }

    populateScheduleFilterOptions() {
        const uniqueSorted = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right));

        this.setScheduleFilterOptions('schedule-status-filter', uniqueSorted(this.allStudentSchedules.map(item => item.status)), 'All Status');
        this.setScheduleFilterOptions('schedule-subject-filter', uniqueSorted(this.allStudentSchedules.map(item => item.subject || item.program)), 'All Subjects');
        this.setScheduleFilterOptions('schedule-teacher-filter', uniqueSorted(this.allStudentSchedules.map(item => item.teacher)), 'All Teachers');
    }

    applyScheduleFilters() {
        const search = this.scheduleFilters.search.toLowerCase();
        this.studentSchedules = this.allStudentSchedules.filter(schedule => {
            const subject = String(schedule.subject || schedule.program || '').trim();
            const teacher = String(schedule.teacher || '').trim();
            const searchableText = `${subject} ${teacher}`.toLowerCase();

            return (!search || searchableText.includes(search))
                && (!this.scheduleFilters.status || schedule.status === this.scheduleFilters.status)
                && (!this.scheduleFilters.subject || subject === this.scheduleFilters.subject)
                && (!this.scheduleFilters.teacher || teacher === this.scheduleFilters.teacher)
                && (!this.scheduleFilters.enrollmentType || schedule.enrollmentType === this.scheduleFilters.enrollmentType);
        });
    }

    markScheduleDays() {
        const days = this.container.querySelectorAll('.calendar-day:not(.empty)');

        days.forEach(dayElement => {
            const formattedDate = dayElement.dataset.date;
            if (!formattedDate) return;

            const daySchedules = this.studentSchedules.filter(s => s.date === formattedDate);

            if (daySchedules.length > 0) {
                dayElement.classList.add('has-schedule');
                const tooltip = daySchedules.map(s => `Subject: ${s.subject || 'Scheduled'} | Teacher: ${s.teacher || 'TBA'} | ${s.time}${s.endTime ? ' - ' + s.endTime : ''}`).join('\n');
                dayElement.title = tooltip;
            }
        });
    }

    async renderCalendar(reloadSchedules = true) {
        if (reloadSchedules) {
            await this.loadStudentSchedules();
        }
        
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
            let isToday = i === new Date().getDate() && 
                          this.currMonth === new Date().getMonth() && 
                          this.currYear === new Date().getFullYear() ? "today" : "";

            const daySchedules = this.studentSchedules.filter(s => s.date === dateStr);
            const visibleSchedules = daySchedules.slice(0, 2);
            const scheduleHtml = visibleSchedules.map(s => `
                <div class="schedule-entry ${this.isPrePlaySchedule(s) ? 'schedule-entry--preplay' : 'schedule-entry--tutorial'}">
                    <div class="schedule-entry-type">${this.escapeHtml(s.enrollmentType)}</div>
                    <div style="font-weight:700; font-size:0.60rem; margin-bottom:2px;">${this.formatTime(s.time)}${s.endTime ? ' - ' + this.formatTime(s.endTime) : ''}</div>
                    <div style="font-size:0.60rem; color:#1e293b; font-weight:600; margin-bottom:1px;">${this.escapeHtml(s.subject || s.program || 'Scheduled')}</div>
                    <div style="font-size:0.58rem; color:#475569;">${this.escapeHtml(s.teacher || 'TBA')}</div>

                </div>
            `).join('');

            const moreLabel = daySchedules.length > 2 ? `<div style="margin-top:3px; font-size:0.40rem; color:#334155; font-weight:600;">+${daySchedules.length - 2} more</div>` : '';

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

        const daySchedules = this.studentSchedules.filter(s => s.date === this.selectedDate);
        const displayDate = this.selectedDate ? this.selectedDate : `${this.currYear}-${String(this.currMonth + 1).padStart(2, '0')}-01`;

        if (daySchedules.length === 0) {
            log.innerHTML = `<p>No schedules for ${displayDate}.</p>`;
            return;
        }

        const cards = daySchedules.map((s, index) => `
            <div class="schedule-log-card" data-log-index="${index}" style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:18px; padding:16px; margin-bottom:14px; box-shadow:0 8px 20px rgba(15, 23, 42, 0.05); cursor:pointer; transition: all 0.2s ease; position:relative;">
                <div style="position:absolute; top:12px; right:12px; width:32px; height:32px; border-radius:10px; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#334155; font-size:1rem;">
                    <i class="bi bi-calendar3"></i>
                </div>
                ${this.shouldShowSessionButton(s) ? `
                    <button type="button" class="student-schedule-session" data-enrollment-id="${s.enrollment_details_id || 0}" style="position:absolute; top:12px; right:50px; width:32px; height:32px; border-radius:10px; border:0; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#7c3aed; font-size:1rem; cursor:pointer; transition: all 0.2s ease;" title="Open Session">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </button>
                ` : ''}
                ${s.allowNotification ? `
                    <div style="position:absolute; top:12px; right:88px; width:32px; height:32px; border-radius:10px; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#2563eb; font-size:1rem; cursor:pointer; transition: all 0.2s ease;" title="Send Notification" onclick="event.stopPropagation(); sendScheduleNotification(${s.enrollment_details_id || 0}, '${s.date}')">
                        <i class="bi bi-envelope"></i>
                    </div>
                ` : ''}
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; padding-right:${this.shouldShowSessionButton(s) ? '112px' : '72px'};">
                    <div style="width:36px; height:36px; border-radius:12px; background:rgba(59, 130, 246, 0.12); color:#2563eb; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                        <i class="bi bi-clock"></i>
                    </div>
                    <div style="font-size:0.75rem; color:#475569; font-weight:700; text-transform:uppercase; letter-spacing:0.08em;">Schedule</div>
                </div>
                <div style="font-size:1rem; font-weight:800; color:#0f172a; margin-bottom:12px;">${this.formatTime(s.time)}${s.endTime ? ' - ' + this.formatTime(s.endTime) : ''}</div>
                <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.8rem; color:#475569; margin-bottom:12px;">
                    <span><strong>Day:</strong> ${s.day}</span>
                    <span><strong>Registered:</strong> ${s.date}</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.78rem; color:#475569; margin-bottom:12px;">
                    <span><strong>Type:</strong> ${this.escapeHtml(s.enrollmentType)}</span>
                    <span><strong>Program:</strong> ${this.escapeHtml(s.program || 'N/A')}</span>
                    <span><strong>Class:</strong> ${this.escapeHtml(s.subject || s.sectionName || 'Scheduled')}</span>
                    <span><strong>Teacher:</strong> ${this.escapeHtml(s.teacher || 'TBA')}</span>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:12px; font-size:0.78rem; color:#475569;">
                    <span style="font-weight:700; color:#0f172a;"><i class="bi bi-check-circle"></i> Status:</span> ${this.capitalizeStatus(s.status)}
                    <span style="font-weight:700; color:#0f172a;"><i class="bi bi-bell"></i> Notification:</span> ${s.allowNotification ? (s.isNotified ? 'Sent' : 'Pending') : 'Not required'}
                </div>
            </div>
        `).join('');

        log.innerHTML = `
            <div style="padding-right:6px;">
                ${cards}
            </div>
        `;

        this.attachLogCardListeners();
    }

    attachLogCardListeners() {
        const sessionButtons = this.container.querySelectorAll('.student-schedule-session');
        sessionButtons.forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                this.openSessionPage(Number(button.dataset.enrollmentId || 0));
            });
        });

        const logCards = this.container.querySelectorAll('.schedule-log-card');
        logCards.forEach(card => {
            card.addEventListener('click', () => {
                const index = Number(card.dataset.logIndex);
                const daySchedules = this.studentSchedules.filter(s => s.date === this.selectedDate);
                const schedule = daySchedules[index];
                if (!schedule) return;
                this.openScheduleDetailModal(schedule);
            });
        });
    }

    openSessionPage(enrollmentDetailsId) {
        if (!enrollmentDetailsId) {
            Swal.fire({
                icon: 'warning',
                title: 'Session Unavailable',
                text: 'This schedule does not have a linked session yet.'
            });
            return;
        }

        const sessionUrl = new URL('./session.html', window.location.href);
        sessionUrl.searchParams.set('enrollment_details_id', String(enrollmentDetailsId));
        window.location.href = sessionUrl.href;
    }

    shouldShowSessionButton(schedule) {
        return Boolean(schedule?.enrollment_details_id) && !this.isPrePlaySchedule(schedule);
    }

    isPrePlaySchedule(schedule) {
        if (schedule?.enrollmentType === 'Preschool' || schedule?.enrollmentType === 'Play School') return true;
        const searchText = `${schedule?.program || ''} ${schedule?.subject || ''} ${schedule?.sectionName || ''}`.toLowerCase();
        const prePlayKeywords = ['preschool', 'playschool', 'pre-school', 'play-school', 'pre school', 'play school'];
        return prePlayKeywords.some(keyword => searchText.includes(keyword));
    }

    openScheduleDetailModal(schedule) {
        const isPending = schedule.status === 'pending' && schedule.allowConfirmation;
        const showConfirmButton = Boolean(schedule.allowConfirmation);
        const showReschedule = Boolean(schedule.allowReschedule);
        const confirmButtonText = isPending ? 'Confirm' : 'Confirmed';
        const confirmButtonDisabled = !isPending;
        const timeLabel = schedule.scheduleType === 'section' ? 'Recurring Section Schedule' : 'Preferred Time';
        const notificationLabel = schedule.allowNotification
            ? (schedule.isNotified ? 'Sent' : 'Pending')
            : 'Not required';

        const content = `
            <div style="display:flex; flex-direction:column; gap:12px; max-height:420px; overflow-y:auto; padding-right:8px; text-align:left;">
                <div style="padding:16px; background:#f3e8ff; border-radius:16px; display:flex; align-items:center; gap:12px;">
                    <div style="width:40px; height:40px; border-radius:12px; background:rgba(99, 102, 241, 0.15); color:#6366f1; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
                        <i class="bi bi-clock"></i>
                    </div>
                    <div>
                        <div style="font-size:0.72rem; color:#6b7280; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; margin-bottom:4px;">${timeLabel}</div>
                        <div style="font-size:1.15rem; font-weight:800; color:#0f172a;">${this.formatTime(schedule.time)}${schedule.endTime ? ' - ' + this.formatTime(schedule.endTime) : ''}</div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:rgba(236, 72, 153, 0.12); color:#ec4899; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                            <i class="bi bi-calendar-event"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Day</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#0f172a;">${schedule.day}</div>
                        </div>
                    </div>
                    <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:rgba(236, 72, 153, 0.12); color:#ec4899; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                            <i class="bi bi-calendar2-check"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Registered</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#0f172a;">${schedule.date}</div>
                        </div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:rgba(59, 130, 246, 0.12); color:#3b82f6; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                            <i class="bi bi-book"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Subject</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#0f172a;">${schedule.subject || 'TBA'}</div>
                        </div>
                    </div>
                    <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:rgba(168, 85, 247, 0.12); color:#a855f7; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                            <i class="bi bi-person"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Teacher</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#0f172a;">${schedule.teacher || 'TBA'}</div>
                        </div>
                    </div>
                </div>
                <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                    <div style="width:36px; height:36px; border-radius:10px; background:rgba(249, 115, 22, 0.12); color:#f97316; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                        <i class="bi bi-briefcase"></i>
                    </div>
                    <div style="flex:1;">
                        <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Program</div>
                        <div style="font-size:0.9rem; font-weight:700; color:#0f172a;">${schedule.program || 'N/A'} (${schedule.enrollmentType})</div>
                    </div>
                </div>
                ${schedule.sectionName ? `
                    <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:rgba(244, 114, 182, 0.12); color:#db2777; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                            <i class="bi bi-people"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Section</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#0f172a;">${schedule.sectionName}</div>
                        </div>
                    </div>
                ` : ''}
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:rgba(16, 185, 129, 0.12); color:#10b981; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                            <i class="bi bi-check-circle"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Status</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#10b981;">${this.capitalizeStatus(schedule.status)}</div>
                        </div>
                    </div>
                    <div style="background:#ffffff; border:1px solid rgba(15, 23, 42, 0.08); border-radius:14px; padding:12px; display:flex; align-items:center; gap:10px;">
                        <div style="width:36px; height:36px; border-radius:10px; background:rgba(59, 130, 246, 0.12); color:#3b82f6; display:flex; align-items:center; justify-content:center; font-size:1rem;">
                            <i class="bi bi-bell"></i>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:0.68rem; color:#6b7280; font-weight:700; margin-bottom:2px;">Notification</div>
                            <div style="font-size:0.9rem; font-weight:700; color:#0f172a;">${notificationLabel}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        Swal.fire({
            title: 'Schedule Details',
            html: content,
            showCloseButton: true,
            showConfirmButton: showConfirmButton,
            showCancelButton: showReschedule,
            confirmButtonText: confirmButtonText,
            cancelButtonText: 'Reschedule',
            confirmButtonColor: isPending ? '#10b981' : '#6c757d',
            cancelButtonColor: '#f97316',
            width: 620,
            heightAuto: false,
            customClass: {
                popup: 'calendar-schedule-popup'
            },
            didOpen: (modal) => {
                const buttonContainer = modal.querySelector('.swal2-actions');
                if (buttonContainer) {
                    buttonContainer.style.justifyContent = 'flex-end';
                    buttonContainer.style.gap = '10px';
                }
                if (confirmButtonDisabled) {
                    const confirmBtn = modal.querySelector('.swal2-confirm');
                    if (confirmBtn) confirmBtn.disabled = true;
                }
            }
        }).then((result) => {
            if (result.isConfirmed && isPending) {
                this.confirmSchedule(schedule);
            } else if (result.dismiss === Swal.DismissReason.cancel && showReschedule) {
                // Open reschedule modal
                openRescheduleModal(schedule, () => {
                    this.loadStudentSchedules().then(() => {
                        this.updateScheduleLog();
                    });
                });
            }
        });
    }

    async confirmSchedule(schedule) {
        Swal.fire({
            title: 'Confirming Schedule...',
            text: 'Please wait while we update your schedule.',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        const confirmUrl = new URL('../../api/schedule_confirm.php', window.location.href);
        confirmUrl.searchParams.set('enrollment_details_id', schedule.enrollment_details_id);
        confirmUrl.searchParams.set('schedule_date', schedule.date);

        try {
            const response = await fetch(confirmUrl.href, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html'
                }
            });
            const html = await response.text();
            Swal.close();

            if (html.includes('Session Confirmed')) {
                schedule.status = 'confirmed';
                this.updateScheduleLog();
                Swal.fire({
                    icon: 'success',
                    title: 'Schedule Confirmed!',
                    text: 'Your session has been confirmed. The teacher has been notified.',
                    confirmButtonText: 'OK'
                });
            } else {
                console.error('Confirmation response:', html);
                Swal.fire({
                    icon: 'error',
                    title: 'Confirmation Failed',
                    text: 'Unable to cosnfirm the schedule. Please try again or contact support.'
                });
            }
        } catch (error) {
            Swal.close();
            console.error('Confirmation error:', error);
            Swal.fire({
                icon: 'error',
                title: 'Confirmation Failed',
                text: 'Unable to confirm the schedule. Please try again or contact support.'
            });
        }
    }

    setupClickListeners() {
        /* Click-to-modal popup disabled as requested */
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

    formatTime(time24) {
        if (!time24) return '';
        const [hours, minutes] = time24.split(':');
        const hourNum = parseInt(hours, 10);
        if (Number.isNaN(hourNum)) return time24;
        const suffix = hourNum >= 12 ? 'PM' : 'AM';
        const normalizedHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
        return `${normalizedHour}:${minutes} ${suffix}`;
    }

    capitalizeStatus(status) {
        if (!status) return 'Pending';
        return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    getVisibleMonthKey() {
        return `${this.currYear}-${String(this.currMonth + 1).padStart(2, '0')}`;
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

// Global function for sending schedule notifications
window.sendScheduleNotification = async function(enrollmentDetailsId, scheduleDate) {
    // Validate inputs - allow 0 for ID, but check for null/undefined
    if (enrollmentDetailsId == null || !scheduleDate || (typeof scheduleDate === 'string' && scheduleDate.trim() === '')) {
        Swal.fire({
            icon: 'error',
            title: 'Invalid Data',
            text: 'Schedule information is missing'
        });
        return;
    }

    // Show confirmation dialog first
    Swal.fire({
        icon: 'question',
        title: 'Send Email Notification?',
        text: 'This will send an email notification to the teacher about this schedule.',
        showCancelButton: true,
        confirmButtonText: 'Yes, Send',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#2563eb',
        cancelButtonColor: '#6c757d'
    }).then(async (result) => {
        if (!result.isConfirmed) return;

        // Show loading indicator
        Swal.fire({
            title: 'Sending Notification...',
            text: 'Please wait while we send the email notification.',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            const apiUrl = new URL('../../api/send_schedule_notification.php', window.location.href).href;
            const response = await axios.post(apiUrl, {
                enrollment_details_id: enrollmentDetailsId,
                schedule_date: scheduleDate,
                sender_type: 'student'
            });

            const result = response.data;

            Swal.close();

            if (result.success) {
                let recipientText = 'Notification sent to:';
                if (result.recipients && result.recipients.length > 0) {
                    result.recipients.forEach(recipient => {
                        recipientText += `\n• ${recipient.name} (${recipient.type})`;
                    });
                } else {
                    recipientText = 'Notification sent successfully.';
                }

                Swal.fire({
                    icon: 'success',
                    title: 'Notification Sent!',
                    text: recipientText,
                    confirmButtonText: 'OK'
                });
            } else {
                const errorText = result.message || JSON.stringify(result) || 'Unknown error occurred';
                Swal.fire({
                    icon: 'error',
                    title: 'Failed to Send',
                    text: errorText
                });
            }
        } catch (error) {
            Swal.close();

            const responseData = error.response?.data;
            console.error('Error sending notification:', responseData || error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: responseData?.message || error.message || 'Failed to send notification. Please try again.'
            });
        }
    });
};
