# App Fee Payment API – Frontend Integration Guide

This document describes all API routes and payloads for implementing the app fee payment interface in the React frontend.

---

## Base URLs & Authentication

| Route Group | Base Path | Auth |
|-------------|-----------|------|
| App Fees (main) | `/app-fees` | Bearer token required |
| Financial (legacy) | `/` (root) | Bearer token required |

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `monthly_fee_per_house` | `500` | Fee per house per month (in local currency) |
| `default_subscription_days` | `30` | Subscription validity period |
| `default_offset_days` | `5` | Grace period after expiry before blocking |

**Amount formula:** `amount = house_count × monthly_fee_per_house`

---

## Email & Notifications

- **Email service:** All app-fee emails go through `EmailService` (see `src/services/email.service.js`) and are logged in `emaillog` with `table_name: 'app_fee'` and `row_id` = app_fee_payment id.
- **Templates (in `emailSmsNotification.service.js`):**
  - **app_fee_receipt** – Sent to house owner when a payment is accepted/recorded as paid. Uses `table_name: 'app_fee'`, `row_id: paymentId`.
  - **app_fee_request** – Sent to web_owner when a house_owner or caretaker submits a **pending** app fee payment request. Uses `table_name: 'app_fee'`, `row_id: paymentId`.
- **sendMail / sendSms:** When web_owner records or accepts an app fee, the request body can include:
  - `sendMail` (boolean, optional) – Default `true`. Set to `false` to skip sending the receipt email.
  - `sendSms` (boolean, optional) – Reserved for future use; currently unused.
- **House owner / caretaker creates pending:** By default, the system sends the request details to the **web_owner’s email** (one active web_owner). No extra parameter is required; use `sendMail: false` in the create-payment body to skip this notification.
- **Frontend pending alert:** When **web_owner** creates a **pending** app_fee record for a house owner, the payment `metadata` includes `webOwnerCreatedPending: true`. The frontend should show a **warning/alert modal** for such pending payments (e.g. “You have a pending app fee request created by admin”). When the **house_owner** (or caretaker) created the pending request themselves, `metadata.createdBy.role` is `house_owner` or `caretaker` and `webOwnerCreatedPending` is not set – in that case the frontend should **not** show the warning (it is the user’s own request).
- **Email to house_owner when web_owner/staff creates app fee:** When web_owner (or staff) creates an app fee (whether `status` is `pending` or `paid`), an email is sent to the house_owner by default (can be disabled with `sendMail: false`). For `pending` this acts as an invoice/notification; for `paid` it is a receipt.

---

