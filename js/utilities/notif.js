const notificationApiUrl = new URL('../../api/notification.php', window.location.href).href;
const refreshIntervalMs = 30000;

function injectNotificationStyles() {
    if (document.getElementById('notification-bell-styles')) return;

    const style = document.createElement('style');
    style.id = 'notification-bell-styles';
    style.textContent = `
        .notification-bell-wrapper { position: relative; display: flex; align-items: center; }
        .notification-bell-button { position: relative; border: 0; background: transparent; color: inherit; padding: 0; font-size: inherit; line-height: 1; cursor: pointer; }
        .notification-badge { position: absolute; top: -9px; right: -11px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #dc3545; color: #fff; font-size: 0.68rem; font-weight: 700; line-height: 18px; text-align: center; }
        .notification-dropdown { position: absolute; top: calc(100% + 18px); right: 0; z-index: 1100; width: min(380px, calc(100vw - 24px)); max-height: min(420px, calc(100vh - 110px)); overflow: hidden; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16); color: #334155; font-size: 0.88rem; }
        .notification-dropdown-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #eef2f7; }
        .notification-dropdown-title { margin: 0; color: #1f2937; font-size: 0.96rem; font-weight: 700; }
        .notification-mark-all { border: 0; background: transparent; color: #c45f70; padding: 0; font-size: 0.78rem; cursor: pointer; }
        .notification-list { max-height: min(420px, calc(100vh - 110px)); overflow-y: auto; }
        .notification-state { padding: 24px 14px; color: #64748b; text-align: center; }
        .notification-item { position: relative; padding: 12px 38px 12px 14px; border-bottom: 1px solid #f1f5f9; background: #fff; cursor: pointer; }
        .notification-item:last-child { border-bottom: 0; }
        .notification-item.unread { background: #fff7f8; }
        .notification-item:hover { background: #fff1f3; }
        .notification-item-title { margin-bottom: 4px; color: #1f2937; font-size: 0.86rem; font-weight: 700; }
        .notification-item-message { color: #64748b; font-size: 0.8rem; line-height: 1.4; }
        .notification-item-time { margin-top: 7px; color: #94a3b8; font-size: 0.72rem; }
        .notification-delete { position: absolute; top: 10px; right: 10px; border: 0; background: transparent; color: #94a3b8; padding: 2px; font-size: 1rem; line-height: 1; cursor: pointer; }
        .notification-delete:hover { color: #dc3545; }
        @media (max-width: 576px) {
            .notification-dropdown { top: calc(100% + 12px); width: min(320px, calc(100vw - 32px)); }
            .notification-dropdown-header { align-items: flex-start; flex-wrap: wrap; }
            .notification-mark-all { margin-left: auto; }
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

    const title = document.createElement('h2');
    title.className = 'notification-dropdown-title';
    title.textContent = 'Notifications';

    const markAllButton = document.createElement('button');
    markAllButton.type = 'button';
    markAllButton.className = 'notification-mark-all';
    markAllButton.textContent = 'Mark all as read';

    const list = document.createElement('div');
    list.className = 'notification-list';

    header.append(title, markAllButton);
    dropdown.append(header, list);
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

            item.addEventListener('click', () => markRead().catch(console.error));
            item.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                markRead().catch(console.error);
            });

            deleteButton.addEventListener('click', async event => {
                event.stopPropagation();
                await request('deleteNotification', { notification_id: notification.notification_id });
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
