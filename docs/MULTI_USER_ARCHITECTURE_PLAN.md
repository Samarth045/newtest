# Multi-user and Family Workspace Architecture Plan

Repository: `Samarth045/newtest`
Target branch: `feature/multi-user-family-workspaces`
Base branch: `main`
Status: Architecture plan only. No application code, database, secrets, or deployment configuration changed.

## Product decisions

- Support both individual personal finance accounts and optional family workspaces.
- Support email/password and Google sign-in.
- Include family sharing in the initial architecture, not as a later schema retrofit.
- Preserve the existing offline-first, single-user experience and provide a safe migration path for existing local data.
- Multiple users and devices must be able to use the application concurrently.
- No user may access another user's personal or family data unless explicitly granted workspace membership and the required role.

## Target architecture

1. PWA frontend: login, registration, account recovery, Google sign-in, workspace selector, personal dashboard, family dashboard, and offline queue.
2. Cloudflare Worker: authentication/session validation, authorization, input validation, rate limiting, tenant-scoped API handlers, sync/revision control, audit events.
3. Cloudflare D1: identity-provider tables (or Better Auth-managed tables), workspaces, memberships, financial records, revisions, and audit metadata.
4. Cloudflare R2: workspace-scoped backup objects with encryption and retention metadata.
5. Browser storage: IndexedDB/localStorage namespaced by authenticated user and workspace; clear sensitive in-memory state and session-specific caches on logout/account switch.

## Identity, login and session design

- Evaluate Better Auth with its Cloudflare/D1 adapter as the default implementation candidate; verify current compatibility and migration requirements before selecting a version.
- Email/password: store only a modern password hash via the chosen auth library; never implement custom password cryptography.
- Email verification and secure password-reset tokens must be single-use, expiring, and rate-limited.
- Google OAuth: use Authorization Code flow with PKCE/state/nonce validation; validate issuer, audience, signature, expiry and verified email through the auth library/provider integration.
- Use opaque server-managed sessions in Secure, HttpOnly, SameSite cookies. Rotate session identifiers after authentication and privilege changes; support expiry and revocation.
- Protect state-changing cookie-authenticated requests against CSRF. Apply origin checks and appropriate CORS allowlists.
- Rate-limit login, registration, password reset, OAuth callback and sensitive account operations.
- Do not place session tokens, passwords, or long-lived vault secrets in URL fragments, query strings, localStorage, logs, or analytics.

## Tenant and family model

Use a workspace as the isolation boundary. Every user receives a personal workspace at registration. A user may also join or create family workspaces.

Proposed core tables (exact columns and constraints to be finalized against the current schema):

- users: stable user ID, normalized unique email, profile and timestamps (auth library may own identity/session tables).
- workspaces: ID, type (personal/family), display name, owner/creator, timestamps.
- workspace_members: workspace_id, user_id, role, status, invited_by, accepted_at; unique(workspace_id,user_id).
- workspace_invitations: workspace_id, normalized invite email, role, hashed single-use token, expiry, accepted/revoked timestamps.
- accounts, transactions, budgets, recurring_items, goals: include workspace_id and created_by_user_id; account/record relationships must be constrained to the same workspace.
- audit_events: workspace_id, actor_user_id, action, entity type/id, timestamp and minimal non-sensitive metadata.
- sync_revisions / backup_metadata: workspace_id, revision, checksums, object key, retention and restore status.

Roles:
- owner: manage workspace, members, roles, deletion/export and billing if later introduced.
- admin: manage members and shared finance records, but cannot transfer ownership or delete the workspace.
- editor: create and edit permitted shared financial records.
- viewer: read-only access.
- Personal workspace: owner-only by default. Do not implicitly share personal data with family members.

Family-sharing rules:
- Family workspace data is shared only within that workspace.
- A user's personal workspace remains private and separate.
- Invitations are expiring, revocable and bound to the intended email/account.
- Enforce role checks server-side for every operation; hiding UI controls is not authorization.
- Define explicit policies for removing members, ownership transfer, member-created records and workspace deletion.
- Never merge personal and family balances automatically. Show workspace context clearly in the UI.

## Data isolation and API rules (non-negotiable)

- Derive user identity from the validated server-side session, never from a client-supplied user_id.
- Resolve workspace membership and role on every API request that reads or mutates workspace data.
- Scope every query, update, delete, export, backup and restore by workspace_id; include ownership/relationship checks in the same operation.
- Use composite uniqueness/foreign-key constraints where possible (for example, account references constrained to the same workspace).
- Reject missing, unknown, suspended or unauthorized workspace memberships by default.
- Avoid endpoints that return all users' records or accept arbitrary workspace IDs without authorization.
- Use D1 transactions for multi-row financial changes, membership changes and revision/journal updates.
- Use optimistic concurrency with an atomic compare-and-swap revision update; only write journal entries when the corresponding mutation succeeds.
- Do not rely on client-side filtering as a security boundary.

## Offline-first and migration compatibility

