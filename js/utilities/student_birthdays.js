export function birthdayToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
}

export function birthdayPeriod(period, today) {
    if (period === 'year') return { start: new Date(today.getFullYear(), 0, 1), end: new Date(today.getFullYear(), 11, 31) };
    if (period === 'month') return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 1, 0) };
    if (period === 'week') {
        const start = addDays(today, -((today.getDay() + 6) % 7));
        return { start, end: addDays(start, 6) };
    }
    return { start: today, end: today };
}

export function birthdayRows(rows, period, today) {
    const { start, end } = birthdayPeriod(period, today);
    const students = new Map();
    rows.forEach(row => {
        const value = String(row.birthday || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
        const birth = parseDate(value);
        if (dateKey(birth) !== value || birth > today) return;
        let occurrenceYear = today.getFullYear();
        let occurrence;
        if (period === 'year' || period === 'month') {
            if (period === 'month' && birth.getMonth() !== today.getMonth()) return;
            // Keep February 29 students in the year/month view even in non-leap years.
            occurrence = `${occurrenceYear}-${value.slice(5)}`;
        } else {
            for (let year = start.getFullYear(); year <= end.getFullYear(); year++) {
                const date = new Date(year, birth.getMonth(), birth.getDate());
                if (date.getMonth() === birth.getMonth() && date.getDate() === birth.getDate() && date >= start && date <= end && date >= birth) {
                    occurrence = dateKey(date);
                    occurrenceYear = year;
                    break;
                }
            }
            if (!occurrence) return;
        }
        const existing = students.get(String(row.student_id));
        if (existing) {
            existing.centers.add(row.branch_name || 'Unassigned Center');
        } else {
            students.set(String(row.student_id), {
                ...row, birth, occurrence, age: occurrenceYear - birth.getFullYear(),
                isToday: value.slice(5) === dateKey(today).slice(5),
                centers: new Set([row.branch_name || 'Unassigned Center'])
            });
        }
    });
    return [...students.values()].sort((a, b) => a.occurrence.localeCompare(b.occurrence) || String(a.student_name).localeCompare(String(b.student_name)));
}

function addDays(date, amount) { const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; }
function parseDate(value) { const [year, month, day] = String(value).split('-').map(Number); return new Date(year, month - 1, day); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
