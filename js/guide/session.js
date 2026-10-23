import { startTour } from './tour.js?v=20261023-session-guides';

export function getSessionGuide({ student, tracking = false }) {
    return [
        { target: '.session-dashboard-header', title: student ? 'Your tutorial sessions' : 'Student tutorial sessions', description: 'Follow a tutorial enrollment from its scheduled meetings through completion. Choose an enrollment first, then review its progress and open individual meetings for more detail.' },
        { target: '.session-dashboard-total', title: 'Available enrollments', description: 'This is the number of tutorial enrollments loaded for your account. The Session page includes enrolled and completed tutorial enrollments.' },
        { target: '#session-search', title: 'Search for an enrollment', description: 'Search by student, program, subject, center, or teacher. The matching enrollments appear in the enrollment selector. Clear Search to restore the list.' },
        { target: '#session-status-filter', title: 'Filter enrollment status', description: 'Choose Enrolled, Completed, or both. This filters enrollment records; the individual meeting statuses appear separately in the timeline.' },
        { target: '#session-filter-count', title: 'Check your search results', description: 'This count updates with your search and status filter. If nothing matches, clear the search or select both enrollment statuses.' },
        { target: '#enrollment-selector', title: 'Choose the enrollment to review', description: 'Select an enrollment to load its program, teacher, progress, and meetings below. Check this selection before taking any meeting action.' },
        { target: '.session-filter-empty', title: 'No matching enrollments', description: 'No enrollment matches the current filters. After this guide, clear Search or change the status filter to find another enrollment.' },
        { target: '[data-session-guide="overview"]', title: 'Confirm the selected tutorial', description: 'Review the tutorial title, description, and category. The summary belongs to the enrollment currently selected above.' },
        { target: '[data-session-guide="metadata"]', title: 'Lesson and teacher summary', description: 'See the current lesson out of the package total, the recorded start information, and the regular teacher. A substitute for one meeting is shown separately on that meeting.' },
        { target: '[data-session-guide="overall-progress"]', title: 'Overall completion', description: 'The percentage and progress bar summarize progress through this enrollment. Check the timeline’s status badges to distinguish completed meetings from no-shows; the percentage alone does not confirm attendance.' },
        { target: '.session-progress-summary', title: 'Meetings and package sessions', description: tracking ? 'Review the lesson count and total scheduled duration for the selected tutorial enrollment.' : 'Review the meeting count and scheduled duration. Consecutive slots on the same date with matching teacher and access details can appear as one meeting, so the meeting count can differ from the number of package sessions.' },
        { target: '.lesson-timeline-container', title: 'Follow the session timeline', description: 'Read the meetings in order. Each entry shows a session number or range, date, time, duration, status, and assigned teacher when a schedule exists. Scroll horizontally if more meetings extend beyond the screen.' },
        { target: '.step-content:has(.lesson-date)', title: 'Check the meeting schedule', description: 'Use the date and time range to identify the correct meeting. Duration describes that meeting; the total duration above summarizes the scheduled tutorial.' },
        { target: '.lesson-badge', title: 'Understand meeting statuses', description: 'Pending awaits confirmation or handling. Confirmed records confirmation. Ongoing means started; completed means finished. No-show records a missed meeting. An entry without a schedule has no details button yet.' },
        { target: '.lesson-teacher', title: 'Who teaches this meeting?', description: 'Check the teacher listed for this specific meeting. A Substitute badge identifies a temporary teacher; the enrollment summary continues to show the regular teacher.' },
        { target: '.session-step-button', title: 'Open a meeting and its detailed guide', description: 'After finishing this tour, select a numbered meeting circle to open Schedule Details. Use Guide inside that dialog for a separate walkthrough of its fields and the actions available for that meeting.' },
        { target: '[data-session-guide="details"]', title: 'Enrollment session details', description: 'This section summarizes the enrollment’s date, time range, total duration, description, regular teacher, and tags. Open a meeting circle for its specific schedule and status.' },
        { target: '#session-content > .alert', title: 'Session availability', description: 'Read this message if the selected enrollment has no scheduled meetings or its details could not be loaded. An empty schedule does not mean the tutorial has been completed.' },
        { target: '[data-session-guide="details"] .col-md-4:last-child', title: 'Regular teacher and tags', description: 'Use the regular teacher and tags to recognize the tutorial. For temporary teaching arrangements, check the teacher shown on the individual meeting.' },
        { target: '#session-content a[href*="reenroll=1"]', title: 'Continue with a new enrollment', description: 'When all your sessions are completed, Re-enroll opens a new enrollment request with the program selected. Review and submit that request separately.' },
        { target: '.main-content > .alert', title: 'No sessions to display', description: 'There are currently no eligible tutorial enrollments to display, or the page could not load them. Read the message here before trying again.' },
        { target: '.header-profile-button', title: 'Replay the Session guide', description: 'Open your profile menu and choose Guide whenever you need this walkthrough. For meeting actions, open a numbered meeting and choose its Guide button.' }
    ];
}

