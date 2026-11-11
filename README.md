# GariSeba 2.1

GariSeba is a bilingual roadside request and vehicle guidance app for Dhaka. The project originated as LAGBO NAKI?. It uses React, HTML, CSS and Tailwind on the frontend, Node.js and Express for the API, and MongoDB for data. The Word guide in `docs/` covers the original GariSeba setup in Bangla.

## Upgrade from 2.0 on Linux

Stop the old Node server, extract the new archive in a separate directory, and copy your existing `.env` into the new `gariseba-mern` folder. Keep its MongoDB URI, database name and secrets so your accounts, requests and tracking keys carry over. Use the same running MongoDB instance. If you configured Compose for MongoDB 7.0, use your working `compose.yaml` and volume when starting MongoDB again.

From the new folder containing `package.json`, run these commands.

```bash
npm ci
npm run build
npm start
```

Open the address shown in the terminal. If you previously used port 3001, keep `PORT=3001` and `PUBLIC_BASE_URL=http://localhost:3001` in `.env` and open [http://localhost:3001](http://localhost:3001).

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
| `dispatcher` | Viewer access plus status, internal notes, completed bill notes and correction review |
| `owner` | Dispatcher access plus delete, price rules, service areas, settings and activity log |

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
