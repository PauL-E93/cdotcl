# Schedule Email Notifications System

This system automatically sends email notifications to students and teachers for their daily schedules at 6:00 AM.

## Features

- **Daily Notifications**: Sends email reminders at 6 AM for all schedules on the current day
- **Dual Recipients**: Notifies both students and teachers for each schedule
- **Database Tracking**: Stores notifications in the database and marks schedules as notified
- **HTML Emails**: Professional-looking email templates with schedule details
- **Status Tracking**: Visual indicators show notification status in calendar views

## Setup Instructions

### 1. Database Updates

Run the SQL script to update the database schema:

```sql
-- Execute this file: update_schedule_table.sql
```

This adds the required columns:
- `date` - Actual schedule date
- `is_notified` - Tracks if notification was sent
- `status` - Schedule status (pending, confirmed, cancelled, completed)

### 2. Windows Task Scheduler Setup

1. Open **Task Scheduler** (search for it in Windows)
2. Click **Create Basic Task**
3. Name: "CDO Tutorial Schedule Notifications"
4. Trigger: **Daily** at **6:00 AM**
5. Action: **Start a program**
6. Program/script: `C:\xampp\htdocs\tutorial_center\schedule_notifications.bat`
7. Start in: `C:\xampp\htdocs\tutorial_center`

### 3. Alternative: Manual Testing

For testing purposes, you can run the notification script manually:

```bash
# From the tutorial_center directory
php api/schedule_notifications.php
```

Or use the test script:
```bash
php api/test_notifications.php
```

## Email Configuration

The system uses Gmail SMTP with the following settings (configured in `schedule_notifications.php`):

- **SMTP Server**: smtp.gmail.com
- **Port**: 587
- **Encryption**: TLS
- **Email**: espinosapaul810@gmail.com
- **App Password**: YOUR_NEW_APP_PASSWORD_HERE

To change email settings, edit the `sendEmail()` method in `api/schedule_notifications.php`.

## How It Works

1. **Daily Execution**: The batch file runs at 6 AM via Task Scheduler
2. **Schedule Check**: Script queries database for today's schedules that haven't been notified
3. **Email Generation**: Creates personalized HTML emails for students and teachers
4. **Email Sending**: Uses PHPMailer to send emails via Gmail SMTP
5. **Database Updates**:
   - Stores notification records in `notification` table
   - Marks schedules as notified (`is_notified = 1`)
6. **Visual Feedback**: Calendar modules show notification status

## Email Templates

### Student Email
- Subject: "📅 Schedule Reminder - [Date]"
- Includes: Program, Subject, Teacher, Branch, Date, Time, Status

### Teacher Email
- Subject: "📅 Teaching Schedule Reminder - [Date]"
- Includes: Program, Subject, Student, Branch, Date, Time, Status

## Files Created/Modified

### New Files:
- `api/schedule_notifications.php` - Main notification script
- `schedule_notifications.bat` - Windows batch file for scheduling
- `update_schedule_table.sql` - Database schema updates
- `api/test_notifications.php` - Manual testing script
- `logs/` - Directory for notification logs

### Modified Files:
- `js/utilities/notif.js` - Updated notification fetching logic

## Troubleshooting

### Emails Not Sending
1. Check Gmail app password is correct
2. Verify less secure app access is enabled in Gmail
3. Check PHP error logs
4. Test with manual execution

### Database Errors
1. Ensure `update_schedule_table.sql` was executed
2. Check database connection in `connection-pdo.php`
3. Verify table permissions

### Task Scheduler Issues
1. Ensure batch file path is correct
2. Check Task Scheduler service is running
3. Verify user permissions for script execution

## Logs

Notification execution logs are stored in:
```
logs/notifications.log
```

Check this file for execution status and any errors.