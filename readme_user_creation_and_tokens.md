# User Creation & Registration Tokens – Frontend Guide

This document describes the APIs for **creating users** and **registration tokens** so the frontend can implement admin user creation and invite flows.

**Base path for all routes below:** `/auth`  
**Authentication:** Bearer token in `Authorization` header (unless noted as public).

---

## Overview: Two Ways to Add Users

| Method | Who | Flow |
|--------|-----|------|
| **1. Generate token** | Admin (web_owner/staff) generates a link; invitee signs up via that link | `POST /auth/generate-token` → share `registrationLink` → user opens link and `POST /auth/register` with token |
| **2. Create user directly** | Admin creates account in one step (optional: also get a registration token/link) | `POST /auth/create-user` with email, name, role, password (or auto-generated) |

---

## 1. Generate Registration Token

**POST** `/auth/generate-token`

**Auth:** Bearer token required. **Roles:** `web_owner`, `staff`.

- **Staff** can only generate tokens for `house_owner` or `caretaker`, and must have permission `registrationToken.create`.
- **Staff** generating a **caretaker** token must send `metadata.house_owner_id`.
- **Web owner** can generate tokens for any role below (staff, house_owner, caretaker).

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | No | Pre-fill invitee email (optional). If provided and already registered, API returns error. |
| `roleSlug` | string | No | `house_owner` \| `staff` \| `caretaker`. Default: `house_owner`. |
| `expiresInHours` | number | No | Token validity in hours. Default: 24. |
| `metadata` | object or string | No | Role-specific data (see below). |

**metadata (by role):**

- **caretaker** (required): `house_owner_id`, optional `house_ids` (array of house IDs), optional `expires_at`, optional `default_permissions` (array of permission keys).
- **house_owner**: optional `initial_houses` (array of `{ name, address, active, metadata }`).
- **staff**: optional `default_permissions` (array of permission keys).

**Example – caretaker token (staff must send house_owner_id):**

```json
{
  "email": "caretaker@example.com",
  "roleSlug": "caretaker",
  "expiresInHours": 48,
  "metadata": {
    "house_owner_id": 5,
    "house_ids": [1, 2]
  }
}
```

**Example – house_owner token:**

```json
{
  "email": "owner@example.com",
  "roleSlug": "house_owner",
  "expiresInHours": 24
}
```

**Response 200:**

```json
{
  "token": "hex-string-64-chars",
  "expiresAt": "2025-02-22T12:00:00.000Z",
  "roleSlug": "caretaker",
  "email": "caretaker@example.com",
  "registrationLink": "https://your-app.com/signup?token=hex-string-64-chars"
}
```

**Errors (400):** e.g. email already registered, invalid role, staff creating staff token, caretaker without `metadata.house_owner_id`, invalid house_owner or houses.

---

## 2. Validate Registration Token (before showing signup form)

**POST** `/auth/validate-token`

**Auth:** None (public).

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Token from the registration link (e.g. query param from `/signup?token=...`). |
| `email` | string | Yes | Email the user will sign up with (must match token’s email if token was generated with email). |

**Response 200:**

```json
{
  "valid": true,
  "token": {
    "roleSlug": "caretaker",
    "email": "caretaker@example.com",
    "expiresAt": "2025-02-22T12:00:00.000Z",
    "createdBy": { "id": 1, "name": "...", "email": "...", "role": { "slug": "..." } }
  }
}
```

**Response 400:** `{ "valid": false, "error": "..." }` (invalid/expired/used token, etc.).

---

## 3. Register (sign up with token)

**POST** `/auth/register`  
**POST** `/auth/register?token=...` (token can be in query instead of body)

**Auth:** None (public).

Used when the user completes signup using a **registration link** (link from generate-token). Token can be sent in query string or in body.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes* | Registration token (from link). Can be in query: `?token=...`. |
| `email` | string | Yes | Must match token email if token had email. |
| `password` | string | Yes | User’s password. |
| `name` | string | No | Display name. |
| `phone` | string | No | Phone. |

*Required if public registration is disabled; otherwise optional.

**Response 200:**

