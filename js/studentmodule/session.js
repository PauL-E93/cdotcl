import { openRescheduleModal } from './reschedule.js';
import { canUseSessionPermission, shouldApplySessionRbac } from '../modules/session_rbac.js';
import {
    getManagerScheduleModalActions,
    getStudentScheduleModalActions,
    openScheduleDetailsModal
} from '../utilities/schedule_details_modal.js';

/**
 * SessionManager Module
 * Handles the dynamic rendering of the Tracking page content.
 */
export class SessionManager {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        this.enrollments = [];
        this.currentEnrollmentId = null;
        this.initialEnrollmentId = this._getInitialEnrollmentId();
        this.pathname = window.location.pathname;
        this.isTeacherView = this.pathname.includes('/teacher/');
        this.isAuditorView = this.pathname.includes('/auditor/');
        this.scheduleUpdateEndpoint = this._getScheduleUpdateEndpoint();
        this.isScheduleManagerView = Boolean(this.scheduleUpdateEndpoint) || this.isAuditorView;
        this.canEditSession = !shouldApplySessionRbac() || canUseSessionPermission('edit');
    }

    /**
     * Main render function
     * @param {Object} data - The session data object
     */
    init(data) {
        if (!this.container) return;
        this.loadEnrollments(data);
    }

    /**
     * Load all enrollments for the student
     */
    async loadEnrollments(initialData = null) {
        try {
            const response = await axios.get('../../api/student/session.php?operation=getEnrollments');
            
            if (response.data.status === 'success') {
                this.enrollments = (response.data.enrollments || []).filter(enrollment => this._isTutorialEnrollment(enrollment));
                
                // Set first enrollment as current if not set
                if (this.enrollments.length > 0) {
                    const requestedEnrollment = this.initialEnrollmentId;
                    const matchedEnrollment = requestedEnrollment
                        ? this.enrollments.find(enrollment => Number(enrollment.enrollment_details_id) === requestedEnrollment)
                        : null;

                    this.currentEnrollmentId = matchedEnrollment
                        ? matchedEnrollment.enrollment_details_id
                        : this.enrollments[0].enrollment_details_id;
                    
                    // Render selector and initial content
                    this.renderEnrollmentSelector();
                    this.loadSessionByEnrollment(this.currentEnrollmentId);
                } else {
                    this.container.innerHTML = `
                        <div class="alert alert-info" role="alert">
                            <i class="bi bi-info-circle"></i> ${this.isScheduleManagerView ? 'No assigned tutorial students found.' : 'No tutorial enrollments found.'}
                        </div>
                    `;
                }
            } else {
                const message = this.isScheduleManagerView && response.data.message === 'No enrollments found'
                    ? 'No assigned tutorial students found.'
                    : (response.data.message || 'No tutorial enrollments found.');

                this.container.innerHTML = `
                    <div class="alert alert-warning" role="alert">
                        <i class="bi bi-info-circle"></i> ${message}
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading enrollments:', error);
            this.container.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <i class="bi bi-exclamation-circle"></i> Error loading enrollments. Please refresh the page.
                </div>
            `;
        }
    }

    _isTutorialEnrollment(enrollment) {
        const programType = Number(enrollment.program_type);
        if (programType) {
            return programType === 1 || programType === 2;
        }

        const name = `${enrollment.program_name || ''} ${enrollment.label || ''}`.toLowerCase();
        const prePlayKeywords = ['preschool', 'playschool', 'pre-school', 'play-school', 'pre school', 'play school'];
        return !prePlayKeywords.some(keyword => name.includes(keyword));
    }

    /**
     * Render enrollment selector dropdown
     */
    renderEnrollmentSelector() {
        const selectorLabel = this.isScheduleManagerView ? 'Select Student Tutorial:' : 'Select Enrollment:';
        const selectorHTML = `
            ${this.isScheduleManagerView ? `
                <div class="mb-4">
                    <h1 class="page-title mb-1">STUDENT SESSIONS</h1>
                    <p class="text-muted mb-0">Review the tutorial progress of students assigned to you.</p>
                </div>
            ` : ''}
            <div class="mb-4 p-3 bg-light rounded-3 d-flex align-items-center gap-3">
                <label for="enrollment-selector" class="form-label fw-bold mb-0" style="min-width: 150px;">
                    <i class="bi bi-collection me-2"></i>${selectorLabel}
                </label>
                <select id="enrollment-selector" class="form-select form-select-md" style="max-width: 400px;">
                    ${this.enrollments.map(e => `
                        <option value="${e.enrollment_details_id}" ${e.enrollment_details_id === this.currentEnrollmentId ? 'selected' : ''}>
                            ${this.isScheduleManagerView ? e.label : `${e.label} - ${e.teacher_name}`}
                        </option>
                    `).join('')}
                </select>
            </div>
        `;

        // Insert selector at the top of container
        this.container.innerHTML = selectorHTML;

        // Add event listener to selector
        const selector = document.getElementById('enrollment-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                this.currentEnrollmentId = parseInt(e.target.value);
                this.loadSessionByEnrollment(this.currentEnrollmentId);
            });
        }
    }

    /**
     * Load session data for a specific enrollment
     */
    async loadSessionByEnrollment(enrollmentDetailsId) {
        let contentContainer = document.getElementById('session-content');
        if (!contentContainer) {
            contentContainer = document.createElement('div');
            contentContainer.id = 'session-content';
            this.container.appendChild(contentContainer);
        }
        contentContainer.innerHTML = `
            <div class="text-muted py-4">
                <i class="bi bi-hourglass-split me-2"></i>Loading session...
            </div>
        `;

        try {
            const response = await axios.get(`../../api/student/session.php?operation=getSessionByEnrollment&enrollment_details_id=${enrollmentDetailsId}`);
            
            if (response.data.status === 'success') {
                this.render(response.data.data, contentContainer);
            } else {
                contentContainer.innerHTML = `
                    <div class="alert alert-warning mt-4" role="alert">
                        <i class="bi bi-info-circle"></i> ${response.data.message}
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error loading session:', error);
            contentContainer.innerHTML = `
                <div class="alert alert-danger mt-4" role="alert">
                    <i class="bi bi-exclamation-circle"></i> Error loading session data.
                </div>
            `;
        }
    }

    render(data, container = this.container) {
        this.currentSessionData = data;
        const noScheduleMessage = this.isScheduleManagerView
            ? `The tutorial enrollment for <strong>${data.studentName}</strong> in <strong>${data.title}</strong> is active, but no sessions have been scheduled yet.`
            : `Your enrollment for <strong>${data.title}</strong> is active. Contact your branch administrator to schedule your first session.`;

        if (data.noScheduledSessions) {
            container.innerHTML = `
                <div class="alert alert-info mt-4" role="alert">
                    <i class="bi bi-calendar-plus fs-3 me-2"></i>
                    <strong>No sessions scheduled yet</strong><br>
                    ${noScheduleMessage}
                </div>
                ${this._createHeaderCard(data)}
                ${this._createProgressTimeline(data)}
                ${this._createDetailsSection(data)}
            `;
        } else {
            container.innerHTML = `
                ${this._createHeaderCard(data)}
                ${this._createProgressTimeline(data)}
                ${this._createDetailsSection(data)}
            `;
        }

        this._attachSessionStepListeners(data, container);
    }

    _createHeaderCard(data) {
        const sessionAction = this.isScheduleManagerView
            ? `<div class="rounded-3 bg-light p-3 text-center">
                    <i class="bi bi-person-check text-danger fs-3"></i>
                    <div class="small text-muted mt-2">Viewing tutorial progress for</div>
                    <strong>${data.studentName}</strong>
               </div>`
            : '';

        return `
            <div class="card shadow-sm mb-4 border-0 p-4">
                <div class="row align-items-center">
                    <div class="col-md-2 text-center">
                        <div class="bg-light p-4 rounded-3 mb-2">
                             <i class="bi bi-book text-danger fs-1"></i>
                        </div>
                        <small class="fw-bold">${data.category}</small>
                    </div>
                    <div class="${this.isScheduleManagerView ? 'col-md-7' : 'col-md-10'}">
                        <span class="badge bg-danger-subtle text-danger mb-2">CURRENT SESSION</span>
                        <h2 class="fw-bold">${data.title}</h2>
                        <p class="text-muted">${data.description}</p>
                        <div class="d-flex flex-wrap gap-4 text-muted small">
                            <span><i class="bi bi-play-circle me-1"></i> Lesson ${data.currentLesson} of ${data.totalLessons}</span>
                            <span><i class="bi bi-clock me-1"></i> Started: ${data.startTimeFormatted}</span>
                            <span><i class="bi bi-person me-1"></i> Instructor: ${data.instructor}</span>
                            <span><i class="bi bi-grid me-1"></i> Category: ${data.category}</span>
                        </div>
                        <div class="mt-3">
                            <div class="d-flex justify-content-between small mb-1">
                                <span>Overall Progress</span>
                                <span class="text-danger fw-bold">${data.overallProgress}% Completed</span>
                            </div>
                            <div class="progress" style="height: 8px; border-radius: 10px;">
                                <div class="progress-bar bg-danger" style="width: ${data.overallProgress}%"></div>
                            </div>
                        </div>
                    </div>
                    ${this.isScheduleManagerView ? `
                        <div class="col-md-3 d-grid gap-2">
                            ${sessionAction}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

_createProgressTimeline(data) {
    return `
        <div class="card border-0 shadow-sm rounded-4 p-4 mb-4">
            
            <div class="d-flex justify-content-between align-items-center mb-5">
                <div>
                    <h5 class="fw-bold mb-1">Session Progress</h5>
                    <small class="text-muted">
                        ${this.isScheduleManagerView ? `Track ${data.studentName}'s tutorial journey` : 'Track your current tutorial journey'}
                    </small>
                </div>

                <div class="text-end">
                    <div class="fw-semibold">
                        ${data.totalLessons} Lessons
                    </div>
                    <small class="text-muted">
                        ~${data.totalDuration} total
                    </small>
                </div>
            </div>

            <div class="lesson-timeline-container d-flex" style="--timeline-progress: ${this._getTimelineProgress(data)};">
                <div class="timeline-line"></div>

                ${data.lessons.map((lesson, index) => this._createLessonStep(lesson, index)).join('')}
            </div>
        </div>
    `;
}

    _getTimelineProgress(data) {
        const lessons = Array.isArray(data.lessons) ? data.lessons : [];
        const total = lessons.length;
        if (total === 0) {
            return '0%';
        }

        const activeStatuses = ['in-progress', 'confirmed', 'ongoing', 'no-show'];
        const completedCount = lessons.filter(lesson => lesson.status === 'completed').length;
        const activeIndex = lessons.findIndex(lesson => activeStatuses.includes(lesson.status));

        if (activeIndex !== -1) {
            const progress = total === 1 ? 100 : (activeIndex / (total - 1)) * 100;
            return `${progress.toFixed(1)}%`;
        }

        if (completedCount > 0) {
            const progress = total === 1 ? 100 : (completedCount / (total - 1)) * 100;
            return `${progress.toFixed(1)}%`;
        }

        return '0%';
    }

    _createLessonStep(lesson, index) {
    const lessonDateLabel = this._formatLessonDate(lesson.date);
    const lessonTimeLabel = this._formatLessonTimeRange(lesson);

    const isCompleted = lesson.status === 'completed';
    const isCurrent = lesson.status === 'in-progress';
    const isPending = lesson.status === 'pending';
    const isConfirmed = lesson.status === 'confirmed';
    const isOngoing = lesson.status === 'ongoing';
    const isMissed = lesson.status === 'no-show';

    let circleClass = 'pending';
    let iconContent = lesson.id;

    if (isCompleted) {
        circleClass = 'completed';
        iconContent = `<i class="bi bi-check-lg"></i>`;
    }

    if (isCurrent) {
        circleClass = 'current';
    }

    if (isConfirmed) {
        circleClass = 'confirmed';
    }

    if (isOngoing) {
        circleClass = 'ongoing';
    }

    if (isMissed) {
        circleClass = 'no-show';
        iconContent = `<i class="bi bi-x-lg"></i>`;
    }

    let badgeClass = 'badge-pending';

    switch (lesson.status) {
        case 'completed':
            badgeClass = 'badge-completed';
            break;

        case 'in-progress':
            badgeClass = 'badge-progress';
            break;

        case 'confirmed':
            badgeClass = 'badge-confirmed';
            break;

        case 'ongoing':
            badgeClass = 'badge-ongoing';
            break;

        case 'no-show':
            badgeClass = 'badge-noshow';
            break;
    }

    const sessionCircle = lesson.hasSchedule
        ? `
            <button type="button" class="step-circle ${circleClass} session-step-button" data-session-step-index="${index}" aria-label="View ${lesson.title} schedule details">
                ${iconContent}

                ${isCurrent ? `
                    <span class="current-label">
                        Current
                    </span>
                ` : ''}
            </button>
        `
        : `
            <div class="step-circle ${circleClass}">
                ${iconContent}

                ${isCurrent ? `
                    <span class="current-label">
                        Current
                    </span>
                ` : ''}
            </div>
        `;

    return `
        <div class="text-center step-wrapper">

            ${sessionCircle}

            <div class="lesson-title">
                ${lesson.title}
            </div>

            ${lessonDateLabel ? `
                <div class="lesson-date">
                    ${lessonDateLabel}
                </div>
            ` : ''}

            <div class="lesson-duration">
                ${lessonTimeLabel}
            </div>

            <div class="lesson-badge ${badgeClass}">
                ${lesson.status.replace('-', ' ')}
            </div>

        </div>
    `;
}

    _attachSessionStepListeners(data, container) {
        const lessons = Array.isArray(data.lessons) ? data.lessons : [];

        container.querySelectorAll('[data-session-step-index]').forEach(button => {
            button.addEventListener('click', () => {
                const lesson = lessons[Number(button.dataset.sessionStepIndex)];
                if (!lesson || !lesson.hasSchedule) return;
                this.openScheduleDetailModal(lesson);
            });
        });
    }

    _getLastScheduledDateFromCurrentData() {
        const lessons = Array.isArray(this.currentSessionData?.lessons) ? this.currentSessionData.lessons : [];
        return lessons
            .map(lesson => lesson?.date || '')
            .filter(Boolean)
            .sort()
            .pop() || '';
    }

    openScheduleDetailModal(schedule) {
        const actions = this.isScheduleManagerView
            ? getManagerScheduleModalActions(schedule.status, {
                canEdit: this.canEditSession,
                canReschedule: true
            })
            : getStudentScheduleModalActions(schedule.status);

        openScheduleDetailsModal({
            schedule,
            actions,
            formatTime: value => this.formatTime(value),
            showCenter: this.isScheduleManagerView && !this.isTeacherView,
            personLabel: this.isScheduleManagerView ? 'Student' : 'Teacher',
            personValue: this.isScheduleManagerView ? schedule.student : schedule.teacher,
            showTeacher: this.isScheduleManagerView && !this.isTeacherView
        }).then(({ action }) => {
            if (['no-show', 'ongoing', 'done'].includes(action)) {
                this.updateScheduleStatus(schedule.preference_id, schedule.enrollment_details_id, schedule.date, action);
                return;
            }

            if (action === 'confirm') {
                this.confirmSchedule(schedule);
                return;
            }

            if (action === 'reschedule') {
                openRescheduleModal({
                    ...schedule,
                    last_session_date: this._getLastScheduledDateFromCurrentData() || schedule.last_session_date || schedule.date
                }, () => {
                    this.loadSessionByEnrollment(this.currentEnrollmentId);
                }, {
                    isAdminAction: this.isScheduleManagerView
                });
            }
        });
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
            if (['done', 'ongoing'].includes(newStatus) && this.isTeacherView) {
                const isStarting = newStatus === 'ongoing';
                Swal.fire({
                    title: isStarting ? 'Starting Session...' : 'Completing Session...',
                    text: isStarting
                        ? 'Please wait while the session is started and the email is sent.'
                        : 'Please wait while the session is marked as done and the email is sent.',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });
            }

            let endpoint = this.scheduleUpdateEndpoint || '../../api/admin/schedule.php';
            if (this.isTeacherView && newStatus === 'done') {
                endpoint = '../../api/done_session.php';
            } else if (this.isTeacherView && newStatus === 'ongoing') {
                endpoint = '../../api/ongoing.php';
            }
            const response = await axios.post(endpoint, payload);

            if (response.data.status === 'success') {
                const alreadyProcessed = response.data.already_done || response.data.already_ongoing;
                const emailFailed = ['done', 'ongoing'].includes(newStatus)
                    && response.data.email_sent === false
                    && !alreadyProcessed;
                const successTitle = newStatus === 'done'
                    ? 'Session Done'
                    : (newStatus === 'ongoing' ? 'Session Started' : 'Status Updated');
                Swal.fire({
                    icon: emailFailed ? 'warning' : 'success',
                    title: successTitle,
                    text: response.data.message || `Schedule status changed to ${newStatus}.`,
                    timer: emailFailed ? undefined : 2000,
                    timerProgressBar: true
                }).then(() => {
                    this.loadSessionByEnrollment(this.currentEnrollmentId);
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: response.data.message || 'Failed to update status'
                });
            }
        } catch (error) {
            console.error('Error updating schedule status:', error);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: error.response?.data?.message || 'Network error occurred'
            });
        }
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
                Swal.fire({
                    icon: 'success',
                    title: 'Schedule Confirmed!',
                    text: 'Your session has been confirmed. The teacher has been notified.',
                    confirmButtonText: 'OK'
                }).then(() => {
                    this.loadSessionByEnrollment(this.currentEnrollmentId);
                });
            } else {
                console.error('Confirmation response:', html);
                Swal.fire({
                    icon: 'error',
                    title: 'Confirmation Failed',
                    text: 'Unable to confirm the schedule. Please try again or contact support.'
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

    formatTime(time24) {
        if (!time24) return '';
        const [hours, minutes] = time24.split(':');
        const hourNum = parseInt(hours, 10);
        if (Number.isNaN(hourNum)) return time24;
        const suffix = hourNum >= 12 ? 'PM' : 'AM';
        const normalizedHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
        return `${normalizedHour}:${minutes} ${suffix}`;
    }

    _formatLessonDate(dateValue) {
        if (!dateValue) return '';

        const match = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
            const [, year, month, day] = match;
            const date = new Date(Number(year), Number(month) - 1, Number(day));
            return date.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric'
            });
        }

        return String(dateValue);
    }

    _formatLessonTimeRange(lesson) {
        if (lesson?.time && lesson?.endTime) {
            return `${this.formatTime(lesson.time)} - ${this.formatTime(lesson.endTime)}`;
        }

        return lesson?.duration || 'TBD';
    }

    capitalizeStatus(status) {
        if (!status) return 'Pending';
        if (status === 'no-show') return 'No-show';
        return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    normalizeStatus(status) {
        return String(status || '').trim().toLowerCase();
    }

    _getScheduleUpdateEndpoint() {
        const path = this.pathname || window.location.pathname;

        if (path.includes('/teacher/')) {
            return '../../api/admin/schedule.php';
        }

        if (path.includes('/branch_admin/')) {
            return '../../api/admin/branch_schedule.php';
        }

        if (path.includes('/owner/')) {
            return '../../api/admin/owner_schedule.php';
        }

        if (path.includes('/secretary/')) {
            return '../../api/admin/secetary_schedule.php';
        }

        return null;
    }

    _getInitialEnrollmentId() {
        const params = new URLSearchParams(window.location.search);
        const enrollmentId = Number(params.get('enrollment_details_id'));
        return Number.isInteger(enrollmentId) && enrollmentId > 0 ? enrollmentId : null;
    }

    _createDetailsSection(data) {
        return `
            <div class="card shadow-sm border-0 p-4">
                <h5 class="fw-bold mb-4">Session Details</h5>
                <div class="row g-4">
                    <div class="col-md-4">
                        <div class="d-flex gap-3 mb-3">
                            <i class="bi bi-calendar-event fs-4 text-muted"></i>
                            <div><div class="text-muted small">Date</div><strong>${data.startDate}</strong></div>
                        </div>
                        <div class="d-flex gap-3">
                            <i class="bi bi-clock fs-4 text-muted"></i>
                            <div><div class="text-muted small">Time</div><strong>${data.timeRange}</strong></div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="d-flex gap-3 mb-3">
                            <i class="bi bi-hourglass-split fs-4 text-muted"></i>
                            <div><div class="text-muted small">Duration</div><strong>${data.totalDuration}</strong></div>
                        </div>
                        <div class="d-flex gap-3">
                            <i class="bi bi-file-text fs-4 text-muted"></i>
                            <div><div class="text-muted small">Description</div><p class="mb-0 small">${data.description}</p></div>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="mb-3">
                             <div class="text-muted small mb-1">Instructor</div>
                             <strong>${data.instructor}</strong>
                        </div>
                        <div>
                             <div class="text-muted small mb-1">Tags</div>
                             ${data.tags.map(tag => `<span class="badge bg-danger-subtle text-danger me-1">${tag}</span>`).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

_getStatusBadgeClass(status) {
        const classes = {
            'completed': 'bg-success-subtle text-success',            'no-show': 'bg-secondary-subtle text-secondary',            'in-progress': 'bg-primary-subtle text-primary',
            'pending': 'bg-light text-muted',
            'confirmed': 'bg-info-subtle text-info',
            'ongoing': 'bg-warning-subtle text-warning'
        };
        return classes[status] || 'bg-light';
    }
}
