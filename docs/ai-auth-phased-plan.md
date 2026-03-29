# Tapcheck Auth Architecture — AI Phased Build Plan

This document contains phased prompts for building Tapcheck authentication using:

- Next.js
- Clerk (auth backend)
- Custom UI
- Future Google / Board SSO support
- Staff authenticated, attendees not authenticated (for now)

---

# Phase 1 — Architecture Foundation

## Prompt

You are helping build Tapcheck.

Stack:
- Next.js App Router
- TypeScript
- Tailwind
- Clerk auth backend
- Custom auth UI

Rules:
- Staff authenticate
- Students do NOT authenticate yet
- Students are domain records
- Must support Google sign-in later

Tasks:
1. Architecture proposal
2. Folder structure
3. ADR
4. Implementation checklist

---

# Phase 2 — Data Model

## Prompt

Design data model:

Tables:
- app_users
- auth_identities
- rosters
- students
- attendance_sessions
- attendance_events

Rules:
- Do NOT rely on Clerk ID
- Use internal app_user_id
- Support multiple auth providers

---

# Phase 3 — Clerk Setup

## Prompt

Implement Clerk with:

- custom UI
- email/password
- verification code
- reset password

No prebuilt Clerk UI.

---

# Phase 4 — User Sync

## Prompt

Implement:

- internal app user creation
- auth identity linking
- getCurrentAppUser()

---

# Phase 5 — Route Structure

## Prompt

Design route structure:

- public routes
- protected dashboard
- session check-in

---

# Phase 6 — Custom Auth UI

## Prompt

Build:

- sign in
- sign up
- verify code
- forgot password
- reset password

Minimal mobile UI.

---

# Phase 7 — Tapcheck Domain

## Prompt

Implement Tapcheck domain:

- rosters
- sessions
- attendance events

---

# Phase 8 — Future SSO

## Prompt

Design migration:

- Google sign-in
- Board SSO
- account linking

---

# Implementation Order

1. Architecture
2. Schema
3. Clerk setup
4. Custom UI
5. User sync
6. Domain integration

---

# Notes

- Keep MVP simple
- Staff auth only
- Students domain-only
- Future-proof for Google

---

End of plan
