# Optional SMS status updates (v2.7)

SMS is disabled by default. Your current database, staff passwords, port, AI keys, Resend settings and tracking keys do not need changes. The bill and feedback features work without SMS credentials.

The integration uses the official Twilio Programmable Messaging REST API. Use your own Twilio account with an SMS-capable sender, suitable destination permissions, and sufficient balance. A trial account can send only to verified recipients. Confirm availability and sender requirements for Bangladesh in your provider account before using real customer numbers.

## Enable with new optional variables

Append these **new** variables to your existing `.env`; keep its existing entries intact. The placeholders below are not working credentials.

```dotenv
SMS_ENABLED=true
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM=your_sms_capable_international_number
```

Alternatively, use `TWILIO_MESSAGING_SERVICE_SID=your_messaging_service_sid` instead of `TWILIO_FROM`. A Messaging Service SID starts with `MG`. When both are set, the Messaging Service is used. Account SIDs start with `AC`; the sender phone uses international format, such as a leading `+` and country code. Do not copy the callback number or inherited WhatsApp number into the sender field unless it is actually an SMS-capable sender provisioned on your Twilio account.

Restart `npm start` after changing environment variables. The request form shows the separate SMS consent checkbox only when the configuration is complete. Leaving `SMS_ENABLED` unset or setting it to `false` keeps SMS disabled. Incomplete SMS configuration leaves the rest of the app working.

## Customer and staff flow

1. The customer explicitly selects SMS updates on the contact step. The callback phone is normalized to Bangladesh international mobile format. Existing requests and customers are not enrolled automatically.
2. An owner, dispatcher, or assigned technician changes a request status. The same version-checked database update queues one SMS alongside the status history. Saving notes, assignments or an unchanged status does not queue SMS.
3. The server worker sends waiting jobs about every five seconds. The message contains the request reference and status with a link to `/track`; the secret tracking key is never included. A queued job expires after one hour, and submitted messages use a ten-minute provider queue validity period.
4. Staff can see Queued, Sending, Accepted, Failed, Cancelled or Unknown in the request's SMS panel. **Accepted** means the provider accepted the API request. It does not confirm delivery to the handset. Choose **Check SMS delivery** to save the provider's latest delivery result. No public webhook setup is needed.
5. The customer can stop SMS from their private tracking page. Waiting jobs are cancelled, and later status changes do not queue SMS. A message already submitted to the provider can still arrive. Deleting a request removes its local bill, feedback, photos and notification queue together; provider retention and downloaded copies are separate.

## Retries and failure handling

- HTTP 429 gets a bounded backoff (30 seconds, 2 minutes, then 10 minutes), with no more than four attempts per job and no attempts after expiration. The oldest waiting message is handled first for each request.
- Explicit provider rejections such as HTTP 400/401 are shown as Failed. An owner or dispatcher can choose **Retry rejected SMS** after fixing the cause, within the remaining attempt and expiration limits.
- A network timeout, malformed success, HTTP 5xx, or interrupted send has an uncertain outcome. It is marked Unknown and is never resent automatically. Check the Twilio message logs before arranging a separate resend. This avoids charging twice for a message that may already have been accepted.
- Delivery lookup is read-only and cannot resend a message. It uses only the stored message SID belonging to the configured provider account. Provider response text and authentication secrets are not saved in the delivery summary.

Only HTTP 429 is automatically retried because the provider documents those requests as unprocessed and safe to retry. A failed database write after acceptance is also treated conservatively: an expired send lease becomes Unknown rather than being replayed.

## Test in your environment

Use a number you control and choose the consent checkbox on a test request. Change that request's status once, refresh the SMS panel, and check both the provider message log and the recipient phone. Then test **Stop SMS updates**. Paid live delivery was not performed as part of the ZIP's automated tests; those use synthetic credentials and mocked provider responses. Bangla messages can use more billable SMS segments than short English messages.

References:

- [Create and fetch a message](https://www.twilio.com/docs/messaging/api/message-resource)
- [HTTP 429 safe retry behavior](https://www.twilio.com/docs/api/errors/20429)
- [Messaging geographic permissions](https://www.twilio.com/docs/messaging/guides/sms-geo-permissions)
- [Bangladesh SMS guidelines](https://www.twilio.com/en-us/guidelines/bd/sms)
