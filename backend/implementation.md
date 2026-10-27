# Implementation Plan: Vault Integration and ASPI Feature Removal

## 1. Objective

Update the Smart Toilet DLH Padang (`smart-toilet-dlh`) application
locally before deploying changes to production.

This implementation covers:

1.  Load BRI SNAP QRIS credentials from HashiCorp Vault instead of
    storing BRI secrets in `backend/.env`.
2.  Keep BRI QRIS functionality working.
3.  Remove the ASPI feature from the application code and user interface
    where it is genuinely ASPI-specific.
4.  Build and test locally before committing, pushing, or deploying.
5.  Keep production services running until the new build and deployment
    plan have been verified.

## 2. Current Architecture and Known Configuration

### Backend

-   Framework: NestJS 11
-   ORM/database: Prisma and PostgreSQL
-   BRI integration: `backend/src/bri/`
-   ASPI integration: `backend/src/aspi/`
-   App module: `backend/src/app.module.ts`
-   BRI module: `backend/src/bri/bri.module.ts`
-   BRI service: `backend/src/bri/bri.service.ts`
-   Common utilities: `backend/src/common/`

`BriService` currently reads these values directly from `process.env`:

-   `BRI_BASE_URL`
-   `BRI_CLIENT_ID`
-   `BRI_CLIENT_SECRET`
-   `BRI_PARTNER_ID`
-   `BRI_CHANNEL_ID`
-   `BRI_MERCHANT_ID`
-   `BRI_TERMINAL_ID`
-   `BRI_PRIVATE_KEY`
-   `BRI_WEBHOOK_SECRET`

`BRI_WEBHOOK_SIGNATURE_DEBUG` is also read by the service. Do not enable
this option in production: the current implementation contains debug
logging that can log secret values. Remove or safely redact that logging
as part of this work.

### Vault

The VPS Vault setup has been initialized and unsealed. It uses HTTPS
with an internal CA and KV v2 at `secret/`.

-   Secret path: `secret/brisnap`
-   KV v2 API read path: `/v1/secret/data/brisnap`
-   AppRole: `gate-qris-backend`
-   Policy: `gate-qris-backend`
-   The policy is intended to allow read access only to
    `secret/data/brisnap`.
-   AppRole credentials are stored on the VPS at
    `/opt/vault/backend-credentials/approle.json`, permission `600`,
    owner `root:root`.
-   Vault CA certificate is at `/opt/vault/tls/ca.crt`.
-   Vault is on the Docker network `smart-toilet-dlh_default` and is not
    published on a public host port.
-   Vault uses TLS and must be accessed with certificate verification
    enabled.
-   AppRole SecretID TTL was changed to `0`; keep the credential file
    protected and establish a rotation procedure.

Do not copy production AppRole credentials, Vault tokens, private keys,
or BRI secrets into Git, this document, shell history, chat messages, or
application logs.

## 3. Required Implementation

### 3.1 Add a Vault configuration provider

Create a dedicated provider under `backend/src/common/vault/`, for
example:

-   `vault-config.service.ts` or `vault-bri-config.provider.ts`
-   A type/interface for the required BRI configuration if useful
-   Unit tests for validation and failure cases

Use the currently installed `axios` package and Node.js HTTPS/TLS
facilities unless a new dependency is justified.

The provider must:

1.  Read AppRole credentials from a file path supplied through
    non-secret configuration, such as `VAULT_APPROLE_FILE`.
2.  Read the Vault CA certificate from a configured path, such as
    `VAULT_CA_CERT`.
3.  Use HTTPS with CA validation; do not disable TLS verification.
4.  Authenticate using `POST /v1/auth/approle/login` with `role_id` and
    `secret_id`.
5.  Read KV v2 data using `GET /v1/secret/data/brisnap` with the
    returned Vault token.
6.  Extract the actual values from the KV v2 response structure:
    `data.data`.
7.  Validate that every required BRI key exists and is a non-empty
    string.
8.  Validate `BRI_PRIVATE_KEY` contains a PEM private-key header and can
    be parsed by Node's crypto API where practical.
9.  Never log the AppRole credentials, Vault token, BRI secret values,
    private key, or complete Vault response.
10. Fail application startup with a sanitized error if Vault is
    unavailable, TLS validation fails, AppRole authentication fails, the
    policy denies access, or required fields are missing.
