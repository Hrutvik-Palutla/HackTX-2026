"""Install only the application's approved settings from stdin; never print secrets."""
import json
import os
from pathlib import Path
import sys
import shutil
from datetime import datetime, timezone

ALLOWED = {
    'DATABASE_URL', 'MODEL_API_KEY', 'SERPAPI_API_KEY', 'APP_ENCRYPTION_KEY',
    'BETTER_AUTH_SECRET', 'PHONE_LOOKUP_HMAC_KEY', 'APP_BASE_URL', 'BETTER_AUTH_URL',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
    'CLAW_MESSENGER_API_KEY', 'CLAW_MESSENGER_URL', 'CLAW_MESSENGER_FROM_PHONE',
    'TEAM_ADMIN_USER_IDS', 'TEAM_ADMIN_PHONES', 'MUSE_BUDGET_USD', 'MUSE_BASE_URL',
}

def updated(text, values):
    if not isinstance(values, dict) or not values or not set(values) <= ALLOWED:
        raise ValueError('Unexpected runtime configuration keys')
    if any(not isinstance(v, str) or '\n' in v or '\r' in v or '\x00' in v for v in values.values()):
        raise ValueError('Runtime settings must be single-line strings')
    lines = [line for line in text.splitlines() if line.partition('=')[0].strip() not in values]
    return '\n'.join(lines + [key + '=' + value for key, value in values.items()]) + '\n'

if __name__ == '__main__':
    path = Path(sys.argv[1])
    values = json.load(sys.stdin)
    text = updated(path.read_text(), values)
    shutil.copy2(path, path.with_name(path.name + '.before-runtime-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
    temporary = path.with_name(path.name + '.runtime-tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(text)
    os.chown(temporary, path.stat().st_uid, path.stat().st_gid)
    os.replace(temporary, path)
    print('Application runtime settings installed; values omitted.')
