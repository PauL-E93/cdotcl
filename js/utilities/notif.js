import { buildAppUrl } from './app_url.js';

const notificationApiUrl = new URL('../../api/notification.php', window.location.href).href;
const refreshIntervalMs = 30000;

const roleFolderMap = {
    owner: 'owner',
    auditor: 'auditor',
    'branch admin': 'branch_admin',
    secretary: 'secretary',
    student: 'student',
    teacher: 'teacher'
};

function getCurrentUserRole() {
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return String(user.role_name || '').trim().toLowerCase();
    } catch (error) {
        return '';
    }
}

function isPreschoolNotification(text) {
    return /\b(?:pre[\s-]?school|play[\s-]?school|pre[\s-]?play)\b/i.test(text);
}

/**
 * Returns the role-specific page that best matches a notification.
 * Keep all notification routing rules here so new notification types have
 * one predictable place to define their destination.
 */
export function getNotificationActionUrl(notification, role = getCurrentUserRole()) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    const folder = roleFolderMap[normalizedRole];
    if (!folder) return '';

    const title = String(notification?.title || '');
    const message = String(notification?.message || '');
    const normalizedTitle = title.toLowerCase();
    const text = `${title} ${message}`.toLowerCase();
    const categorySuffix = isPreschoolNotification(text) ? '_pre_play' : '';

    // The title is authoritative. This prevents an enrollment application
    // mentioning a payment receipt from being routed to the payment page.
    const titleRoutes = [
        { matches: /\b(?:enrollment|enrolment|application|applicant)\b/, page: `enrollement${categorySuffix}.html` },
        { matches: /\b(?:payment|gcash|downpayment|billing|receipt)\b/, page: `payment${categorySuffix}.html` },
        { matches: /\bsession\s+(?:ongoing|done|completed)\b/, page: 'session.html' },
        { matches: /\b(?:session|schedule|reschedul(?:e|ed|ing|ement)?|appointment)\b/, page: 'schedule.html' },
        { matches: /\b(?:school calendar|academic calendar)\b/, page: 'school_calendar.html' },
        { matches: /\b(?:class|section)\b/, page: 'class.html' },
        { matches: /\b(?:student profile|student record)\b/, page: normalizedRole === 'student' ? 'profile.html' : 'student_management.html' },
        { matches: /\b(?:employee|staff|teacher account)\b/, page: 'employee.html' },
        { matches: /\b(?:product|inventory|stock)\b/, page: 'product.html' },
        { matches: /\b(?:program|subject|grade level)\b/, page: 'program.html' },
        { matches: /\b(?:center|branch)\b/, page: 'center.html' },
        { matches: /\b(?:profile|account|password|credential)\b/, page: 'profile.html' }
    ];

    const fallbackRoutes = [
        { matches: /\b(?:payment|gcash|downpayment|billing|receipt)\b/, page: `payment${categorySuffix}.html` },
        ...titleRoutes
    ];

    const route = titleRoutes.find(candidate => candidate.matches.test(normalizedTitle))
        || fallbackRoutes.find(candidate => candidate.matches.test(text));
    return route ? buildAppUrl(`html/${folder}/${route.page}`) : '';
}