## Routes Overview

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/app-fees/payments` | web_owner, staff, house_owner, caretaker | List payments (paginated) |
| GET | `/app-fees/payments/stats` | web_owner, staff, house_owner, caretaker | Payment statistics |
| GET | `/app-fees/payments/status/:house_owner_id` | web_owner, staff, house_owner, caretaker | App fee status for owner |
| GET | `/app-fees/payments/calculate-due/:house_owner_id` | web_owner, staff, house_owner, caretaker | Calculate due amount |
| GET | `/app-fees/payments/:id` | web_owner, staff, house_owner, caretaker | Get single payment |
| POST | `/app-fees/payments` | web_owner, staff, house_owner, caretaker | Create payment |
| PUT | `/app-fees/payments/:id` | web_owner, staff | Update/verify payment |
| DELETE | `/app-fees/payments/:id` | web_owner, staff | Soft delete payment |
| POST | `/app-fees/payments/generate-monthly` | web_owner | Generate monthly fees (cron) |
| GET | `/app-fees/email-log` | web_owner, staff | List app fee email log (paginated) |
| GET | `/app-fees/email-log/:row_id` | web_owner, staff, house_owner, caretaker | Email log for one payment |
| POST | `/app-fees/resend-mail/:id` | web_owner, staff | Resend app fee email (receipt or request) |
| GET | `/payments/app-fee` | web_owner, staff, caretaker | List app fee payments (legacy) |
| POST | `/payments/app-fee` | web_owner | Record app fee payment (legacy) |

---

## 1. List Payments

**GET** `/app-fees/payments`

**Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `house_owner_id` | number | No | Filter by house owner |
| `status` | string | No | `pending`, `paid`, `overdue`, `cancelled` |
| `fee_type` | string | No | e.g. `monthly_subscription` |
| `payment_method` | string | No | e.g. `bank_transfer`, `mobile_money`, `cash`, `other` |
| `start_date` | string | No | Filter start_date >= (YYYY-MM-DD) |
| `end_date` | string | No | Filter start_date <= (YYYY-MM-DD) |
| `search` | string | No | Search in name, email, phone, transaction_id, notes |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 20 |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "uuid": "uuid-string",
      "house_owner_id": 5,
      "house_owner_name": "John Doe",
      "house_owner_email": "john@example.com",
      "house_owner_phone": "+1234567890",
      "house_count": 2,
      "amount": 1000,
      "fee_type": "monthly_subscription",
      "start_date": "2025-02-10T00:00:00.000Z",
      "paid_date": null,
      "subscription_days": 30,
      "offset_days": 5,
      "payment_method": "bank_transfer",
      "transaction_id": "TXN123",
      "status": "pending",
      "notes": "Payment proof attached",
      "verified_by": null,
      "verifier_name": null,
      "verifier_email": null,
      "metadata": { "createdBy": {...}, "proofImageUrl": "...", "additionalNotes": "..." },
      "created_at": "2025-02-01T10:00:00.000Z",
      "updated_at": "2025-02-01T10:00:00.000Z",
      "house_owner_active_houses": 2,
      "expected_amount": 1000,
      "appFeeStatus": {
        "isActive": true,
        "expiresAt": "2025-03-15T00:00:00.000Z",
        "blockAfter": "2025-03-20T00:00:00.000Z",
        "inGracePeriod": false,
        "isBlocked": false,
        "lastPaidPayment": {...},
        "canCreatePayment": true
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

---

## 2. Get Payment Statistics

**GET** `/app-fees/payments/stats`

**Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `house_owner_id` | number | No | Filter by house owner |
| `year` | number | No | Filter by year of start_date |
| `month` | number | No | Filter by month of start_date |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "total_paid": 15000,
    "total_pending": 3000,
    "total_overdue": 500,
    "total_count": 25,
    "pending_payments": [
      {
        "id": 10,
        "house_owner_id": 5,
        "house_owner_name": "John Doe",
        "house_owner_email": "john@example.com",
        "amount": 1000,
        "start_date": "2025-02-10T00:00:00.000Z",
        "status": "pending"
      }
    ],
    "recent_payments": [
      {
        "id": 9,
        "house_owner_id": 4,
        "house_owner_name": "Jane Smith",
        "house_owner_email": "jane@example.com",
        "amount": 500,
        "paid_date": "2025-02-05T00:00:00.000Z",
        "status": "paid"
      }
    ],
    "monthly_fee_per_house": 500
  }
}
```

---

## 3. Get App Fee Status (for a House Owner)

**GET** `/app-fees/payments/status/:house_owner_id`

**Path params:** `house_owner_id` – user ID of the house owner

**Response 200:**
```json
{
  "success": true,
  "data": {
    "isActive": true,
    "expiresAt": "2025-03-15T00:00:00.000Z",
    "blockAfter": "2025-03-20T00:00:00.000Z",
    "inGracePeriod": false,
    "isBlocked": false,
    "lastPaidPayment": {
      "id": 8,
      "paid_date": "2025-02-14T00:00:00.000Z",
      "subscription_days": 30,
      "offset_days": 5,
      "house_count": 2,
      "amount": 1000
    },
    "canCreatePayment": true
  }
}
```

**When no paid payment exists:**
```json
{
  "success": true,
  "data": {
    "isActive": false,
    "expiresAt": null,
    "blockAfter": null,
    "inGracePeriod": false,
    "isBlocked": true,
    "lastPaidPayment": null,
    "canCreatePayment": true
  }
}
```

---

## 4. Calculate Due Amount

**GET** `/app-fees/payments/calculate-due/:house_owner_id`

