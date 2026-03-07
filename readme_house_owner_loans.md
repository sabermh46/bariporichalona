# House Owner Loan APIs & Workflows

This document describes the loan management APIs and workflows for **house owners** — how they create (mark) a loan for their house and record paid amounts.

---

## Base URL & Auth

- **Base path:** `/api/loans`
- **Auth:** Bearer token required (JWT in `Authorization: Bearer <token>` header)
- **Access:** Any authenticated user can call these endpoints. For **house_owner** role, access is restricted to houses they own (`house.ownerId === req.user.id`). Staff, web_owner, and caretaker may have broader access depending on house hierarchy.

---

## Data Model

### `house_loan`

| Field | Type | Description |
|-------|------|-------------|
| `id` | BigInt | Primary key |
| `uuid` | string | Unique identifier |
| `house_id` | BigInt | FK to `house` |
| `provider_name` | string | Lender/provider name |
| `amount` | Decimal | Total loan amount |
| `interest_rate` | Decimal? | Optional |
| `start_date` | Date | Required |
| `end_date` | Date? | Optional |
| `monthly_payment` | Decimal? | Optional |
| `paid_amount` | Decimal | Running total of payments (default 0) |
| `status` | string | `active` or `paid` |
| `metadata` | JSON? | Optional extra data |

### `house_loan_payment`

| Field | Type | Description |
|-------|------|-------------|
| `id` | BigInt | Primary key |
| `uuid` | string | Unique identifier |
| `loan_id` | BigInt | FK to `house_loan` |
| `amount` | Decimal | Payment amount |
| `payment_date` | Date | When payment was made |
| `transaction_id` | string? | Optional reference |
| `notes` | string? | Optional notes |

---

## API endpoint naming

All loan routes use clear prefixes so you can tell them apart:

- **`loan-`** — operations on a **loan** (house_loan): create, list by house, get one, update, delete.
- **`loan-payment-`** — operations on a **loan payment** (house_loan_payment): create, update.

Base path: **`/api/loans`**.

---

## Workflow 1: Create a Loan (Mark House Has a Loan)

**Endpoint:** `POST /api/loans/loan-create`

**Purpose:** House owner marks that they have a loan for a house.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `house_id` | number | Yes | House ID (must be owned by house_owner) |
| `provider_name` | string | Yes | Lender/provider name |
| `amount` | number | Yes | Total loan amount |
| `start_date` | string | Yes | ISO date (e.g. `2025-01-15`) |
| `interest_rate` | number | No | Interest rate |
| `end_date` | string | No | ISO date |
| `monthly_payment` | number | No | Monthly payment amount |
| `metadata` | object | No | Extra JSON data |

**Example:**

```json
{
  "house_id": 5,
  "provider_name": "Bank XYZ",
  "amount": 500000,
  "start_date": "2025-01-15",
  "interest_rate": 8.5,
  "monthly_payment": 4500
}
```

**Response 201:**

