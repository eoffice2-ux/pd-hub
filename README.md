# PD One-Stop Hub — Cloudflare Pages + Functions

This project separates the previous single Worker file into static frontend files and backend API functions.

## Structure

```text
public/
  index.html
  trainee.html
  client.html
  _redirects

functions/
  api/
    health.js
    client/
      inquiries.js
      profile.js
      inquiry/update.js
      profile/update.js
```

## Test routes after deploy

```text
/
/trainee
/client
/api/health
/api/client/inquiries?email=test@example.com
/api/client/profile?email=test@example.com
```

POST tests can be run from browser Console on the deployed domain.

```js
fetch('/api/client/inquiry/update', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    'inquiry id': 'INQ-DEMO-001',
    'client representative email': 'test@example.com'
  })
}).then(r => r.json()).then(console.log)
```

```js
fetch('/api/client/profile/update', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    'client id': 'CLIENT-DEMO-001',
    'client updater email': 'test@example.com'
  })
}).then(r => r.json()).then(console.log)
```

## Notes

- `client.html` already calls `/api/client/inquiries` for the inquiry list.
- Other client functions still call the existing GAS bridge until migrated.
- API functions currently return mock data.
- Later, replace mock handlers with Google Sheet API / PostgreSQL repository logic.