11. Use bounded connection/request timeouts and avoid retry loops that
    can stall startup indefinitely.
12. Avoid writing the fetched secrets to a local file or exposing them
    through an API endpoint.

The Vault token is only needed to retrieve configuration at startup if
the application does not use Vault later. Do not persist it or log it.
If the design later requires runtime secret refresh, implement token
renewal/refresh deliberately rather than assuming a startup token
remains valid forever.

### 3.2 Ensure Vault loads before `BriService`

`BriService` currently initializes configuration using class property
initializers that read `process.env`. Refactor it to receive validated
configuration through NestJS dependency injection.

Use an asynchronous provider (for example, a `BRI_CONFIG` token with
`useFactory: async () => ...`) so NestJS waits for Vault retrieval
before constructing `BriService`.

Update `BriModule` to register the async provider and inject its result
into `BriService`. Preserve existing dependencies and behavior for:

-   `PrismaService`
-   `DashboardService`
-   `GateService`

Replace the direct `process.env.BRI_*` property initializers with
constructor-injected configuration. Keep the existing BRI request
signing, token caching, payment flow, webhook verification, and
transaction handling unchanged unless a test demonstrates a necessary
change.

`BRI_WEBHOOK_SIGNATURE_DEBUG` must not log secret values. Prefer
removing secret-value logging entirely and retaining only safe
diagnostic metadata if debug logging is still needed.

### 3.3 Configure the backend container for Vault

Production Compose will eventually need read-only mounts for:

-   `/opt/vault/backend-credentials/approle.json`
-   `/opt/vault/tls/ca.crt`

Suggested container paths:

-   `/run/secrets/vault-approle.json`
-   `/run/secrets/vault-ca.crt`

Use read-only bind mounts and non-secret environment variables such as:

-   `VAULT_ADDR=https://vault:8200`
-   `VAULT_APPROLE_FILE=/run/secrets/vault-approle.json`
-   `VAULT_CA_CERT=/run/secrets/vault-ca.crt`

Do not publish Vault's port to the public host. Keep certificate
verification enabled. Check container permissions before deployment: the
current backend image's runtime user must be able to read the mounted
files, while the files remain protected on the host.

Do not edit production Compose or restart the production backend until
the code changes have passed local build and tests and the final
deployment diff has been reviewed.

### 3.4 Remove the ASPI feature

Audit all references before deletion. Search backend, frontend, tests,
environment examples, documentation, and deployment files for terms such
as `ASPI`, `Aspi`, `aspi`, and ASPI-specific configuration names.

Remove only code and UI that are exclusively related to ASPI, which may
include:

-   ASPI module, service, controller, DTOs, tests, and providers
-   `AspiModule` registration in `AppModule`
-   ASPI-specific routes and API clients
-   ASPI-specific frontend pages, components, navigation entries, hooks,
    and API calls
-   ASPI-only environment variables from examples and deployment
    documentation
-   ASPI-only tests and documentation

Before removing shared code, determine whether BRI or another feature
uses it. Do not remove generic QRIS, payment, transaction,
authentication, or shared UI code merely because an ASPI feature imports
it.

Do not drop database tables, columns, or records as part of the initial
code removal. Database cleanup requires a separate reviewed migration
after confirming that no remaining feature depends on the data.

Update frontend and backend tests to reflect the supported BRI-only
payment flow.

### 3.5 Keep production credentials out of Git

-   Do not commit `backend/.env`,
    `/opt/vault/backend-credentials/approle.json`, Vault tokens, private
    keys, or secret JSON files.
-   Confirm `.gitignore` covers local environment files and secret
    artifacts.
-   Check `git status` and inspect the staged diff before committing.
-   If any credential has ever been committed, treat it as exposed and
    rotate it; removing it in a later commit is not sufficient.
-   Do not paste secret values into terminal commands when an
    interactive or file-based method can be used safely.

## 4. Local Development Workflow

Perform the work in the local clone, not directly on the production VPS.

### Phase A --- Establish a safe baseline

1.  Confirm the repository path and current branch.
2.  Run `git status --short --branch`.
3.  Preserve or commit existing unrelated work before editing.
4.  Search for ASPI references and document which are ASPI-only versus
    shared.
5.  Review current BRI code and existing tests.

### Phase B --- Implement Vault loading