**Path params:** `house_owner_id` – user ID of the house owner

**Response 200:**
```json
{
  "success": true,
  "data": {
    "houseOwnerId": 5,
    "activeHouseCount": 2,
    "monthlyFeePerHouse": 500,
    "totalDue": 1000,
    "hasPendingPayment": true,
    "pendingPaymentId": 10,
    "appFeeStatus": {
      "isActive": true,
      "expiresAt": "2025-03-15T00:00:00.000Z",
      "blockAfter": "2025-03-20T00:00:00.000Z",
      "inGracePeriod": false,
      "isBlocked": false,
      "lastPaidPayment": {...},
      "canCreatePayment": true
    }
  }
}
```

**Response 404:** `{ "success": false, "error": "Unable to calculate due amount" }`

---

## 5. Get Single Payment

**GET** `/app-fees/payments/:id`

**Path params:** `id` – payment ID

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "uuid": "uuid-string",
    "house_owner_id": 5,
    "house_owner_name": "John Doe",
    "house_owner_email": "john@example.com",
    "house_owner_phone": "+1234567890",
    "house_count": 2,
    "amount": 1000,
    "fee_type": "monthly_subscription",
    "start_date": "2025-02-10T00:00:00.000Z",
    "paid_date": null,
    "subscription_days": 30,
    "offset_days": 5,
    "payment_method": "bank_transfer",
    "transaction_id": "TXN123",
    "status": "pending",
    "notes": "Payment proof attached",
    "verified_by": null,
    "verifier_name": null,
    "verifier_email": null,
    "metadata": { "createdBy": {...}, "proofImageUrl": "...", "additionalNotes": "..." },
    "created_at": "2025-02-01T10:00:00.000Z",
    "updated_at": "2025-02-01T10:00:00.000Z"
  }
}
```

**Response 404:** `{ "success": false, "error": "Payment not found" }`

---

## 6. Create Payment

**POST** `/app-fees/payments`

**Body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `house_owner_id` | number | Yes | House owner user ID |
| `amount` | number | Yes | Payment amount |
| `payment_method` | string | Yes* | `bank_transfer`, `mobile_money`, `cash`, `other` – required when creating pending |
| `house_count` | number | No | Number of houses covered; defaults to active house count |
| `transaction_id` | string | No | External transaction reference |
| `notes` | string | No | Additional notes |
| `proof_image_url` | string | No | URL of payment proof image |
| `status` | string | No | `paid` – only web_owner can create with `paid` directly |
| `subscription_days` | number | No | Default: 30 |
| `offset_days` | number | No | Default: 5 |
| `start_date` | string | No | ISO date. For **web_owner/staff** only: start date of the invoice period. See *Invoice rules (web_owner/staff)* below. For house_owner/caretaker defaults to today. |
| `sendMail` | boolean | No | Default `true`. When web_owner creates `paid`: send receipt to house owner. When house_owner/caretaker creates `pending`: send request notification to web_owner. **No email is sent to house_owner when web_owner creates pending.** Set `false` to skip. |
| `sendSms` | boolean | No | Reserved; unused for now. |

*When `status: "paid"` (web_owner only), `payment_method` defaults to `other` if omitted.

**Invoice rules (web_owner / staff only):** When web_owner or staff creates an app fee payment for a house_owner, the API enforces:
1. If there is already a **pending** invoice for that house_owner, it checks whether **today** falls within that pending’s period `[start_date, start_date + subscription_days]`.
   - If **yes**: response `400` with message *"There is already a pending invoice, within range today."*
   - If **no**: a new invoice is allowed. The new invoice’s `start_date` must be after the previous period: if `start_date` is provided it must be ≥ (previous `start_date` + `subscription_days`); if not provided it is set to **previous `start_date` + subscription_days + 1** (no overlap). If there is no previous invoice, `start_date` is the provided value or today.
2. This keeps subscription periods non-overlapping and avoids calculation mismatch.

When **web_owner** creates a **pending** payment, the created record has `metadata.webOwnerCreatedPending: true` so the frontend can show an alert. When house_owner/caretaker creates pending, this flag is not set (frontend should not alert for own request).

**Example – House owner creates pending payment:**
```json
{
  "house_owner_id": 5,
  "amount": 1000,
  "payment_method": "bank_transfer",
  "transaction_id": "TXN-2025-001",
  "notes": "Paid via mobile banking",
  "proof_image_url": "https://..."
}
```

**Example – Web owner creates paid payment directly:**
```json
{
  "house_owner_id": 5,
  "amount": 1000,
  "status": "paid",
  "payment_method": "cash"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 11,
    "uuid": "uuid-string",
    "house_owner_id": 5,
    "house_owner_name": "John Doe",
    "house_owner_email": "john@example.com",
    "house_count": 2,
    "amount": 1000,
    "fee_type": "monthly_subscription",
    "start_date": "2025-02-10T00:00:00.000Z",
    "paid_date": "2025-02-05T00:00:00.000Z",
    "subscription_days": 30,
    "offset_days": 5,
    "payment_method": "bank_transfer",
    "transaction_id": "TXN-2025-001",
    "status": "paid",
    "notes": "Paid via mobile banking",
    "verified_by": 1,
    "verifier_name": "Admin User",
    "metadata": {...},
    "created_at": "2025-02-05T10:00:00.000Z",
    "updated_at": "2025-02-05T10:00:00.000Z"
  },
  "message": "App fee payment recorded successfully."
}
```

**Error responses:**
- `400` – `house_owner_id and amount are required`, `payment_method is required when creating a pending payment`, `house_count cannot exceed your active house count`, `amount must be a valid number`, *"There is already a pending invoice, within range today."* (web_owner/staff), or `start_date` too early (must be ≥ previous start_date + subscription_days)
- `403` – Permission denied
- `404` – `House owner not found or inactive`

---

## 7. Update Payment (Verify / Reject)

**PUT** `/app-fees/payments/:id`

**Roles:** web_owner, staff (with `app_fees.verify` permission)

**Body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | `paid` (accept) or `rejected` |
| `notes` | string | No | General notes |
| `verified_notes` | string | No | Verification-specific notes (appended) |
| `paid_date` | string | No | ISO date when paid (used when accepting) |
| `transaction_id` | string | No | External transaction reference |
| `payment_method` | string | No | Payment method |
| `invoice_url` | string | No | Invoice URL |
| `subscription_days` | number | No | Override subscription days |
| `offset_days` | number | No | Override offset days |
| `sendMail` | boolean | No | Default `true`. When accepting (`status: "paid"`), send receipt email to house owner. Set `false` to skip. |
| `sendSms` | boolean | No | Reserved; unused for now. |

**Example – Accept payment:**
```json
{
  "status": "paid",
  "verified_notes": "Payment confirmed in bank statement",
  "paid_date": "2025-02-05"
}
```

**Example – Reject payment:**
```json
{
  "status": "rejected",
  "verified_notes": "Invalid transaction reference"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 10,
    "uuid": "uuid-string",
    "house_owner_id": 5,
    "house_owner_name": "John Doe",
    "house_owner_email": "john@example.com",
    "house_count": 2,
    "amount": 1000,
    "fee_type": "monthly_subscription",
    "start_date": "2025-02-10T00:00:00.000Z",
    "paid_date": "2025-02-05T00:00:00.000Z",
    "subscription_days": 30,
    "offset_days": 5,
    "payment_method": "bank_transfer",
    "transaction_id": "TXN-2025-001",
    "status": "paid",
    "notes": "...",
    "verified_by": 1,
    "verifier_name": "Admin User",
    "metadata": {...},
    "created_at": "2025-02-01T10:00:00.000Z",
    "updated_at": "2025-02-05T12:00:00.000Z"
  },
  "message": "Payment updated successfully"
}
```

**Error responses:**
- `403` – `You do not have permission to verify payments`
- `404` – `Payment not found`

---

## 8. Delete Payment (Soft Delete)

**DELETE** `/app-fees/payments/:id`

**Roles:** web_owner, staff (with `app_fees.delete` permission)

**Response 200:**
```json
{
  "success": true,
  "message": "Payment deleted successfully"
}
```

**Error responses:**
- `403` – `You do not have permission to delete payments`
- `404` – `Payment not found`

---

## 9. Generate Monthly Fees (Cron)

**POST** `/app-fees/payments/generate-monthly`

**Roles:** web_owner only

**Body:** None

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "ownerId": 5, "paymentId": 12, "amount": 1000 },
    { "ownerId": 6, "paymentId": 13, "amount": 500 }
  ],
  "message": "Generated 2 monthly fee payments"
}
```

