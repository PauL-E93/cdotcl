const GUIDING_PRINCIPLES = [
    {
        title: 'Mission',
        text: 'To provide good customer service satisfaction. Excellent learning that will nurture a child academically, emotionally, socially, and physically. Keeping positive, harmonious, enjoyable learning and working environments.'
    },
    {
        title: 'Vision',
        text: 'To become a nationally-recognized learning center and school with a hundred of excellence teachers and students.'
    }
];

import { buildAppUrl } from '../utilities/app_url.js';

const CORE_VALUES = [
    ['C', 'Courageous'],
    ['D', 'Disciplined'],
    ['O', 'Optimistic'],
    ['T', 'Talented'],
    ['L', 'Limitless'],
    ['C', 'Courteous']
];

const ANNOUNCEMENTS = [
    { title: 'Announcement 1', text: 'Register now for our upcoming summer review sessions!' },
    { title: 'Announcement 2', text: 'Limited slots available for after-school tutorial classes.' },
    { title: 'Announcement 3', text: 'Ask us about our teacher-led enrichment workshops.' }
];

function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function resolveLandingAssetUrl(value) {
    const path = String(value || '').trim();
    if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(path)) {
        return path;
    }

    return buildAppUrl(path);
}

function createGuidingPrinciplesMarkup() {
    const principleCards = GUIDING_PRINCIPLES.map(({ title, text }) => `
        <article class="mission-vision__panel">
            <span class="mission-vision__number" aria-hidden="true">${title === 'Mission' ? '01' : '02'}</span>
            <h3>${title}</h3>
            <p>${text}</p>
        </article>
    `).join('');

    const coreValueItems = CORE_VALUES.map(([letter, value]) => `
        <li>
            <span class="core-values__letter" aria-hidden="true">${letter}</span>
            <span>${value}</span>
        </li>
    `).join('');

    return `
        ${principleCards}
        <article class="mission-vision__panel mission-vision__panel--values">
            <span class="mission-vision__number" aria-hidden="true">03</span>
            <h3>Core Values</h3>
            <ul class="core-values" aria-label="CDO Tutor core values">
                ${coreValueItems}
            </ul>
        </article>
    `;
}

function createAnnouncementCard({ title, text }, index) {
    return `
        <article class="announcement-card" data-announcement-card="${index}">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(text)}</p>
        </article>
    `;
}

function renderAnnouncements(announcements = []) {
    const container = document.querySelector('[data-announcements]');
    if (!container) return;

    const validAnnouncements = announcements.filter(a => a && a.text && a.text.trim());

    container.classList.toggle('announcement-grid--expanded', validAnnouncements.length > 0 && validAnnouncements.length <= 2);
    container.style.setProperty('--announcement-columns', validAnnouncements.length || 1);

    if (validAnnouncements.length === 0) {
        container.innerHTML = `<p class="announcement-empty">No announcements available at the moment.</p>`;
        return;
    }

    container.innerHTML = validAnnouncements.map(createAnnouncementCard).join('');
}