function injectNotificationStyles() {
    if (document.getElementById('notification-bell-styles')) return;

    const style = document.createElement('style');
    style.id = 'notification-bell-styles';
    style.textContent = `
        .notification-bell-wrapper { position: relative; display: flex; align-items: center; }
        .notification-bell-button { position:relative; width:42px; height:42px; display:inline-grid; place-items:center; flex:0 0 42px; padding:0; border:1px solid #f1d8dd; border-radius:50%; background:#fff7f9; color:#b94f62; font-size:1.08rem; line-height:1; cursor:pointer; transition:border-color .2s ease,background-color .2s ease,box-shadow .2s ease,transform .2s ease; }
        .notification-bell-button:hover,.notification-bell-button:focus-visible,.notification-bell-button[aria-expanded="true"] { border-color:#ea9aa6; background:#fff0f3; box-shadow:0 0 0 3px rgba(234,154,166,.18); outline:none; }
        .notification-bell-button:active { transform:scale(.96); }
        .notification-badge { position:absolute; top:-5px; right:-5px; min-width:19px; height:19px; padding:0 5px; border:2px solid #fff; border-radius:999px; background:#d83f5f; color:#fff; font-size:.62rem; font-weight:800; line-height:15px; text-align:center; box-sizing:border-box; }
        .notification-dropdown { position:absolute; top:calc(100% + 18px); right:0; z-index:1100; width:min(390px,calc(100vw - 24px)); max-height:min(500px,calc(100vh - 110px)); overflow:visible; border:1px solid #f2d7dc; border-radius:14px; background:#fff; box-shadow:0 16px 40px rgba(79,32,45,.16); color:#49363c; font-size:.88rem; }
        .notification-dropdown[hidden] { display:none !important; }
        .notification-dropdown::before { content:''; position:absolute; top:-7px; right:14px; width:14px; height:14px; border-top:1px solid #f2d7dc; border-left:1px solid #f2d7dc; background:#fff5f7; transform:rotate(45deg); }
        .notification-dropdown-header { position:relative; display:flex; align-items:center; justify-content:space-between; gap:14px; padding:16px; border-bottom:1px solid #f4e1e5; background:linear-gradient(135deg,#fff3f6 0%,#fff9fa 100%); }
        .notification-dropdown-heading { min-width:0; }
        .notification-dropdown-eyebrow { display:block; margin-bottom:2px; color:#a66a75; font-size:.65rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
        .notification-dropdown-title { margin:0; color:#35252a; font-size:1rem; font-weight:800; line-height:1.25; }
        .notification-dropdown-summary { display:block; margin-top:3px; color:#8b747b; font-size:.72rem; }
        .notification-mark-all { flex:0 0 auto; padding:7px 10px; border:1px solid #efcbd2; border-radius:8px; background:#fff; color:#b94f62; font:inherit; font-size:.72rem; font-weight:700; cursor:pointer; transition:background-color .18s ease,border-color .18s ease; }
        .notification-mark-all:hover,.notification-mark-all:focus-visible { border-color:#ea9aa6; background:#ffeef2; outline:none; }
        .notification-list { max-height:min(390px,calc(100vh - 190px)); padding:7px; overflow-y:auto; scrollbar-color:#e8b9c2 transparent; scrollbar-width:thin; }
        .notification-list::-webkit-scrollbar { width:6px; }
        .notification-list::-webkit-scrollbar-thumb { border-radius:999px; background:#e8b9c2; }
        .notification-state { padding:34px 18px; color:#8b747b; text-align:center; }
        .notification-state::before { content:'\\F18A'; display:grid; width:42px; height:42px; place-items:center; margin:0 auto 10px; border-radius:50%; background:#fff0f3; color:#bd5265; font-family:'bootstrap-icons'; font-size:1rem; }
        .notification-item { position:relative; margin-bottom:5px; padding:13px 40px 13px 45px; border:1px solid transparent; border-radius:10px; background:#fff; cursor:pointer; transition:border-color .18s ease,background-color .18s ease,transform .18s ease; }
        .notification-item:last-child { margin-bottom:0; }
        .notification-item::before { content:'\\F18A'; position:absolute; top:13px; left:10px; width:26px; height:26px; display:grid; place-items:center; border-radius:8px; background:#f8edf0; color:#a97882; font-family:'bootstrap-icons'; font-size:.78rem; }
        .notification-item.unread { border-color:#f3d4da; background:#fff7f9; }
        .notification-item.unread::before { background:#fbdde3; color:#bd5265; }
        .notification-item.unread::after { content:''; position:absolute; top:17px; right:13px; width:7px; height:7px; border-radius:50%; background:#e85d78; }
        .notification-item:hover,.notification-item:focus-visible { border-color:#efcbd2; background:#fff1f4; outline:none; transform:translateY(-1px); }
        .notification-item-title { margin:0 14px 4px 0; color:#3d2c31; font-size:.84rem; font-weight:800; line-height:1.35; }
        .notification-item-message { color:#746067; font-size:.78rem; line-height:1.45; }
        .notification-item-time { margin-top:7px; color:#ae8e96; font-size:.68rem; font-weight:600; }
        .notification-delete { position:absolute; right:8px; bottom:8px; width:25px; height:25px; display:grid; place-items:center; padding:0; border:0; border-radius:7px; background:transparent; color:#b99da4; font-size:1rem; line-height:1; cursor:pointer; }
        .notification-delete:hover,.notification-delete:focus-visible { background:#ffe4e8; color:#c73d4d; outline:none; }
        .notification-dropdown-footer { padding:9px; border-top:1px solid #f4e1e5; background:#fffafb; }
        .notification-view-all { width:100%; display:flex; align-items:center; justify-content:center; gap:8px; padding:10px 14px; border:1px solid #efcbd2; border-radius:9px; background:#fff; color:#b94f62; font:inherit; font-size:.78rem; font-weight:800; cursor:pointer; transition:color .18s ease,background-color .18s ease,border-color .18s ease; }
        .notification-view-all:hover,.notification-view-all:focus-visible { border-color:#ea9aa6; background:#fff0f3; color:#a83f53; outline:none; }
        @media (max-width: 576px) {
            .notification-dropdown { top:calc(100% + 14px); right:-62px; width:min(350px,calc(100vw - 24px)); }
            .notification-dropdown::before { right:76px; }
            .notification-dropdown-header { align-items:flex-start; padding:14px; }
            .notification-mark-all { padding:6px 8px; }
        }
    `;
    document.head.appendChild(style);
}