- Keep the existing app usable for a user who has not yet registered, until they choose to migrate or sign in.
- On first authenticated use, offer an explicit, previewable migration of the existing local single-user dataset into that user's personal workspace.
- Never upload or merge local records into a family workspace by default.
- Make migration idempotent and transactional where possible; keep a recoverable local snapshot until server-side verification succeeds.
- Namespace local records and cache keys by user ID + workspace ID. Prevent account switching from displaying the prior user's cached data.
- On logout, stop pending sync jobs, clear sensitive in-memory state, and isolate/clear authenticated caches; retain only the user's explicitly chosen encrypted offline data.
- Sync per workspace using revisions, conflict records and deterministic recovery; prevent one device's stale state from overwriting another device's newer changes.

## Backup, restore and encryption

- Use separate R2 object-key namespaces per workspace and backup ID; authorize restore against current workspace membership and role.
- Encrypt sensitive backups with authenticated encryption (for example AES-GCM) using keys managed outside D1/R2; document key rotation and recovery.
- Do not claim a backup is verified until its stored bytes have been read back and the checksum/authentication tag has been validated.
- Ensure D1 snapshots and journal payloads receive the same confidentiality protections as R2 backups.
- Test backup isolation, restore isolation, retention expiry and recovery after partial failure.

## Frontend changes

- Add onboarding, sign-in, registration, verification, password reset and Google sign-in.
- Add a visible personal/family workspace switcher and clear active-workspace indicator.
- Add family creation, invitation acceptance, member list and role management.
- Keep existing finance screens and calculations; route data access through a user/workspace-aware repository layer.
- Ensure service worker caches only static assets; do not cache authenticated API responses or private HTML/JSON responses.
- Add account-switch and logout flows that cancel in-flight requests and isolate offline state.

## Phased implementation and acceptance criteria

### Phase 0 — Baseline and safeguards
- Capture current main commit and schema; inventory every endpoint, table, backup path, local key and sync path.
- Add a migration/rollback plan and test fixtures based on synthetic data only.
- Acceptance: existing single-user workflow has baseline regression tests; no production data is used in tests.

### Phase 1 — Identity
- Integrate selected auth library; email/password, verification, reset, Google OAuth and session lifecycle.
- Acceptance: unauthenticated requests cannot access private APIs; revoked/expired sessions fail; OAuth state/PKCE tests pass.

### Phase 2 — Workspace and authorization foundation
- Add personal workspaces, family workspaces, membership, invitations and roles.
- Add workspace-scoped service/repository methods and enforce server-side authorization.
- Acceptance: cross-user and cross-workspace read/write/delete/export/restore tests all return denied/not-found without leaking existence or data.

### Phase 3 — Data migration and API conversion
- Add additive D1 migrations and backfill legacy records into a personal workspace through an explicit migration workflow.
- Convert every financial endpoint, journal operation and backup/restore path to workspace scoping.
- Acceptance: migration is idempotent, data counts/checksums match, rollback is documented and no record is unscoped.

### Phase 4 — PWA and family experience
- Add auth screens, workspace switcher, family invitations/roles and cache isolation.
- Preserve offline-first behavior with per-user/per-workspace queues.
- Acceptance: two unrelated users and multiple devices can operate concurrently without data crossover.

### Phase 5 — Reliability and security verification
- Add API integration, authorization matrix, concurrency, CSRF, rate-limit, backup/restore, migration and service-worker tests.
- Run dependency/security checks and test D1 migrations on a fresh database and a copy of representative synthetic legacy data.
- Acceptance: all tests pass; no unresolved critical/high cross-tenant vulnerabilities; restore drill succeeds.

### Phase 6 — Controlled rollout
- Deploy additive schema first, then compatible Worker, then frontend; enable registration behind a feature flag.
- Pilot with test accounts, monitor error rates and sync conflicts, then gradually enable users.
- Keep rollback and data export procedures available. Never deploy automatically from this planning branch.

## Required test matrix

- User A cannot read, edit, delete, export or restore User B's personal records.
- Family member can access only workspaces they joined and only actions permitted by their role.
- Viewer cannot mutate; editor cannot manage ownership; admin cannot transfer ownership.
- Invitation cannot be reused, guessed, accepted by the wrong email, or used after expiry/revocation.
- Two users and multiple devices can save concurrently without lost updates or cross-tenant journal entries.
- User switch/logout cannot show previous user's IndexedDB data, cached API response or pending queue.
- Legacy local-only user can continue using the app and explicitly migrate to a personal workspace without data loss.
- Backup/restore and R2 object keys are workspace-isolated and cryptographically verified.
- CSRF, session expiry/revocation, OAuth callback validation and rate limits are tested.

## Risks and decisions to resolve before coding

1. Confirm whether Google sign-in should be enabled for all users or be optional (planned as optional).
2. Choose email delivery provider for verification and password reset.
3. Decide family workspace invitation policy and whether shared accounts can have per-member visibility restrictions.
4. Decide whether users can belong to multiple family workspaces (recommended: yes).
5. Define data export, account deletion, retention and recovery policy.
6. Verify current Cloudflare D1/Workers compatibility for the selected auth library and binding configuration.
7. Review existing deployed Worker and SQL migrations before changing production data.

## Safety constraints for this work

- Do not modify `main`.
- Implement only on `feature/multi-user-family-workspaces`.
- This commit documents the plan only; it does not add authentication, change schemas, alter existing user data, deploy a Worker or change secrets.