```json
{
  "user": {
    "id": 10,
    "email": "caretaker@example.com",
    "name": "John",
    "phone": null,
    "role": { "name": "Caretaker", "slug": "caretaker" },
    "parent": { "id": 5, "name": "...", "email": "..." }
  },
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600,
  "permission": [],
  "registrationMethod": "token"
}
```

**Errors (400):** e.g. invalid/expired token, email already exists, validation errors.

---

## 4. Create User (admin creates account directly)

**POST** `/auth/create-user`

**Auth:** Bearer token required. **Roles:** `web_owner`, `staff`.

Creates a new user in one step. Optionally auto-generate a registration token (e.g. to send invite link). Role hierarchy: web_owner > staff > house_owner > caretaker; you can only create users with a lower rank.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Must be unique. |
| `name` | string | No | Display name. |
| `phone` | string | No | Phone. |
| `roleSlug` | string | Yes | `house_owner` \| `staff` \| `caretaker`. |
| `password` | string | No | If omitted, a random password is generated (returned in response only if `sendEmail` is false). |
| `sendEmail` | boolean | No | Send credentials by email. Default: false. |
| `generateToken` | boolean | No | If true, also create a registration token and return `registrationLink`. Default: false. |
| `houseLimit` | number | No | For house_owner/staff: max houses (stored in metadata/rolelimit). |
| `permissions` | string[] | No | For staff: list of permission keys to grant. |

**Example:**

```json
{
  "email": "newowner@example.com",
  "name": "Jane Owner",
  "roleSlug": "house_owner",
  "password": "SecurePass123",
  "generateToken": false,
  "houseLimit": 10
}
```

**Response 200:**

```json
{
  "user": {
    "id": 11,
    "email": "newowner@example.com",
    "name": "Jane Owner",
    "phone": null,
    "role": { "name": "House Owner", "slug": "house_owner" },
    "parent": { "id": 1, "name": "...", "email": "..." }
  },
  "password": "SecurePass123",
  "registrationToken": null
}
```

If `generateToken: true`:

```json
{
  "user": { ... },
  "password": null,
  "registrationToken": {
    "token": "hex...",
    "expiresAt": "...",
    "roleSlug": "house_owner",
    "email": "newowner@example.com",
    "registrationLink": "https://your-app.com/signup?token=..."
  }
}
```

**Errors (400):** e.g. role not found, cannot create that role, user with email already exists.

---

## 5. List Registration Tokens

**GET** `/auth/registration-tokens`

**Auth:** Bearer token required. **Roles:** `web_owner`, `staff`.

Lists registration tokens created by the current user.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `used` | boolean | Filter by used (true/false). |
| `roleSlug` | string | Filter by role. |
| `email` | string | Filter by email (partial match). |

**Response 200:** Array of tokens with creator and optional user (if used).

```json
[
  {
    "id": 1,
    "token": "hex...",
    "email": "user@example.com",
    "roleSlug": "house_owner",
    "expiresAt": "...",
    "used": false,
    "createdAt": "...",
    "creator": { "id": 1, "name": "Admin", "email": "admin@example.com" },
    "user": null
  }
]
```

---

## 6. Revoke Registration Token

**DELETE** `/auth/registration-token/:tokenId`

**Auth:** Bearer token required. **Roles:** `web_owner`, `staff`.

Revokes a token you created. Cannot revoke an already-used token.

**Response 200:** `{ "message": "Registration token revoked successfully" }`  
**Errors (400):** Token not found, not your token, or token already used.

---

## 7. Get Managed Users

**GET** `/auth/managed-users`

**Auth:** Bearer token required. **Roles:** `web_owner`, `staff`.

Returns users that the current admin “manages” (e.g. created by them or under their hierarchy).

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `role` | string | Filter by role slug (e.g. `house_owner`). |
| `expand` | string | If `dna`, each managed **house_owner** gets a `dna` object with full related data (see below). |
| `userId` | string | If set, return only the managed user with this id (still respects hierarchy; returns empty array if not managed). |

**Response 200 (no expand):** Array of user objects with `role` and `parent`:

```json
[
  {
    "id": 5,
    "email": "owner@example.com",
    "name": "Jane",
    "role": { "name": "House Owner", "slug": "house_owner" },
    "parent": { "id": 1, "name": "Admin", "email": "admin@example.com" }
  }
]
```

