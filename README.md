# Smart Toilet DLH

Smart Toilet DLH is a web application for monitoring public-toilet access gates and hygiene-fee revenue. It combines an administrative dashboard, a NestJS API, PostgreSQL persistence, QRIS payment integrations, and gate-device communication.

## Features

- Dashboard for revenue, visitor, and gate status monitoring
- User login and administration
- QRIS transaction handling with BRI and ASPI payment integrations
- Gate-device management and access-event logging
- Application settings and transaction reporting

## Project Structure

```text
backend/   NestJS API, Prisma schema/migrations, and API tests
frontend/  React dashboard built with Vite and TanStack Router
```

## Prerequisites

- Node.js 22 or later and npm
- PostgreSQL
- Docker and Docker Compose (optional, for running the API container)

## Local Development

### 1. Configure and start the API

Create the backend environment file:

```bash
cd backend
cp .env.example .env
```

Set `DATABASE_URL` to a PostgreSQL database you can access and set a strong `JWT_SECRET`. The BRI and ASPI credentials in `.env.example` are placeholders; configure them to use those payment providers. Keep `.env` files and private keys out of version control.

Install dependencies, apply migrations, create the initial administrator, and start the API:

```bash
npm install
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

The API defaults to `http://localhost:3000`; Swagger is available at `http://localhost:3000/api`.

### 2. Configure and start the dashboard

In another terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

The frontend example uses `http://localhost:3003`, while the API defaults to port `3000`. Set `VITE_API_BASE_URL=http://localhost:3000` in `frontend/.env` for the defaults above, or configure the API to use port `3003` instead. Start the Vite development server at the URL printed in the terminal.

## Docker API

The Compose configuration in `backend/` starts the API container, not PostgreSQL. Provide a reachable PostgreSQL database through `backend/.env` (`DATABASE_URL`) before starting it:

```bash
cd backend
cp .env.example .env
# Edit .env and set DATABASE_URL and JWT_SECRET.
docker compose up -d --build
```

The container applies Prisma migrations at startup and exposes the API on port `3000`. See [backend/README.docker.md](backend/README.docker.md) for details. Stop it with `docker compose down`.

## Useful Commands

Backend commands (run from `backend/`):

```bash
npm run start:dev       # Start API in watch mode
npm run build           # Build API
npm test                # Run unit tests
npm run test:e2e        # Run end-to-end tests
```

Frontend commands (run from `frontend/`):

```bash
npm run dev             # Start Vite development server
npm run build           # Type-check and build for production
npm run lint            # Run ESLint
```

## Configuration

See [backend/.env.example](backend/.env.example) for API, database, JWT, gate, and payment-provider settings, and [frontend/.env.example](frontend/.env.example) for the dashboard API URL. Database schema and migrations are maintained with Prisma under `backend/prisma/`.