function formatBranchTime(value) {
    if (!value) return '';
    const [hours, minutes] = String(value).split(':');
    const hour = Number(hours);
    if (!Number.isFinite(hour)) return String(value);
    return `${hour % 12 || 12}:${minutes || '00'} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function createBranchCard(branch, index) {
    const phone = String(branch.phone_number || '').trim();
    const phoneHref = phone.replace(/[^\d+]/g, '');
    const timeRange = branch.opening_time && branch.closing_time
        ? `${formatBranchTime(branch.opening_time)} – ${formatBranchTime(branch.closing_time)}`
        : '';
    const schedule = [branch.operating_days, timeRange].filter(Boolean).join(' · ');

    return `
        <article class="enrollment-branch-card">
            <div class="enrollment-branch-card__heading">
                <span>${index + 1}</span>
                <h4>${escapeHtml(branch.branch_name || `Center ${index + 1}`)}</h4>
            </div>
            <p class="enrollment-branch-card__location">${escapeHtml(branch.branch_location || 'Location available upon request')}</p>
            <div class="enrollment-branch-card__details">
                <p>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H4v4c0 7.2 5.8 13 13 13h4v-3l-5-2-2 2c-3.3-1.3-5.7-3.7-7-7l2-2-2-5Z" /></svg>
                    ${phone ? `<a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(phone)}</a>` : '<span>Contact center for details</span>'}
                </p>
                <p>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    <span>${escapeHtml(schedule || 'Schedule available upon request')}</span>
                </p>
            </div>
        </article>
    `;
}

function renderEnrollmentBranches(branches = []) {
    const container = document.querySelector('[data-enrollment-branches]');
    if (!container) return;

    if (!Array.isArray(branches) || branches.length === 0) {
        container.innerHTML = '<p class="enrollment-branch-status">No active centers are available at the moment. Please contact us for assistance.</p>';
        return;
    }

    container.innerHTML = branches.map(createBranchCard).join('');
}

function loadEnrollmentBranches() {
    return fetch(buildAppUrl('api/admin/branch.php?operation=getPublicActiveBranches'))
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (!Array.isArray(data)) throw new Error('Invalid center response');
            renderEnrollmentBranches(data);
        })
        .catch(error => {
            console.error('Unable to load enrollment centers:', error);
            renderEnrollmentBranches([]);
        });
}

function parseCoreValues(value) {
    return (value || '').split(/\r?\n|,/).map(item => item.trim()).filter(Boolean)
        .map(item => [item.charAt(0).toUpperCase(), item]);
}

function applyLandingPageData(data) {
    if (!data) return;
    const principles = [
        { title: 'Mission', text: data.mission || GUIDING_PRINCIPLES[0].text },
        { title: 'Vision', text: data.vision || GUIDING_PRINCIPLES[1].text }
    ];
    const values = parseCoreValues(data.core_values);
    const container = document.querySelector('[data-mission-vision-content]');
    if (container) {
        const cards = principles.map(({ title, text }, index) => `<article class="mission-vision__panel"><span class="mission-vision__number" aria-hidden="true">0${index + 1}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></article>`).join('');
        const items = (values.length ? values : CORE_VALUES).map(([letter, value]) => `<li><span class="core-values__letter" aria-hidden="true">${escapeHtml(letter)}</span><span>${escapeHtml(value)}</span></li>`).join('');
        container.innerHTML = `${cards}<article class="mission-vision__panel mission-vision__panel--values"><span class="mission-vision__number" aria-hidden="true">03</span><h3>Core Values</h3><ul class="core-values">${items}</ul></article>`;
    }
    renderAnnouncements([1, 2, 3].map(number => ({ title: `Announcement ${number}`, text: data[`announcement_${number}`] || '' })));
    [1, 2, 3].forEach(number => {
        const url = data[`picture_${number}`];
        if (url) document.querySelector(`[data-landing-picture="${number}"]`)?.setAttribute('src', resolveLandingAssetUrl(url));
    });
    document.querySelectorAll('[data-landing-phone]').forEach(el => el.textContent = data.contact_number || el.textContent);
    document.querySelectorAll('[data-landing-email]').forEach(el => el.textContent = data.gmail || el.textContent);
    document.querySelectorAll('[data-landing-facebook]').forEach(el => el.textContent = data.facebook || el.textContent);
    document.querySelectorAll('[data-landing-phone-link]').forEach(el => el.href = `tel:${data.contact_number || ''}`);
    document.querySelectorAll('[data-landing-email-link]').forEach(el => el.href = `mailto:${data.gmail || ''}`);
    document.querySelectorAll('[data-landing-facebook-link]').forEach(el => el.href = data.facebook || '#');
}

export function initLandingPage() {
    const heroButton = document.querySelector('.hero-button');
    const enrollLinks = document.querySelectorAll('[data-enroll-link]');
    const sectionLinks = document.querySelectorAll('.landing-nav__link');
    const guidingPrinciplesContainer = document.querySelector('[data-mission-vision-content]');

    if (guidingPrinciplesContainer) {
        guidingPrinciplesContainer.innerHTML = createGuidingPrinciplesMarkup();
    }

    renderAnnouncements(ANNOUNCEMENTS);
    loadEnrollmentBranches();

    fetch(buildAppUrl('api/landing_page.php?operation=getLandingPage'))
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => applyLandingPageData(data?.[0]))
        .catch(error => console.error('Unable to load landing page content:', error));

    heroButton?.addEventListener('click', () => {
        window.location.href = buildAppUrl('login.html');
    });

    enrollLinks.forEach(link => link.addEventListener('click', (event) => {
        event.preventDefault();
        document.querySelector('#how-to-enroll')?.scrollIntoView({ behavior: 'smooth' });
        window.history.replaceState(null, '', '#how-to-enroll');
    }));

    sectionLinks.forEach((link) => {
        link.addEventListener('click', (event) => {
            const targetId = link.getAttribute('href');
            if (targetId && targetId.startsWith('#')) {
                event.preventDefault();
                document.querySelector(targetId)?.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}