---

## 10. Get App Fee Email Log (Paginated)

**GET** `/app-fees/email-log`

**Roles:** web_owner, staff (with `app_fees.view`)

**Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `sort` | string | No | `asc` or `desc` (by `sentAt`). Default: `desc` |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 20, max 100 |

Returns rows from `emaillog` where `table_name = 'app_fee'`.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "123",
      "type": "app_fee_receipt",
      "toEmail": "owner@example.com",
      "subject": "App Fee Receipt: 1000 - Subscription",
      "status": "sent",
      "error": null,
      "table_name": "app_fee",
      "row_id": "10",
      "sentAt": "2025-02-05T10:00:00.000Z",
      "metadata": "{\"messageId\":\"...\"}"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

---

## 11. Get App Fee Email Log by Payment (row_id)

**GET** `/app-fees/email-log/:row_id`

**Roles:** web_owner, staff, house_owner (own payment only), caretaker (assigned owners only)

**Path params:** `row_id` – app_fee_payment id

Returns all `emaillog` rows where `table_name = 'app_fee'` and `row_id = :row_id`, ordered by `sentAt` desc. No pagination.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "123",
      "type": "app_fee_receipt",
      "toEmail": "owner@example.com",
      "subject": "App Fee Receipt: 1000 - Subscription",
      "status": "sent",
      "error": null,
      "table_name": "app_fee",
      "row_id": "10",
      "sentAt": "2025-02-05T10:00:00.000Z",
      "metadata": "{\"messageId\":\"...\"}"
    }
  ]
}
```

**Response 404:** `{ "success": false, "error": "Payment not found" }`

---

## 12. Resend App Fee Email

**POST** `/app-fees/resend-mail/:id`

**Roles:** web_owner, staff (with `app_fees.verify`)

**Path params:** `id` – app_fee_payment id

Resends the appropriate email for that payment:
- If payment **status is `paid`**: resends **receipt** to the house owner.
- If payment **status is `pending`**: resends **request notification** to the web_owner.

Use this after a failed email or to resend a receipt/notification.

**Response 200:**
```json
{
  "success": true,
  "message": "Email has been queued for delivery"
}
```

**Error responses:**
- `400` – `Cannot resend email for this payment status` (e.g. cancelled/rejected)
- `403` – Permission denied
- `404` – `Payment not found`

---

## 13. List App Fee Payments (Legacy)

**GET** `/payments/app-fee`

**Roles:** web_owner, staff, caretaker

**Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | Filter by status |
| `houseOwnerId` | number | No | Filter by house owner |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "uuid": "uuid-string",
      "house_owner_id": 5,
      "house_count": 2,
      "amount": 1000,
      "fee_type": "monthly_subscription",
      "start_date": "2025-02-10T00:00:00.000Z",
      "paid_date": null,
      "subscription_days": 30,
      "offset_days": 5,
      "payment_method": "bank_transfer",
      "transaction_id": "TXN123",
      "status": "pending",
      "created_at": "2025-02-01T10:00:00.000Z",
      "updated_at": "2025-02-01T10:00:00.000Z"
    }
  ]
}
```