1.  Create the Vault configuration provider and its tests.
2.  Refactor `BriService` to accept validated BRI configuration via
    dependency injection.
3.  Update `BriModule` to await the asynchronous configuration provider.
4.  Remove unsafe secret-value logging.
5.  Add tests for missing credentials, TLS/API failure, denied Vault
    reads, malformed response, missing fields, and invalid private key.

### Phase C --- Remove ASPI

1.  Remove ASPI-only backend modules and registrations.
2.  Remove ASPI-only frontend pages and API usage.
3.  Remove obsolete ASPI environment-variable references and
    documentation.
4.  Keep shared payment logic and database structures unless
    independently approved for removal.
5.  Update tests and navigation.

### Phase D --- Test locally

Run the appropriate checks based on the repository's scripts, including:

-   Backend TypeScript/build check
-   Backend unit tests
-   Frontend build and lint/tests where configured
-   Search for remaining ASPI references
-   Search for direct `process.env.BRI_*` reads outside the Vault
    provider/configuration validation
-   Review logs to ensure they do not contain credentials
-   Confirm the BRI flow and webhook signature verification remain
    covered by tests

Do not claim a test passed unless it was actually run and its result was
checked.

### Phase E --- Review and commit

1.  Review `git diff --check`.
2.  Review `git diff` for accidental unrelated changes or credentials.
3.  Confirm no production secret files are staged.
4.  Commit with a clear message describing Vault integration and ASPI
    removal.
5.  Push to the intended branch only after local checks pass.

## 5. Production Deployment Plan

Deployment is a separate phase. Do not perform it until the local
changes and tests are complete.

1.  Confirm the production working tree and current branch.
2.  Back up relevant Compose configuration and environment files
    securely without printing their contents.
3.  Verify Vault is healthy, unsealed, TLS-valid, and reachable from the
    backend Docker network.
4.  Verify the AppRole can read `secret/data/brisnap` and cannot read
    unrelated paths.
5.  Review the exact Compose diff and mount credentials/CA read-only.
6.  Build the backend image before replacing the running container.
7.  Deploy in a controlled maintenance window if replacement causes
    interruption.
8.  Verify backend startup, health endpoint, logs, BRI token
    acquisition, QRIS generation, payment callback/webhook verification,
    transaction persistence, and gate behavior.
9.  Do not test with a real charge unless explicitly authorized; use an
    approved sandbox/test process.
10. Keep a rollback plan for the previous image and Compose
    configuration.
11. Only remove BRI values from the production `backend/.env` after the
    new container is confirmed to load all required BRI values from
    Vault.
12. Confirm that restarting Vault requires unsealing under the current
    Shamir configuration; document the operational procedure and backup
    of Vault data/unseal keys.

## 6. Acceptance Criteria

-   [ ] Backend starts only when Vault configuration is successfully
    loaded and validated.
-   [ ] Vault HTTPS connection validates against the internal CA.
-   [ ] AppRole can read `secret/data/brisnap` and cannot read unrelated
    secret paths.
-   [ ] BRI secrets are not stored in Git or printed to logs.
-   [ ] `BriService` no longer reads BRI secrets directly from
    `process.env`.
-   [ ] BRI private-key parsing and request signing remain functional.
-   [ ] Webhook signature verification remains functional.
-   [ ] Secret-value debug logging is removed or safely redacted.
-   [ ] ASPI-only backend and frontend features are removed.
-   [ ] No shared BRI/payment functionality is accidentally removed.
-   [ ] No database data or schema is dropped without separate approval.
-   [ ] Local build and relevant tests pass.
-   [ ] Production deployment is reviewed, health-checked, and has a
    rollback path.

## 7. Important Operational Notes

-   A single Vault node is a single point of failure; it is not a highly
    available deployment just because integrated Raft is configured.
-   Vault currently uses Shamir unseal keys. After a Vault restart, the
    service may require manual unsealing before the backend can start or
    retrieve secrets.
-   An AppRole SecretID with TTL `0` does not expire automatically.
    Restrict access to its file and define a rotation/revocation
    procedure.
-   Keep Vault's listener private to the Docker network; do not expose
    port 8200 publicly without a separately reviewed access design.
-   Do not put secrets in this implementation document, source control,
    CI logs, shell history, screenshots, or chat messages.
