@echo off
REM Schedule Notifications Cron Job
REM This script should be scheduled to run daily at 6:00 AM

echo Starting schedule notifications at %DATE% %TIME%

REM Change to the tutorial_center directory
cd /d "C:\xampp\htdocs\tutorial_center\api"

REM Run the PHP notification script using full path
"C:\xampp\php\php.exe" schedule_notifications.php

echo Schedule notifications completed at %DATE% %TIME%

REM Optional: Log the output to file
(
    echo %DATE% %TIME% - Schedule notifications completed
    echo.
) >> "C:\xampp\htdocs\tutorial_center\logs\notifications.log"