---

## 14. Record App Fee Payment (Legacy – Web Owner Direct Record)

**POST** `/payments/app-fee`

**Roles:** web_owner only

**Body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `house_owner_id` | number | Yes | House owner user ID |
| `amount` | number | Yes | Payment amount |
| `house_count` | number | No | Defaults to active house count |
| `fee_type` | string | No | Default: `monthly_subscription` |
| `start_date` | string | No | ISO date; defaults to today |
| `payment_method` | string | No | Default: `other` |
| `transaction_id` | string | No | External transaction reference |
| `subscription_days` | number | No | Default: 30 |
| `offset_days` | number | No | Default: 5 |
| `sendMail` | boolean | No | Default `true`. Send receipt email to house owner. Set `false` to skip. |
| `sendSms` | boolean | No | Reserved; unused for now. |

**Example:**
```json
{
  "house_owner_id": 5,
  "amount": 1000,
  "payment_method": "cash",
  "transaction_id": "OFF-001"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 14,
    "uuid": "uuid-string",
    "house_owner_id": 5,
    "house_count": 2,
    "amount": 1000,
    "fee_type": "monthly_subscription",
    "start_date": "2025-02-10T00:00:00.000Z",
    "paid_date": "2025-02-05T00:00:00.000Z",
    "subscription_days": 30,
    "offset_days": 5,
    "payment_method": "cash",
    "transaction_id": "OFF-001",
    "status": "paid",
    "verified_by": 1,
    "verified_at": "2025-02-05T10:00:00.000Z",
    "created_at": "2025-02-05T10:00:00.000Z",
    "updated_at": "2025-02-05T10:00:00.000Z"
  },
  "message": "App fee payment recorded successfully"
}
```