export function startSessionDetailsGuide(modal, options, returnFocus) {
    const tile = name => `.tc-detail-popup [data-session-detail="${name}"]`;
    const steps = [
        { target: '.tc-detail-popup .tc-detail-title', title: 'This meeting’s schedule details', description: 'Review the selected meeting before choosing an action. Available buttons depend on its status, your account permissions, and whether you can manage this meeting.' },
        { target: '.tc-detail-popup .tc-detail-feature', title: 'Scheduled time range', description: 'This is the start and end time of the selected meeting. Consecutive slots may be grouped into one meeting with a combined time range.' },
        { target: tile('duration'), title: 'Meeting duration', description: 'This duration is calculated from this meeting’s start and end times. TBA means a valid duration is not available.' },
        { target: tile('day'), title: 'Day of the week', description: 'Check the meeting’s scheduled weekday along with its full date.' },
        { target: tile('registered'), title: 'Scheduled date', description: 'The Registered field displays the scheduled date of this meeting. Confirm the date and time together before starting or rescheduling.' },
        { target: tile('center'), title: 'Meeting center', description: 'Check which tutorial center this meeting belongs to.' },
        { target: tile('location'), title: 'Center location', description: 'Use this location to confirm where the meeting takes place. N/A means a location has not been supplied.' },
        { target: tile('subject'), title: 'Tutorial subject', description: 'Confirm that this is the subject you intend to review.' },
        { target: tile('student'), title: 'Student for this meeting', description: 'Verify the student’s name before changing any meeting status.' },
        { target: `${tile('teacher')}, ${tile('teacher-for-this-session')}`, title: 'Assigned meeting teacher', description: 'This is the teacher assigned to this meeting. When a substitute is assigned, check the regular and substitute teacher fields below as well.' },
        { target: tile('program'), title: 'Enrollment program', description: 'Review the program associated with this meeting and subject.' },
        { target: tile('status'), title: 'Current meeting status', description: 'This status determines which actions are offered. Starting changes a meeting to ongoing; Done completes it. No-show records a missed meeting, while student confirmation records acceptance of the schedule.' },
        { target: tile('notification'), title: 'Notification status', description: 'Sent or Pending reports the notification flag recorded for this schedule. This is separate from confirmation and attendance.' },
        { target: tile('regular-teacher'), title: 'Regular teacher', description: 'This is the enrollment’s regular teacher. Assigning a substitute covers a specific meeting.' },
        { target: tile('substitute-for-this-session'), title: 'Substitute coverage', description: 'Review the substitute assigned to this meeting, or None assigned when no temporary teacher is recorded.' },
        { target: tile('substitute-reason'), title: 'Reason for the substitute', description: 'Review the recorded explanation for this meeting’s temporary teacher arrangement.' },
        { target: '#assign-session-substitute', title: 'Assign or change a substitute', description: 'After the tour, this opens the substitute selection form. Review the teacher and reason before saving. This control is offered to eligible staff for pending or confirmed meetings.' },
        { target: '#remove-session-substitute', title: 'Remove substitute coverage', description: 'Use this when the meeting should return to its regular teacher. Review the confirmation before applying the change.' }
    ];
    const explanations = {
        ongoing: ['Start this meeting', 'Start Session changes the meeting to ongoing. It is enabled only during the scheduled time window using your device’s local clock. Earlier meetings must be completed or recorded as no-show before this meeting can start.'],
        done: ['Complete this meeting', 'After the session is finished, Done records completion. Check the selected student, date, and meeting range first; a grouped meeting can include several package slots.'],
        'no-show': ['Record a missed meeting', 'No-show records that this meeting was missed. Earlier meetings must be completed or recorded as no-show first. Review the confirmation before saving the status.'],
        'correct-no-show': ['Correct a no-show record', 'This opens a correction form for authorized staff. Choose ongoing or completed as appropriate, then review and save the correction. Saving also triggers a correction email.'],
        confirm: ['Confirm the schedule', 'Confirm records your acceptance of this pending meeting’s schedule. Check its date, time, and teacher first.'],
        reschedule: ['Request a different schedule', 'Reschedule opens the scheduling form. Review available dates, times, and teacher availability before submitting; opening the form alone does not change this meeting.']
    };
    for (const [button, action] of Object.entries(options.actions || {})) {
        if (!action.visible || !explanations[action.action]) continue;
        const [title, description] = explanations[action.action];
        steps.push({ target: `.tc-detail-popup .swal2-${button}`, fallback: '.tc-detail-popup .tc-detail-actions', title, description, fallbackDescription: `${description} A disabled button is currently unavailable; check the status and time notice.` });
    }
    steps.push(
        { target: '#session-start-time-notice', title: 'When Start becomes available', description: 'This notice explains why Start is unavailable before the scheduled start, after the end time, or when schedule details are invalid. Check your device’s date and time if the displayed availability seems incorrect.' },
        { target: '.tc-detail-popup .tc-detail-close', title: 'Return to the timeline', description: 'Finish or skip this guide to return to these details. Use the × button to close the dialog and choose another meeting. The tour itself does not confirm, reschedule, or update a meeting.' }
    );
    startTour(steps, returnFocus);
}
