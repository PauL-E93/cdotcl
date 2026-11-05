import { buildAppUrl } from '../utilities/app_url.js';
import { LANDING_COPY, normalizeLandingCopy } from './landing_content.js?v=20261105';

const GUIDING_PRINCIPLES = [
    {
        title: 'Mission',
        text: LANDING_COPY.mission
    },
    {
        title: 'Vision',
        text: LANDING_COPY.vision
    }
];


const CORE_VALUES = [
    ['C', 'Courageous'],
    ['D', 'Disciplined'],
    ['O', 'Optimistic'],
    ['T', 'Talented'],
    ['L', 'Limitless'],
    ['C', 'Courteous']
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

function renderTutorialSubjects(subjects) {
    const container = document.querySelector('[data-tutorial-subjects]');
    if (!container) return;
    const names = [...new Map(subjects
        .map(subject => String(subject?.subject_name || '').trim())
        .filter(Boolean)
        .map(name => [name.toLowerCase(), name])).values()]
        .sort((a, b) => a.localeCompare(b));
    container.innerHTML = names.length
        ? `<ul class="tutorial-subject-list">${names.map(name => `<li class="tutorial-subject">${escapeHtml(name)}</li>`).join('')}</ul>`
        : '<p>The subject list is being updated. Please contact your preferred center for available tutorial subjects.</p>';
    container.setAttribute('aria-busy', 'false');
}

async function loadTutorialSubjects() {
    const container = document.querySelector('[data-tutorial-subjects]');
    if (!container) return;
    try {
        const response = await fetch(buildAppUrl('api/enrollment_application.php?operation=getLookups'));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.status !== 'success' || !Array.isArray(result.data?.subjects)) {
            throw new Error('Invalid subject response');
        }
        renderTutorialSubjects(result.data.subjects);
    } catch (error) {
        console.error('Unable to load tutorial subjects:', error);
        container.innerHTML = '<p>We could not load the subjects right now. Please refresh the page or contact your preferred center.</p>';
        container.setAttribute('aria-busy', 'false');
    }
}

function parseCoreValues(value) {
    return (value || '').split(/\r?\n|,/).map(item => item.trim()).filter(Boolean)
        .map(item => [item.charAt(0).toUpperCase(), item]);
}

function setTextWithLineBreaks(element, value) {
    if (!element || !String(value || '').trim()) return;
    const lines = String(value).split(/\r?\n/);
    element.replaceChildren(...lines.flatMap((line, index) => index
        ? [document.createElement('br'), document.createTextNode(line)]
        : [document.createTextNode(line)]));
}

function initLandingNavigation(sectionLinks) {
    const links = Array.from(sectionLinks).filter(link => {
        const href = link.getAttribute('href') || '';
        return href.startsWith('#') && document.querySelector(href);
    });
    if (links.length === 0) return;

    const sections = links.map(link => ({
        link,
        section: document.querySelector(link.getAttribute('href'))
    }));
    let scheduled = false;

    const setActiveLink = activeLink => {
        links.forEach(link => {
            const isActive = link === activeLink;
            link.classList.toggle('active', isActive);
            if (isActive) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    };

    const updateActiveLink = () => {
        scheduled = false;
        const headerHeight = document.querySelector('.landing-header')?.offsetHeight || 0;
        const marker = window.scrollY + headerHeight + Math.min(180, window.innerHeight * 0.25);
        let current = sections[0];

        sections.forEach(item => {
            if (item.section.offsetTop <= marker && item.section.offsetTop >= current.section.offsetTop) {
                current = item;
            }
        });

        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
            current = sections[sections.length - 1];
        }
        setActiveLink(current.link);
    };

    const scheduleUpdate = () => {
        if (scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(updateActiveLink);
    };

    links.forEach(link => {
        link.addEventListener('click', () => setActiveLink(link));
    });
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('hashchange', scheduleUpdate);
    updateActiveLink();
}

function applyLandingPageData(data) {
    if (!data) return;
    data = normalizeLandingCopy(data);
    setTextWithLineBreaks(document.querySelector('[data-landing-hero-eyebrow]'), data.hero_eyebrow);
    const title = document.querySelector('[data-landing-hero-title]');
    if (title && String(data.hero_title || '').trim()) {
        const [firstLine, ...remainingLines] = data.hero_title.split(/\r?\n/);
        const accent = document.createElement('span');
        setTextWithLineBreaks(accent, remainingLines.join('\n'));
        title.replaceChildren(document.createTextNode(firstLine), ...(remainingLines.length
            ? [document.createElement('br'), accent] : []));
    }
    setTextWithLineBreaks(document.querySelector('[data-landing-hero-tagline]'), data.hero_tagline);
    setTextWithLineBreaks(document.querySelector('[data-landing-hero-description]'), data.hero_description);
    [1, 2, 3, 4].forEach(number => {
        setTextWithLineBreaks(document.querySelector(`[data-landing-highlight-value="${number}"]`), data[`highlight_${number}_value`]);
        setTextWithLineBreaks(document.querySelector(`[data-landing-highlight-label="${number}"]`), data[`highlight_${number}_label`]);
    });
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

    initLandingNavigation(sectionLinks);
    loadTutorialSubjects();

    if (guidingPrinciplesContainer) {
        guidingPrinciplesContainer.innerHTML = createGuidingPrinciplesMarkup();
    }

    if (document.querySelector('[data-enrollment-branches]')) {
        loadEnrollmentBranches();
    }

    fetch(buildAppUrl('api/landing_page.php?operation=getLandingPage'))
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data?.[0]) applyLandingPageData(data[0]);
            else renderAnnouncements([]);
        })
        .catch(error => {
            console.error('Unable to load landing page content:', error);
            renderAnnouncements([]);
        });

    heroButton?.addEventListener('click', () => {
        window.location.href = buildAppUrl('new_student_enrollment.html');
    });

    enrollLinks.forEach(link => link.addEventListener('click', (event) => {
        const target = link.getAttribute('href') || '';
        if (!target.startsWith('#')) {
            return;
        }
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