**Error responses:**
- `403` – `Only web owner can record app fee payments`
- `404` – `House owner not found`

---

## Data Model: App Fee Payment

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Primary key |
| `uuid` | string | UUID |
| `house_owner_id` | number | User ID of house owner |
| `house_count` | number | Number of houses covered |
| `amount` | number | Payment amount |
| `fee_type` | string | e.g. `monthly_subscription` |
| `start_date` | datetime | Start date of the subscription period |
| `paid_date` | datetime | When paid (null if pending) |
| `subscription_days` | number | Validity period |
| `offset_days` | number | Grace period after expiry |
| `payment_method` | string | `bank_transfer`, `mobile_money`, `cash`, `other` |
| `transaction_id` | string | External reference |
| `status` | string | `pending`, `paid`, `overdue`, `cancelled`, `rejected` |
| `notes` | string | Notes |
| `verified_by` | number | User ID of verifier (null if pending) |
| `verified_at` | datetime | Verification time |
| `metadata` | object | JSON with `createdBy`, `verifiedBy`, `proofImageUrl`, `webOwnerCreatedPending` (true when web_owner created as pending; frontend use for alert), etc. |
| `created_at` | datetime | Created at |
| `updated_at` | datetime | Updated at |
| `deleted_at` | datetime | Soft delete timestamp (null if active) |

---

## Staff Permissions

Staff role requires these permissions for app fee operations:

| Permission | Description |
|------------|-------------|
| `app_fees.view` | View payments and stats |
| `app_fees.create` | Create payments |
| `app_fees.verify` | Accept/reject payments (PUT) |
| `app_fees.delete` | Soft delete payments |

---

## Role-Based Access Summary

| Action | house_owner | caretaker | staff | web_owner |
|--------|-------------|-----------|-------|-----------|
| List own payments | ✓ | ✓ (assigned owners) | ✓ (with permission) | ✓ (all) |
| Create pending | ✓ (self only) | ✓ (assigned owners) | ✓ (with permission) | ✓ |
| Create paid directly | ✗ | ✗ | ✗ | ✓ |
| Verify (accept/reject) | ✗ | ✗ | ✓ (with permission) | ✓ |
| Delete | ✗ | ✗ | ✓ (with permission) | ✓ |
| Generate monthly | ✗ | ✗ | ✗ | ✓ |
| Record via `/payments/app-fee` | ✗ | ✗ | ✗ | ✓ |
| View email log (all) | ✗ | ✗ | ✓ (with permission) | ✓ |
| View email log (by row_id, own/assigned) | ✓ (own) | ✓ (assigned) | ✓ (with permission) | ✓ |
| Resend app fee email | ✗ | ✗ | ✓ (with app_fees.verify) | ✓ |
