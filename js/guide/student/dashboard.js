import { getDashboardGuide } from '../admin/dashboard.js';

export function getStudentDashboardGuide() {
    const shared = getDashboardGuide();
    return [
        { target: '.page-title', title: 'Welcome to your student dashboard', description: 'Start here to check today’s classes, upcoming schedules, enrollments, and completed tutorial sessions. This guide also introduces each page available in your navigation.' },
        { target: '#student-dashboard-search', title: 'Search today’s schedule', description: 'Search by subject or teacher to narrow today’s schedule table. This search does not filter the summary counts or the monthly calendar. Clear it to restore today’s list.' },
        { target: '.student-stat-card[data-dashboard-modal="today-classes"]', title: 'Today’s classes', description: 'This count shows classes scheduled for today. After the tour, select the card to open the list and check their times, teachers, and statuses.' },
        { target: '.student-stat-card[data-dashboard-modal="total-enrollments"]', title: 'Total enrollments', description: 'Review your enrollment total. Select this card after the tour to review the enrollment list and its available link.' },
        { target: '.student-stat-card[data-dashboard-modal="upcoming-classes"]', title: 'Upcoming classes', description: 'Check how many future classes are scheduled. Select the card to review the upcoming dates and prepare for your next class.' },
        { target: '.student-stat-card[data-dashboard-modal="completed-sessions"]', title: 'Completed sessions', description: 'This counts schedules recorded as done or completed. Open the card to review them; use the Session page for the full tutorial progress timeline.' },
        { target: '.student-schedule-table', title: 'Read today’s schedule', description: 'Review the time, subject, teacher, and status of today’s classes. An empty table means there are no matching classes for today or your current search.' },
        { target: '.student-outline-link[href="schedule.html"]', title: 'Open the full schedule', description: 'View Full Schedule takes you to the Schedule page, where you can browse dates, filter your classes, and open meeting details.' },
        { target: '.student-calendar-actions', title: 'Browse calendar months', description: 'Use the arrows to view the previous or next month. The month and year below identify the period currently displayed.' },
        { target: '#student-calendar-grid', title: 'Find scheduled dates', description: 'Dates with a dot have scheduled classes. After the tour, select a date to review that day’s schedule in a dialog, then use its link to open the Schedule page.' },
        { target: '#student-dashboard-error:not(:empty)', title: 'Dashboard loading messages', description: 'Read this message if part of your dashboard could not load. Refresh the page to try again; a failed request does not confirm that you have no classes or enrollments.' },
        ...shared.filter(step => step.navigation || ['.sidebar-toggle', '.notification-bell-button', '.header-profile-button'].includes(step.target)).map(step => {
            if (step.target === '[data-guide-nav="enrollment"]') return { ...step, description: 'Expand Enrollment to open Tutorial or Pre-school / Play-school. Review your requests, current status, and available record actions. Each page has its own Guide.' };
            if (step.target === '[data-guide-nav="payment"]') return { ...step, description: 'Expand Payment to review tutorial or preschool billing. Payment categories appear when you have an eligible enrollment in that category. Check balances, history, and submitted payments there.' };
            if (step.target === '[data-guide-nav="session"]') return { ...step, description: 'Open Session to choose a tutorial enrollment and follow its meetings and progress. Open a numbered meeting for its details and a separate meeting guide.' };
            return step;
        })
    ];
}
