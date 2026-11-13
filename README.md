# GariSeba 2.4

GariSeba is a bilingual roadside request and vehicle guidance app for Dhaka. The project originated as LAGBO NAKI?. It uses React, HTML, CSS and Tailwind on the frontend, Node.js and Express for the API, and MongoDB for data. The Word guide in `docs/` covers the original GariSeba setup in Bangla.

## Upgrade from 2.3 on Linux

Stop the old Node server, extract the new archive in a separate directory, and copy your existing `.env` into the new `gariseba-mern` folder. Keep its MongoDB URI, database name and secrets so your accounts, requests and tracking keys carry over. Use the same running MongoDB instance. If you configured Compose for MongoDB 7.0, use your working `compose.yaml` and volume when starting MongoDB again.

From the new folder containing `package.json`, run these commands.

```bash
npm ci
npm run build
npm start
```

Open the address shown in the terminal. For an existing port 3030 setup, keep `PORT=3030` and `PUBLIC_BASE_URL=http://localhost:3030` in `.env` and open [http://localhost:3030](http://localhost:3030).

## Version 2.4 features

| Feature | How to use it |
| --- | --- |
| Queue filter by technician | Choose **Assigned technician**, then **Apply filters**. Choose **Unassigned** for requests without an assignment. Inactive technicians remain searchable for their existing work. Combine this with status, type, urgency, received dates, reference and customer search. |
| Assignment history | Open a request to see **Assignment history**. Each actual assignment, reassignment or removal records the previous and next technician, staff username and time. Viewers can read this history. |
| Customer name or phone search | Enter a full or partial name or phone in **Find customer by name or phone**, then apply. Name matching is case-insensitive and treats punctuation as text. Phone search accepts 3 to 13 digits, Bangla digits and spaces, dashes or parentheses. A full Bangladesh mobile number matches local `01…` and international `+8801…` forms. |

The technician filter is kept in the queue URL alongside the earlier filters and page. The applied customer search is kept in the browser history state for the signed-in username. It survives request details, returning to the queue, page reload and browser Back. Customer search requests use a CSRF-protected POST body so the UI keeps names and phone searches out of the URL. **Clear filters** clears both new filters and resets the queue page. Status counts above the queue keep their existing overall totals.

History starts with assignment changes saved in version 2.4. Existing assignments and their saved names carry over, and their next change records the current assignment as its starting point. Earlier staff actors and times are not reconstructed. Assignment, status history and any consented status-email job are saved in the same version-checked MongoDB update. A conflicting save records no extra assignment event. Re-saving the same assignment or editing notes alone adds no assignment event. No database migration is required.

### Verify version 2.4

1. Filter by a technician, then by **Unassigned**. Combine with type, urgency, received dates and status. Open a result and return, then reload and check the same filters. An inactive technician should still show their existing assignments.
2. Search an existing customer by a name fragment, local phone number, international phone number and Bangla phone digits. Check that the name or phone stays out of the address bar. Apply another search, use browser Back, and check the earlier search. Clear all filters.
3. Assign a technician, reassign to another and clear the assignment. Check each history entry's previous and next technician, actor and time. Saving only notes should preserve the entry count. A viewer can read the history and cannot save assignments.
4. For a request already opted into email updates, change the status and assignment together. Check both histories and the existing email queue. An obsolete version should return a conflict and add no duplicate entry.

## Version 2.3 features

| Feature | How to use it |
| --- | --- |
| Technician assignment | An owner adds technicians from **Technicians**. Owners and dispatchers select **Assigned technician** in a request, then save. Change the selection to reassign, or choose **Unassigned**. |
| Consented email status updates | Configure Resend below. Customers opt in and enter an email in the contact step. Each actual staff status change queues an email. The tracking page lets the customer stop updates. |
| Reports and CSV | An owner opens **Reports**, chooses 1 to 366 inclusive received dates in Dhaka time, and optionally filters by type and current status. Use **Download CSV** for grouped date, type, status and count rows. |

Deactivating a technician removes them from new assignment choices. Existing assignments keep the recorded name. Request edits and assignments use the existing version checks to reject concurrent stale saves. Older requests start unassigned.

Reports count currently retained submitted requests by their received date and current status. Deleted requests are excluded. CSV output contains grouped counts. Exports include a UTF-8 marker for spreadsheet software and escape formula-leading values. CSV downloads use the report's applied filters.

### Configure email status updates

This release uses **email through Resend** for customer status messages. In your existing server `.env`, add a Resend sending key and a sender address on a verified domain.

```dotenv
RESEND_API_KEY=your-resend-sending-key
NOTIFICATION_FROM=updates@your-verified-domain.com
```

Restart the app after editing. Use a plain email address for `NOTIFICATION_FROM`. Keep `PUBLIC_BASE_URL` set to the address customers can open. The consent option becomes available when the key and sender settings are present. Read the official [Resend send-email documentation](https://resend.com/docs/api-reference/emails/send-email) and [domain verification guide](https://resend.com/docs/dashboard/domains/introduction) for account setup.

After consent, the request stores the recipient address. A status change stores its email job in the same atomic request update. The worker checks every five seconds and processes one eligible job at a time, preserving each request's message order. Sender, recipient and body are stored with the job so retries use the same payload. API keys stay in the server environment.

Temporary network errors, rate limits and server failures retry automatically up to four attempts, respecting `Retry-After`. Expired worker leases recover after a restart. Each job has a stable idempotency key and a 23-hour retry window, within Resend's documented 24-hour key retention. A failed job can be retried by an owner or dispatcher from the request details during that window.

The staff email panel shows queued, sending, accepted, failed or cancelled. **Accepted by email service** records the provider accepting the message. Check the email service dashboard when investigating mailbox delivery. Stopping updates cancels pending work. Emails already dispatched may still arrive. Deleting a request removes its queued jobs along with its other active data.

### Verify version 2.3

1. As an owner, add two technicians. Assign one to a request, change to the other, then clear the assignment. Check that a viewer cannot save an assignment.
2. Configure email, submit a request with explicit email consent, and change its status as staff. Check the email panel and inbox. Submit another request without consent and confirm that status changes create no email job.
3. Open tracking with the private key and stop email updates. Change the status again and confirm that further emails are not queued.
4. As an owner, open Reports and choose a date range. Check type and status totals, download CSV, and compare its grouped counts with the applied report filters.

## Version 2.2 features

| Feature | How to use it |
| --- | --- |
| Remember staff queue filters and page | Apply filters in the staff queue. The URL keeps status, type, urgency, received dates, reference and page. Opening a request, returning to the queue, reloading or using browser Back restores the applied view. |
| New-request alerts | Keep the staff portal open. A check runs every 30 seconds while the tab is visible and when you return to it. The notice counts arrivals since opening the portal or the last successful queue refresh. Use **Refresh queue** to review them with your current filters. |
| Owner OpenAI connection test | Sign in as an owner, open **Service settings**, then choose **Test OpenAI connection**. The server sends a fixed vehicle question through the same model adapter and response validation used by the assistant. |

The alerts use the existing `request_created` audit events. A submission retry, status edit or deletion keeps the arrival count consistent. Alerts operate across the staff queue, request details and settings. A temporary check failure keeps the current notice and retries on the next check. Refreshing the whole staff portal starts a new alert baseline.

The OpenAI test uses the server's current `AI_PROVIDER`, `AI_API_KEY` and `AI_MODEL` configuration. Restart after editing the environment. The result shows a checked time and a safe diagnostic code. Tests are limited to three per minute per IP and can incur OpenAI API charges. The check sends a fixed test question and returns a validated connection result. Your local API key is needed to verify a live connection.

### Check the three features

1. Apply a type and urgency filter, move to another queue page if available, open a request and return. Reload the page and confirm the same filters and page are selected.
2. Keep a staff tab open and submit a new request from a customer tab. Return to the staff tab and check the arrival notice. Refresh the queue to review it. Try a filter that excludes the new request and confirm the filter is still applied.
3. Sign in as an owner and test OpenAI from Service settings. Confirm that the result shows either a validated response or a clear diagnostic such as `provider_http_401`, `provider_http_429` or `not_configured`.

## Run locally on Windows

Install [Node.js](https://nodejs.org/en/download) 22.12 or newer (Node 24 recommended) and [MongoDB Community](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/). During MongoDB installation, choose the Windows service option. Start that service, or use one of the alternatives below.

Open PowerShell in the extracted `gariseba-mern` folder containing `package.json`.

```powershell
node -v
npm.cmd ci
npm.cmd run setup
Test-NetConnection 127.0.0.1 -Port 27017
npm.cmd run create-admin -- owner owner
npm.cmd run seed
npm.cmd run build
npm.cmd start
```

- `setup` creates `.env` with random secrets. It keeps any existing `.env`. The default MongoDB address is `mongodb://127.0.0.1:27017`.
- Proceed after PowerShell reports `TcpTestSucceeded : True`. Check the installed service name with `Get-Service *Mongo*`. If the default service is stopped, run `Start-Service MongoDB` in PowerShell as administrator.
- At the staff prompt, type a password of at least 12 characters, at most 72 UTF-8 bytes, with a letter and a number. The terminal hides what you type. A rerun for the same username resets its credentials and revokes its existing sessions.
- `seed` is optional and adds labeled sample rates. The initial ৳500 battery starting rate also has a sample label until the owner configures business rates.
- Open [Customer site](http://localhost:3000) or [Staff portal](http://localhost:3000/admin). In a second PowerShell window, `Invoke-RestMethod http://localhost:3000/api/health` should show `ok True`.
- On macOS or Linux, replace `npm.cmd` with `npm`. For frontend development with hot reload, run `npm.cmd run dev` in place of `build` and `start`, then use [Vite](http://127.0.0.1:5173). Vite proxies API calls to Express.

### MongoDB alternatives

| Setup | What to do |
| --- | --- |
| Local Docker Desktop | With the local Windows service stopped or absent, run `docker compose up -d mongo`. The sample Compose file binds MongoDB to loopback and uses a persistent volume. |
| MongoDB Atlas | In `.env`, set `MONGODB_URI` to your Atlas connection string and `MONGODB_DB` to your app database. Set Atlas network access for your IP and give the database user access to this database. Skip the local port check. |

## Main flows

| Route | What it does |
| --- | --- |
| `/` | Service choices, instructions, emergency contact, FAQ and the language and theme controls |
| `/request` | Five-step request, area check, optional map pin, tentative guidance, pricing, private photo drafts, review and consent |
| `/assistant` | Car-related questions and follow-ups with optional provider AI. Use **Use in request** on a message to copy it into the editable problem field. |
| `/track` | Private lookup, status history, completed bill note, correction and deletion. Active requests refresh once a minute while the page is visible and show the last recorded update time. |
| `/privacy` | Request, photo, AI and WhatsApp data handling |
| `/admin` | Staff queue with status, reference, type, urgency and received date filters, plus request details, owner settings and audit log |

A submission begins at **Received**. A staff update confirms the technician. The status page shows staff updates. WhatsApp opens a prepared message after the customer opts in and chooses to open it. The customer presses Send. Verify the inherited `WHATSAPP_NUMBER` before public use.

In the staff queue, date filters use Dhaka time and include both selected dates. Use **Apply filters** to combine type, urgency, received dates and reference with the selected status.

### Staff roles

| Role | Access |
| --- | --- |
| `viewer` | Read the queue, request details, history and photos |
| `dispatcher` | Viewer access plus status, technician assignments, internal notes, completed bill notes, correction review and failed-email retries |
| `owner` | Dispatcher access plus delete, technician roster, reports/CSV, price rules, service areas, settings and activity log |

Create additional accounts with `npm.cmd run create-admin -- <username> <role>`.

### Live AI

Built-in symptom guidance works on a fresh setup. For provider-generated answers, configure these server-side values in `.env` and restart the app.

```dotenv
AI_PROVIDER=openai
AI_API_KEY=your-provider-api-key
AI_MODEL=your-enabled-model-id
```

Set `AI_PROVIDER=anthropic` for Claude. Use a model enabled in your provider account that supports its Responses or Messages endpoint. The customer must opt in on the assistant page. The request form uses built-in guidance and keeps its contact data, map pin and photos away from the provider. The assistant sends a bounded window of symptom messages after consent and removes common phone and email patterns. Keep identifying details out of the chat. The model is instructed to avoid repair procedures, price quotes and arrival promises. The app checks the response shape, screens for some unsafe or fabricated claims and uses built-in guidance when the provider fails or returns unsuitable output. A technician confirms the actual cause.

#### Check an OpenAI connection

From the project root, check which configuration the server reads. This command reports whether a key is present.

```bash
node -e 'const {ai,aiConfigured}=require("./src/config"); console.log({provider:ai.provider, model:ai.model, keyPresent:!!ai.key, configured:aiConfigured})'
```

Look for `provider: 'openai'`, `keyPresent: true` and `configured: true`. Restart the server after editing `.env`. Open `/assistant`, check the provider consent box and send a car question such as “Why does my car click when I turn the key?” A provider reply has the **AI-generated guidance** label. If the app uses built-in guidance after an OpenAI error, check the server terminal for `[assistant] Provider request failed`.

| Terminal code | What to check |
| --- | --- |
| `provider_http_401` | Verify that the key is valid and belongs to the intended OpenAI API project. |
| `provider_http_403` or `provider_http_404` | Check the model ID and whether the API project and key can access it. |
| `provider_http_429` | Check the API project's quota, billing and rate limits. |
| `TimeoutError` or `TypeError` | Check network access from the Node server to the OpenAI API. |
| `provider_incomplete_max_output_tokens`, `provider_empty_output` or `provider_invalid_output` | Try a Responses API model available to your account that can produce short answers, such as `gpt-5.4-mini`. |

## API overview

The browser gets a session cookie and CSRF token from `GET /api/bootstrap`. For state changes it sends the token in `X-CSRF-Token`. The app sends requests on the same origin as the page.

| API | Purpose |
| --- | --- |
| `GET /api/health`, `GET /api/bootstrap` | Database health and public app configuration |
| `POST /api/location/check`, `POST /api/chat/analyze` | Service-area match and symptom guidance |
| `POST /api/photos`, `DELETE /api/photos/:id`, `POST /api/requests` | Session-bound draft photos and request submission. Uploads use `X-Draft-Key` and `X-Photo-Key`. Submission uses `X-Draft-Key`. |
| `POST /api/requests/lookup`, `POST /api/requests/privacy` | Private tracking and customer data actions |
| `/api/admin/*` | Staff sign-in, queue, status edits, photos, business configuration and audit. Access depends on the account role. |

## Data and maintenance

- `web/` contains the Vite application. `src/` contains Express routes, storage and shared business logic. `scripts/` contains setup, staff creation, sample pricing, import and backup.
- MongoDB stores requests, status history and attached images together. Drafts expire after three hours. Staff sessions are stored in MongoDB and expire after two idle hours. Access to staff routes is role-checked on each request.
- Optional ClamAV scanning uses `CLAMAV_HOST` and `CLAMAV_PORT`. Keep the daemon private. Image signatures are validated and images are re-encoded whether or not ClamAV is configured.
- The current request deletion flow removes the active record and attached photos. Backups and WhatsApp copies follow their respective retention policies.

### Import older SQLite data

If you have a real legacy SQLite database and its photo folder, stop the old app and use its backup script to prepare a consistent standalone database. Keep the original backup. Set `MONGODB_DB` to a fresh name before starting GariSeba, seeding it, or creating accounts there.

```powershell
npm.cmd run import:sqlite -- "C:\Backups\lagbo-naki.db" "C:\Backups\uploads"
```

The importer transfers requests, status history, attached photos, tracking hashes, staff hashes and roles, service areas, pricing, settings and audit entries. Drafts and sessions start fresh. If a required file is missing, supply it and rerun with the same database backup and target. Verify imported records and tracking keys before opening the new app to customers. Legacy passwords longer than bcrypt’s 72-byte limit require a reset.

### Backup and deployment

Install [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools) for the backup command. A compressed archive includes the app collections and photos, excluding active staff/browser sessions.

```powershell
npm.cmd run backup
```

Backups contain private customer data. Store them with restricted access and test restoration into a separate empty MongoDB database. Use the official [mongodump](https://www.mongodb.com/docs/database-tools/mongodump/) and [mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/) instructions to manage archives.

For a public deployment, configure `NODE_ENV=production`, the real HTTPS `PUBLIC_BASE_URL`, persistent secrets, authenticated MongoDB and the host’s bind address. Set `TRUST_PROXY_HOPS` only when your HTTPS proxy is known and overwrites forwarded headers. Build on the deployment machine with dev dependencies installed, then run `npm start` behind HTTPS. Review business hours, pricing, area keywords, the privacy policy and the inherited WhatsApp number before accepting public requests. For multiple app instances, plan shared rate limiting. Location checks use configured text keywords and customer confirmation.

## Testing and troubleshooting

```powershell
npm.cmd run test:unit
npm.cmd test
npm.cmd audit
```

`npm test` uses a randomly named temporary database on the configured MongoDB server. For a separate test server, set `MONGODB_TEST_URI`. The tests create and remove only their own temporary databases.

| Symptom | Check |
| --- | --- |
| Cannot start GariSeba | Start MongoDB, then verify the local port or Atlas credentials and IP access. |
| Port is already in use | Stop the process using that port or set another `PORT` in `.env`, then restart and use the matching URL. |
| Page asks for a build | Run `npm.cmd run build` before `npm.cmd start`, or open the Vite URL from `npm.cmd run dev`. |
| Staff sign-in fails | Check the username and configured database. After lockout, wait or reset the account from the CLI. |
| Assistant uses built-in guidance | Check the provider, key, model ID, the restart and the user opt-in. |

The ZIP contains source code, a dependency lockfile and documentation. Configure the environment locally before using the application. Planned operational work includes business confirmation, a staging deployment and live provider checks. Automatic WhatsApp delivery, real-time dispatch and payment processing remain future features.
