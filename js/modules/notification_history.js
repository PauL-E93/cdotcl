import { getNotificationActionUrl } from '../utilities/notif.js?v=20260921-actions';

const notificationApiUrl = new URL('../../api/notification.php', import.meta.url).href;

const state = {
    notifications: [],
    filter: 'all',
    search: ''
};

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function formatTimestamp(value) {
    const date = new Date(String(value || '').replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value || '';

    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function notificationIcon(notification) {
    const text = `${notification.title || ''} ${notification.message || ''}`.toLowerCase();
    if (/payment|gcash|billing|receipt|downpayment/.test(text)) return 'bi-credit-card';
    if (/enrollment|enrolment|application/.test(text)) return 'bi-journal-check';
    if (/session|schedule|reschedul/.test(text)) return 'bi-calendar3';
    if (/class|section/.test(text)) return 'bi-building';
    if (/student/.test(text)) return 'bi-person';
    return 'bi-bell';
}

async function request(operation, json = null) {
    const options = { credentials: 'same-origin' };
    let url = notificationApiUrl;

    if (operation === 'getNotificationHistory') {
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
    const payload = await response.json();
    if (!response.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Notification request failed');
    }
    return payload;
}

function matchesFilter(notification) {
    const isDismissed = Boolean(notification.dismissed_at);
    const isUnread = Number(notification.is_read) === 0;

    if (state.filter === 'unread' && !isUnread) return false;
    if (state.filter === 'read' && (isUnread || isDismissed)) return false;
    if (state.filter === 'dismissed' && !isDismissed) return false;

    if (!state.search) return true;
    const text = `${notification.title || ''} ${notification.message || ''}`.toLowerCase();
    return text.includes(state.search);
}

function updateSummary() {
    const unread = state.notifications.filter(item => Number(item.is_read) === 0).length;
    const dismissed = state.notifications.filter(item => Boolean(item.dismissed_at)).length;
    document.getElementById('history-total-count').textContent = state.notifications.length;
    document.getElementById('history-unread-count').textContent = unread;
    document.getElementById('history-archived-count').textContent = dismissed;
    document.getElementById('notification-history-mark-all').disabled = unread === 0;
}

async function openNotification(notification) {
    if (Number(notification.is_read) === 0) {
        try {
            await request('markAsRead', { notification_id: notification.notification_id });
            notification.is_read = 1;
            updateSummary();
        } catch (error) {
            console.error('Unable to mark notification as read:', error);
        }
    }

    const destination = getNotificationActionUrl(notification);
    if (destination) window.location.href = destination;
}

function render() {
    const list = document.getElementById('notification-history-list');
    const status = document.getElementById('notification-history-status');
    const visible = state.notifications.filter(matchesFilter);
    updateSummary();

    if (visible.length === 0) {
        list.hidden = true;
        status.hidden = false;
        status.innerHTML = '<i class="bi bi-bell-slash" aria-hidden="true"></i>No notifications match this view.';
        return;
    }

    status.hidden = true;
    list.hidden = false;
    list.innerHTML = visible.map(notification => {
        const isUnread = Number(notification.is_read) === 0;
        const isDismissed = Boolean(notification.dismissed_at);
        const statusLabel = isDismissed ? 'Dismissed' : (isUnread ? 'Unread' : 'Read');
        return `
            <article class="notification-history-item${isUnread ? ' unread' : ''}${isDismissed ? ' dismissed' : ''}"
                tabindex="0" data-notification-id="${Number(notification.notification_id)}">
                <span class="notification-history-item-icon"><i class="bi ${notificationIcon(notification)}" aria-hidden="true"></i></span>
                <div>
                    <h2>${escapeHtml(notification.title)}</h2>
                    <p>${escapeHtml(notification.message)}</p>
                    <div class="notification-history-meta">
                        <span><i class="bi bi-clock me-1" aria-hidden="true"></i>${escapeHtml(formatTimestamp(notification.created_at))}</span>
                        <span class="notification-history-tag${isUnread ? ' unread' : ''}">${statusLabel}</span>
                    </div>
                </div>
                <i class="bi bi-chevron-right notification-history-open" aria-hidden="true"></i>
            </article>`;
    }).join('');

    list.querySelectorAll('[data-notification-id]').forEach(item => {
        const notification = state.notifications.find(entry => String(entry.notification_id) === item.dataset.notificationId);
        if (!notification) return;
        item.addEventListener('click', () => openNotification(notification));
        item.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openNotification(notification);
        });
    });
}

async function loadHistory() {
    const status = document.getElementById('notification-history-status');
    try {
        const payload = await request('getNotificationHistory');
        state.notifications = Array.isArray(payload.data) ? payload.data : [];
        render();
    } catch (error) {
        console.error('Unable to load notification history:', error);
        status.innerHTML = '<i class="bi bi-exclamation-circle" aria-hidden="true"></i>Unable to load notification history.';
    }
}

function bindControls() {
    document.querySelectorAll('[data-notification-filter]').forEach(button => {
        button.addEventListener('click', () => {
            state.filter = button.dataset.notificationFilter;
            document.querySelectorAll('[data-notification-filter]').forEach(item => {
                item.classList.toggle('active', item === button);
            });
            render();
        });
    });

    document.getElementById('notification-history-search').addEventListener('input', event => {
        state.search = event.target.value.trim().toLowerCase();
        render();
    });

    document.getElementById('notification-history-mark-all').addEventListener('click', async () => {
        try {
            await request('markAllAsRead');
            state.notifications.forEach(notification => {
                notification.is_read = 1;
            });
            render();
        } catch (error) {
            console.error('Unable to mark all notifications as read:', error);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindControls();
    loadHistory();
});