```json
{
  "success": true,
  "message": "Loan created successfully",
  "data": {
    "id": 1,
    "uuid": "...",
    "house_id": 5,
    "provider_name": "Bank XYZ",
    "amount": "500000.00",
    "interest_rate": "8.50",
    "start_date": "2025-01-15",
    "end_date": null,
    "monthly_payment": "4500.00",
    "paid_amount": "0.00",
    "status": "active",
    "metadata": null,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Validation:**

- House must exist.
- For **house_owner**: `house.ownerId` must equal `req.user.id`.

**Errors:**

- `400` — Missing required fields: `house_id`, `provider_name`, `amount`, `start_date`
- `403` — Unauthorized (house_owner does not own the house)
- `404` — House not found

---

## Workflow 2: Record a Paid Amount (Payment Record)

**Endpoint:** `POST /api/loans/loan-payment-create/:loanId`

**Purpose:** Record a payment made toward the loan. This is purely for record-keeping; no payment gateway integration.

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| `loanId` | number | Loan ID |

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | number | Yes | Payment amount |
| `payment_date` | string | Yes | ISO date (e.g. `2025-03-01`) |
| `transaction_id` | string | No | Bank/transaction reference |
| `notes` | string | No | Optional notes |

**Example:**

```json
{
  "amount": 4500,
  "payment_date": "2025-03-01",
  "transaction_id": "TXN-12345",
  "notes": "Monthly EMI"
}
```

**Response 201:**

```json
{
  "success": true,
  "message": "Payment recorded successfully",
  "data": {
    "id": 1,
    "uuid": "...",
    "loan_id": 1,
    "amount": "4500.00",
    "payment_date": "2025-03-01",
    "transaction_id": "TXN-12345",
    "notes": "Monthly EMI",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Backend behavior:**

1. Inserts a row into `house_loan_payment`.
2. Updates `house_loan.paid_amount` += `amount`.
3. If `paid_amount >= loan.amount`, sets `house_loan.status` to `paid`.

**Validation:**

- House owner must own the house associated with the loan.

**Errors:**

- `400` — Missing `amount` or `payment_date`
- `403` — Unauthorized
- `404` — Loan not found

---

## Fetch APIs: Payments Attached

Both loan fetch APIs attach `house_loan_payment` to each loan:

- **GET /api/loans/loan/:loanId** — Returns one loan with a `payments` array (payment history, newest first).
- **GET /api/loans/loan-by-house/:houseId** — Returns an array of loans; each loan includes a `payments` array.

---

## Edit a Loan Payment

**Endpoint:** `PUT /api/loans/loan-payment/:loanPaymentId`

**Purpose:** Edit an existing payment record (amount, date, transaction_id, notes). Updating `amount` recalculates the loan’s `paid_amount` and may set loan `status` to `paid` or back to `active`.

**Path params:** `loanPaymentId` — ID of the `house_loan_payment` row.

**Request body (JSON):** All fields optional.

| Field | Type | Description |
|-------|------|-------------|
| `amount` | number | New payment amount (updates loan total paid) |
| `payment_date` | string | ISO date |
| `transaction_id` | string | Reference |
| `notes` | string | Notes |

**Response 200:** Updated payment object. Same ownership checks as other loan endpoints.

---

## All API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/loans/loan-create` | Create a loan |
| GET | `/api/loans/loan-by-house/:houseId` | List all loans for a house (each with `payments`) |
| GET | `/api/loans/loan/:loanId` | Get loan details (including `payments`) |
| PUT | `/api/loans/loan/:loanId` | Update loan |
| DELETE | `/api/loans/loan/:loanId` | Delete loan |
| POST | `/api/loans/loan-payment-create/:loanId` | Record a payment |
| PUT | `/api/loans/loan-payment/:loanPaymentId` | Edit a payment record |

All of these enforce the same ownership checks for house_owner.

---

## DNA Integration (Managed Users)

When fetching managed users with `expand=dna`:

- `dna.loans` — All loans for their houses (`house_loan`).
- `dna.loanPayments` — All loan payment rows for those loans (`house_loan_payment`), newest first.

Example: `GET /auth/managed-users?role=house_owner&expand=dna` returns house owners with loans and loan payments in their DNA.

---

## Summary

| Action | Endpoint | Purpose |
|--------|----------|---------|
| Create loan | `POST /api/loans/loan-create` | Mark house has a loan |
| List loans | `GET /api/loans/loan-by-house/:houseId` | List loans for a house |
| Loan details | `GET /api/loans/loan/:loanId` | Loan + payment history |
| Update loan | `PUT /api/loans/loan/:loanId` | Edit loan details |
| Delete loan | `DELETE /api/loans/loan/:loanId` | Remove loan |
| Record payment | `POST /api/loans/loan-payment-create/:loanId` | Record paid amount (for record only) |
| Update payment | `PUT /api/loans/loan-payment/:loanPaymentId` | Edit a payment record |
