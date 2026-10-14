<?php
require_once __DIR__ . '/../security/AuthGuard.php';
AuthGuard::requireUser();

require __DIR__ . '/../notification.php';

