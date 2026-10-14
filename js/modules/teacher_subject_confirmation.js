export function updateTeacherSubjectNotice(select, notice) {
    if (!select || !notice) return;
    const selected = select.selectedOptions?.[0];
    const names = JSON.parse(selected?.dataset.unassignedSubjects || '[]');
    const key = `${select.value}:${JSON.stringify(names)}`;
    if (notice.dataset.confirmationKey === key) return;
    notice.dataset.confirmationKey = key;
    notice.replaceChildren();
    notice.classList.toggle('d-none', names.length === 0);
    if (!names.length) return;
    const message = document.createElement('p');
    message.className = 'mb-2';
    message.textContent = `Subject alignment needs confirmation: ${names.join(', ')}. No active teacher is assigned to these subjects for this program and center. This teacher meets the other selected subject and schedule filters.`;
    const label = document.createElement('label');
    label.className = 'd-flex align-items-start gap-2';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input';
    checkbox.dataset.subjectConfirmation = 'true';
    const text = document.createElement('span');
    text.textContent = 'I have confirmed that this teacher can handle the requested subjects.';
    label.append(checkbox, text);
    notice.append(message, label);
}

export function teacherSubjectConfirmationRequired(select, notice) {
    if (!select?.value) return false;
    const names = JSON.parse(select.selectedOptions?.[0]?.dataset.unassignedSubjects || '[]');
    return names.length > 0 && !notice?.querySelector('[data-subject-confirmation]')?.checked;
}
