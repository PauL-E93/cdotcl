export function initEnrollmentDatePicker(options = {}) {
    const dateInputId = options.dateInputId || 'schedDateInput';
    const hiddenDateId = options.hiddenDateId || 'schedDate';
    const containerId = options.containerId || 'dateCalendarContainer';
    const startTimeId = options.startTimeId || 'schedTime';
    const endTimeId = options.endTimeId || 'schedEndTime';
    const teacherSelectId = options.teacherSelectId || 'preferredTeacher';
    const validateCallback = options.validateCallback || window.validateTeacherDateSelection;
    const parseTimeToMinutes = options.parseTimeToMinutes || window.parseTimeToMinutes;
    const containerMaxWidth = options.containerMaxWidth || '350px';

    const dateInput = document.getElementById(dateInputId);
    const hiddenDate = document.getElementById(hiddenDateId);
    const container = document.getElementById(containerId);
    if (!dateInput || !hiddenDate || !container) return;

    if (!window.__enrollmentDatePickerInstances) {
        window.__enrollmentDatePickerInstances = new Map();
    }

    const instanceKey = `${dateInputId}|${hiddenDateId}|${containerId}`;
    const existingInstance = window.__enrollmentDatePickerInstances.get(instanceKey);
    if (
        existingInstance
        && existingInstance.dateInput === dateInput
        && existingInstance.hiddenDate === hiddenDate
        && existingInstance.container === container
    ) {
        if (container.style.display === 'block') {
            renderCalendar();
        }
        return;
    }
    // SweetAlert replaces the edit form DOM each time it opens. Re-bind when
    // the IDs are the same but the actual input elements are new.
    window.__enrollmentDatePickerInstances.set(instanceKey, { dateInput, hiddenDate, container });

    let selectedDate = null;
    let currentDate = new Date();
    let currentYear = currentDate.getFullYear();
    let currentMonth = currentDate.getMonth();

    // Container Styling
    container.style.display = 'none';
    container.style.position = 'absolute';
    container.style.top = '100%';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.maxWidth = containerMaxWidth;
    container.style.boxSizing = 'border-box';
    container.style.background = 'transparent';
    container.style.zIndex = '1100';

    dateInput.readOnly = true;
    dateInput.style.cursor = 'pointer';
    dateInput.addEventListener('click', (e) => {
        e.stopPropagation();
        container.style.display = container.style.display === 'block' ? 'none' : 'block';
        if (container.style.display === 'block') {
            renderCalendar();
        }
    });

    container.addEventListener('click', (e) => e.stopPropagation());

    function renderCalendar() {
        const teacherAvailableDates = window.teacherAvailableDates || [];
        const teacherSelect = document.getElementById(teacherSelectId);
        const hasTeacherSelected = Boolean(teacherSelect?.value);
        const year = currentYear;
        const month = currentMonth;
        
        // Calculate calendar layout
        const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

        const monthLabel = new Date(year, month).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });

        const unrestrictedSelection = !hasTeacherSelected;

        let html = `
            <div class="card shadow-lg border-0 rounded-4" style="background:#ffffff; overflow: hidden; font-family: sans-serif;">
                <div class="card-header d-flex justify-content-between align-items-center p-3 bg-white border-0">
                    <button class="btn btn-link text-dark p-0 fw-bold" type="button" id="prevMonth" style="text-decoration:none; font-size: 1.2rem;">‹</button>
                    <span id="monthYear" class="fw-bold text-dark" style="font-size: 1.1rem;">${monthLabel}</span>
                    <button class="btn btn-link text-dark p-0 fw-bold" type="button" id="nextMonth" style="text-decoration:none; font-size: 1.2rem;">›</button>
                </div>
                <div class="card-body px-3 pb-3 pt-0">
                    <div class="d-grid mb-2" style="display: grid !important; grid-template-columns: repeat(7, minmax(0, 1fr)); text-align: center; font-size: 0.75rem; color: #adb5bd; font-weight: 600; text-transform: uppercase;">
                        <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                    </div>
                    
                    <div id="calendarNotice" class="text-center text-muted mb-3" style="font-size: 0.75rem; min-height: 18px;">
                        ${unrestrictedSelection ? 'Choose any future date. Teacher availability will update after you select a teacher.' : 'Blue: Full | Orange: Partial Availability'}
                    </div>

                    <div id="calendarDays" class="d-grid" style="display: grid !important; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: 48px; grid-auto-flow: row; row-gap: 10px; column-gap: 6px; justify-items: center; align-items: center; width: 100%;"></div>
                    
                    <div class="mt-4 pt-3 border-top text-center" style="color: #4A90E2; font-size: 0.85rem; font-weight: 500;">
                         Today: ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;
        const daysContainer = document.getElementById('calendarDays');
        let calendarHtml = '';

        // 1. Padding for previous month days
        for (let i = 0; i < firstDayOfMonth; i++) {
            calendarHtml += `<div style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;"></div>`;
        }

        // 2. Build the days
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dateObj = new Date(year, month, day);
            const isPast = dateObj.getTime() < todayStart;
            const isAvailable = unrestrictedSelection ? !isPast : teacherAvailableDates.includes(dateStr);
            const isSelected = selectedDate === dateStr;

            // Determine Partial Availability (Orange) vs Full (Blue)
            let isPartial = false;
            if (isAvailable && window.teacherAvailableSlotsPerDate && window.teacherFullShiftsPerDate) {
                const available = window.teacherAvailableSlotsPerDate[dateStr];
                const full = window.teacherFullShiftsPerDate[dateStr];
                if (full && available && typeof parseTimeToMinutes === 'function') {
                    const fullMin = Number.isFinite(Number(full.totalMinutes))
                        ? Number(full.totalMinutes)
                        : parseTimeToMinutes(full.end) - parseTimeToMinutes(full.start);
                    const availMin = available.reduce((sum, a) => sum + (parseTimeToMinutes(a.end) - parseTimeToMinutes(a.start)), 0);
                    isPartial = availMin < fullMin;
                }
            }

            // Styling logic
            let color = isPast ? '#dee2e6' : '#212529';
            let bgColor = 'transparent';
            let cursor = (isAvailable && !isPast) ? 'pointer' : 'default';

            if (isAvailable && !isPast) {
                color = isPartial ? '#ff8c00' : '#0d6efd';
                if (isSelected) {
                    bgColor = isPartial ? '#ff8c00' : '#0d6efd';
                    color = '#ffffff';
                }
            }

            calendarHtml += `
                <div class="day-cell ${isAvailable && !isPast ? 'clickable' : ''}" 
                     data-date="${dateStr}" 
                     style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; 
                            border-radius: 50%; cursor: ${cursor}; font-weight: ${isAvailable ? '600' : '400'}; 
                            background-color: ${bgColor}; color: ${color}; transition: background 0.2s;">
                    ${day}
                </div>`;
        }

        const totalCells = firstDayOfMonth + daysInMonth;
        const trailingCells = (7 - (totalCells % 7)) % 7;
        for (let i = 0; i < trailingCells; i++) {
            calendarHtml += `<div style="width: 36px; height: 36px;"></div>`;
        }

        daysContainer.innerHTML = calendarHtml;

        // Navigation listeners
        document.getElementById('prevMonth').onclick = (e) => { e.stopPropagation(); changeMonth(-1); };
        document.getElementById('nextMonth').onclick = (e) => { e.stopPropagation(); changeMonth(1); };

        // Selection listener
        daysContainer.querySelectorAll('.clickable').forEach(dayEl => {
            dayEl.onclick = () => {
                const date = dayEl.dataset.date;
                selectedDate = date;
                dateInput.value = new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                hiddenDate.value = date;
                container.style.display = 'none';

                if (typeof validateCallback === 'function') {
                    validateCallback();
                }

                // Handle Time Slot updates
                if (window.teacherAvailableSlotsPerDate && window.teacherAvailableSlotsPerDate[date]) {
                    const available = window.teacherAvailableSlotsPerDate[date];
                    if (available.length > 0) {
                        const timeInput = document.getElementById(startTimeId);
                        const endTimeInput = document.getElementById(endTimeId);
                        // Auto-select the first available range
                        if (timeInput) timeInput.value = available[0].start;
                        if (endTimeInput) endTimeInput.value = available[0].end;
                    }
                }
            };
        });
    }

    function changeMonth(direction) {
        currentMonth += direction;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        else if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar();
    }

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target) && !dateInput.contains(e.target)) {
            container.style.display = 'none';
        }
    });
}

window.setupDatePicker = initEnrollmentDatePicker;  