async function request(operation, json = null) {
    const options = {};
    let url = notificationApiUrl;

    if (json === null && operation === 'getNotifications') {
        url += `?operation=${encodeURIComponent(operation)}`;
    } else {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
        options.body = new URLSearchParams({
            operation,
            ...(json === null ? {} : { json: JSON.stringify(json) })
        });
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Notification request failed');
    }

    return data;
}

function formatTimestamp(value) {
    const date = new Date(String(value || '').replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value || '';

    return date.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

export function createNotificationBell() {
    injectNotificationStyles();

    const wrapper = document.createElement('div');
    wrapper.className = 'notification-bell-wrapper';

    const bellButton = document.createElement('button');
    bellButton.type = 'button';
    bellButton.className = 'notification-bell-button';
    bellButton.title = 'Notifications';
    bellButton.setAttribute('aria-label', 'Notifications');
    bellButton.setAttribute('aria-expanded', 'false');
    bellButton.innerHTML = '<i class="bi bi-bell" aria-hidden="true"></i>';

    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.hidden = true;
    bellButton.appendChild(badge);

    const dropdown = document.createElement('div');
    dropdown.className = 'notification-dropdown';
    dropdown.hidden = true;

    const header = document.createElement('div');
    header.className = 'notification-dropdown-header';

    const heading = document.createElement('div');
    heading.className = 'notification-dropdown-heading';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'notification-dropdown-eyebrow';
    eyebrow.textContent = 'Updates';

    const title = document.createElement('h2');
    title.className = 'notification-dropdown-title';
    title.textContent = 'Notifications';

    const summary = document.createElement('span');
    summary.className = 'notification-dropdown-summary';
    summary.textContent = 'You are all caught up';

    heading.append(eyebrow, title, summary);

    const markAllButton = document.createElement('button');
    markAllButton.type = 'button';
    markAllButton.className = 'notification-mark-all';
    markAllButton.textContent = 'Mark all as read';

    const list = document.createElement('div');
    list.className = 'notification-list';

    const footer = document.createElement('div');
    footer.className = 'notification-dropdown-footer';

    const viewAllButton = document.createElement('button');
    viewAllButton.type = 'button';
    viewAllButton.className = 'notification-view-all';
    viewAllButton.innerHTML = '<i class="bi bi-clock-history" aria-hidden="true"></i><span>View all notifications</span><i class="bi bi-arrow-right" aria-hidden="true"></i>';
    footer.appendChild(viewAllButton);

    header.append(heading, markAllButton);
    dropdown.append(header, list, footer);
    wrapper.append(bellButton, dropdown);

    let notifications = [];

    const positionDropdown = () => {
        dropdown.style.right = '0';
        dropdown.style.transform = '';

        if (dropdown.hidden) return;

        const viewportPadding = window.innerWidth <= 576 ? 16 : 12;
        const rect = dropdown.getBoundingClientRect();
        let shiftX = 0;

        if (rect.left < viewportPadding) {
            shiftX = viewportPadding - rect.left;
        } else if (rect.right > window.innerWidth - viewportPadding) {
            shiftX = (window.innerWidth - viewportPadding) - rect.right;
        }

        dropdown.style.transform = shiftX ? `translateX(${shiftX}px)` : '';
    };

    const updateBadge = () => {
        const unreadCount = notifications.filter(notification => Number(notification.is_read) === 0).length;
        badge.hidden = unreadCount === 0;
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        bellButton.setAttribute('aria-label', unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications');
        summary.textContent = unreadCount
            ? `${unreadCount} unread ${unreadCount === 1 ? 'notification' : 'notifications'}`
            : 'You are all caught up';
        markAllButton.hidden = unreadCount === 0;
    };

    const render = () => {
        list.innerHTML = '';
        updateBadge();

        if (notifications.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'notification-state';
            emptyState.textContent = 'No notifications yet.';
            list.appendChild(emptyState);
            if (!dropdown.hidden) {
                window.requestAnimationFrame(positionDropdown);
            }
            return;
        }

        notifications.forEach(notification => {
            const item = document.createElement('article');
            item.className = `notification-item${Number(notification.is_read) === 0 ? ' unread' : ''}`;
            item.tabIndex = 0;

            const itemTitle = document.createElement('div');
            itemTitle.className = 'notification-item-title';
            itemTitle.textContent = notification.title;

            const message = document.createElement('div');
            message.className = 'notification-item-message';
            message.textContent = notification.message;

            const time = document.createElement('div');
            time.className = 'notification-item-time';
            time.textContent = formatTimestamp(notification.created_at);

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'notification-delete';
            deleteButton.title = 'Dismiss notification';
            deleteButton.setAttribute('aria-label', 'Dismiss notification');
            deleteButton.innerHTML = '&times;';

            const markRead = async () => {
                if (Number(notification.is_read) !== 0) return;
                await request('markAsRead', { notification_id: notification.notification_id });
                notification.is_read = 1;
                render();
            };

            const openNotificationAction = async () => {
                const destination = getNotificationActionUrl(notification);

                try {
                    await markRead();
                } catch (error) {
                    console.error('Unable to mark notification as read:', error);
                }

                if (destination) {
                    window.location.href = destination;
                }
            };

            item.addEventListener('click', () => openNotificationAction());
            item.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                openNotificationAction();
            });

            deleteButton.addEventListener('click', async event => {
                event.stopPropagation();
                await request('dismissNotification', { notification_id: notification.notification_id });
                notifications = notifications.filter(item => item.notification_id !== notification.notification_id);
                render();
            });

            item.append(itemTitle, message, time, deleteButton);
            list.appendChild(item);
        });

        if (!dropdown.hidden) {
            window.requestAnimationFrame(positionDropdown);
        }
    };

    const loadNotifications = async () => {
        try {
            notifications = (await request('getNotifications')).data || [];
            render();
        } catch (error) {
            console.error('Unable to load notifications:', error);
            if (!dropdown.hidden) {
                list.innerHTML = '<div class="notification-state">Unable to load notifications.</div>';
                window.requestAnimationFrame(positionDropdown);
            }
        }
    };

    bellButton.addEventListener('click', event => {
        event.stopPropagation();
        dropdown.hidden = !dropdown.hidden;
        bellButton.setAttribute('aria-expanded', String(!dropdown.hidden));
        if (!dropdown.hidden) {
            loadNotifications();
            window.requestAnimationFrame(positionDropdown);
        }
    });

    markAllButton.addEventListener('click', async () => {
        await request('markAllAsRead');
        notifications.forEach(notification => {
            notification.is_read = 1;
        });
        render();
    });

    viewAllButton.addEventListener('click', () => {
        window.location.href = buildAppUrl('html/shared/notifications.html');
    });

    dropdown.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => {
        dropdown.hidden = true;
        bellButton.setAttribute('aria-expanded', 'false');
    });
    window.addEventListener('resize', () => {
        if (!dropdown.hidden) {
            window.requestAnimationFrame(positionDropdown);
        }
    });

    loadNotifications();
    const refreshTimer = window.setInterval(loadNotifications, refreshIntervalMs);
    window.addEventListener('beforeunload', () => window.clearInterval(refreshTimer), { once: true });

    return wrapper;
}
