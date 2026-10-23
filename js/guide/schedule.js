// The calendars share these controls; missing or restricted targets are skipped.
export function getScheduleGuide({ role, can, canOpenSessions }) {
    const student = role === 'student';
    const weeklySchedule = ['owner', 'secretary', 'teacher'].includes(role);
    const searchDescription = student
        ? 'Search by subject or teacher to narrow your schedules. Clear the search to see them again.'
        : 'Search for a schedule using the details shown on this page, such as a student name or ID. Clear the search to see the available schedules again.';

    return [
        { target: '.page-title', title: 'Your schedule page', description: student ? 'Review your scheduled classes here. This tour shows how to find a schedule, choose a date, and read its details.' : 'Use this page to find schedules, browse the calendar, and review the schedule log. This tour follows the controls available to your account.' },
        { target: '#search-input', title: 'Find a schedule', description: searchDescription },
        {
            target: '.top-bar .btn-add',
            available: () => can('create'),
            title: 'Add a schedule',
            description: weeklySchedule
                ? (role === 'teacher' ? 'Use Add Schedule to open your weekly employee schedule and set your working times.' : 'Use Add Schedule to choose an employee and open their weekly schedule to set working times.')
                : 'Use Add Schedule to open the scheduling form. Review the required details before saving.'
        },
        { target: '.filter-container', title: 'Filter your schedules', description: student ? 'Use the available status, subject, teacher, and enrollment type filters to narrow your schedules. On a small screen, use Filter & Sort to show the filters.' : 'Use the available filters to narrow schedules by status, center, or teacher. On a small screen, use Filter & Sort to show the filters.' },
        { target: '#schedule-status-filter', available: () => student, title: 'Choose a meeting status', description: 'Choose a status to narrow the calendar and schedule log, or choose all statuses to see the available schedules again.' },
        { target: '#schedule-subject-filter', available: () => student, title: 'Choose a subject', description: 'Filter schedules by subject when you have more than one tutorial or class.' },
        { target: '#schedule-teacher-filter', available: () => student, title: 'Choose a teacher', description: 'Choose a teacher to focus the calendar on that teacher’s classes.' },
        { target: '#schedule-type-filter', available: () => student, title: 'Tutorial or preschool schedules', description: 'Use the enrollment type filter to distinguish tutorial appointments from preschool or play school class schedules.' },
        { target: '.apply-filters-btn', title: 'Apply your filters', description: 'Use Apply Filters to refresh the schedule using your current search and filter selections.' },
        { target: '.schedule-type-legend', title: 'Schedule colors', description: 'Use this legend to distinguish Tutorial schedules from Preschool / Play School schedules.' },
        { target: '.calendar-header', title: 'Browse the months', description: 'The heading shows the displayed month and year. Use the left and right arrows to move to the previous or next month.' },
        { target: '#calendar-grid', title: 'Your monthly calendar', description: 'Review the dates and schedule entries for the displayed month. Some dates show a + more label when there are additional schedules.' },
        { target: '.calendar-day.has-schedule', fallback: '.calendar-day:not(.empty)', title: 'Choose a date', description: 'After the tour, select a date to show its schedules in the schedule log. A date with several schedules may only preview the first entry in the calendar.', fallbackDescription: 'Select a date to review its schedule log. If there are no schedules for that date, the log will show an empty message. Try another date or adjust your filters.' },
        { target: '#notif-content', title: 'Read the schedule log', description: 'This log shows schedules for the selected date. Review the times, class details, and status here. Scroll inside the log when there are more records.' },
        { target: '.schedule-log-card', title: 'Open schedule details', description: 'After the tour, select a schedule card to open its details. Any actions shown there depend on your account and the schedule\'s status.' },
        { target: '.schedule-log-card', available: () => student, title: 'Confirm or reschedule a tutorial', description: 'In the details, Confirm is available for eligible pending appointments. Reschedule appears when that schedule permits changes. Recurring section schedules can have different actions; review the displayed buttons and dates before submitting.' },
        { target: '.owner-schedule-session, .teacher-schedule-session, .branch-schedule-session, .student-schedule-session, .schedule-log-card [title="Open Session"]', available: canOpenSessions, title: 'Open the session', description: 'Use this shortcut to open the session associated with this schedule.' },
        { target: '.schedule-log-card [title="Send Notification"]', title: 'Send a schedule reminder', description: 'Use the envelope on a schedule card to start sending an email reminder for that schedule. Review the confirmation before sending.' },
        { target: '#owner-notify-all, #teacher-notify-all, #branch-notify-all', title: 'Notify the schedule log', description: 'Use this envelope to start sending email reminders for unfinished schedules in the selected date\'s log. Review the confirmation before sending.' },
        { target: '.header-profile-button', title: 'Replay this guide', description: 'Open your profile menu > Guide whenever you want to review this walkthrough. The tour does not change your dates, filters, or schedules.' }
    ];
}