**Response 200 with `?expand=dna`:** Same array, but each user with `role.slug === "house_owner"` includes a `dna` object:

| Field | Description |
|-------|-------------|
| `dna.profile` | Full user row (including parsed `profileJson` if present). |
| `dna.houses` | All houses where `ownerId` = this user (`house` table). |
| `dna.flats` | All flats in those houses (`flat` table). |
| `dna.appFeePayments` | All app fee payments for this house owner (`app_fee_payment`), newest first. |
| `dna.income` | `{ rentPayments, advancePayments }` – rent and advance payment rows for their houses. |
| `dna.expenses` | All house expenses for their houses (`house_expense`), newest first. |
| `dna.loans` | All loans for their houses (`house_loan`). |
| `dna.loanPayments` | All loan payment rows for those loans (`house_loan_payment`), newest first. |

Example: `GET /auth/managed-users?role=house_owner&expand=dna` returns only house owners, each with full DNA (profile, houses, flats, app fee, income, expense, loans).

---

## 8. Update User Limits

**PUT** `/auth/user/:userId/limits`

**Auth:** Bearer token required. **Roles:** `web_owner`, `staff`.

Updates limits/permissions for a managed user.

**Request body (JSON):**

| Field | Type | Description |
|-------|------|-------------|
| `houseLimit` | number | Max houses (for house_owner/staff). |
| `permissions` | string[] | Permission keys (for staff). |

**Response 200:** Updated user object.

---

## 9. Login As (impersonate user)

**POST** `/auth/login-as`

**Auth:** Bearer token required. **Roles:** `web_owner`, `staff`.

Starts a “login as” session and returns tokens for the target user.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetUserId` | number | Yes | User ID to log in as. |
| `reason` | string | No | Reason for impersonation. |

**Response 200:** Same shape as login (accessToken, refreshToken, user for target user, etc.).

---

## 10. Exit Login As

**POST** `/auth/exit-login-as`

**Auth:** Bearer token required.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | number | Yes | Login-as session ID to end. |

**Response 200:** New tokens for the original admin user and message.

---

## Workflow Summary for Frontend

### Flow A: Invite by link (token)

1. Admin: **POST /auth/generate-token** with `email`, `roleSlug`, optional `metadata`.
2. Backend returns `registrationLink`. Admin copies/sends link to invitee.
3. Invitee opens link (e.g. `/signup?token=xxx`). Frontend can **POST /auth/validate-token** with `token` and `email` to confirm token and show role/expiry.
4. Invitee submits signup form → **POST /auth/register** with `token`, `email`, `password`, `name`, `phone`.
5. Backend returns user + access/refresh tokens; frontend logs the user in.

### Flow B: Admin creates user directly

1. Admin: **POST /auth/create-user** with `email`, `name`, `roleSlug`, `password` (or omit to auto-generate), optional `sendEmail`, optional `generateToken`.
2. If `generateToken: true`, response includes `registrationToken.registrationLink` to send to the user to set password / complete profile if needed.
3. If password was generated and not sent by email, show or copy `password` from response once (only when `sendEmail` is false).

### Flow C: Manage tokens and users

- List tokens: **GET /auth/registration-tokens** (optional filters: `used`, `roleSlug`, `email`).
- Revoke token: **DELETE /auth/registration-token/:tokenId**.
- List managed users: **GET /auth/managed-users** (optional `role`).
- Update limits: **PUT /auth/user/:userId/limits** with `houseLimit` and/or `permissions`.

---

## Where the routes live

- **Auth routes (user creation + tokens):** `src/routes/auth.routes.js`
- **Mounted in server:** `app.use("/auth", authRoute);` → base path **`/auth`**
- **Controllers:** `src/controllers/auth.controller.js` (createUser, generateToken, validateToken, getRegistrationTokens, revokeRegistrationToken, etc.)
- **Service logic:** `src/services/auth.service.js` (createUserAccount, generateRegistrationToken, validateRegistrationToken, getRegistrationTokens, revokeRegistrationToken)

The **user-management** routes (`createStaff`, `createHouseOwner`, `createCaretaker` in `src/routes/userManagement.routes.js`) are **not** mounted in server.js (commented out). The active way to create users is via **/auth/create-user** and **/auth/generate-token** as described above.
