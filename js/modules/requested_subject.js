import { buildAppUrl } from '../utilities/app_url.js';

export async function saveRequestedSubject(rawName, subjects = []) {
    const name = String(rawName || '').replace(/\s+/gu, ' ').trim();
    if (!name || Array.from(name).length > 100) {
        throw new Error('Requested subject must contain 1 to 100 characters.');
    }
    const existing = subjects.find(subject => String(subject.subject_name || '').trim().toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const response = await axios.post(buildAppUrl('api/admin/subject.php'), {
        operation: 'addSubject', json: JSON.stringify({ subject_name: name })
    });
    const result = response.data;
    if (result?.status !== 'success' || !Number.isInteger(Number(result.subject_id)) || Number(result.subject_id) <= 0) {
        throw new Error(result?.message || 'Unable to save the requested subject.');
    }
    const subject = { subject_id: result.subject_id, subject_name: result.subject_name || name };
    if (!subjects.some(item => String(item.subject_id) === String(subject.subject_id))) subjects.push(subject);
    return subject;
}
