# HelixTrace — Genetic Lineage & CRISPR Off-Target Mutation Tracker

HelixTrace is a full-stack relational database application for tracking how CRISPR-Cas9 edits propagate down cell-line family trees and monitoring unintended off-target cleavage events, allele frequencies, and oncogenic risk.

---

## Architecture & Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Backend**: Node.js 22+, Express, TypeScript (`tsx` in dev / native Node in prod)
- **Authentication**: HS256 JWT (`jsonwebtoken`) + `bcryptjs` password hashing + Role-Based Access Control (`admin` / `researcher`)
- **Database**:
  - **MySQL 8.0+** (`mysql2/promise`) using the schema, triggers, views, recursive CTEs, and stored procedure in [`database/schema.sql`](./database/schema.sql)
  - **Zero-Config Embedded SQLite (`sql.js`)** fallback for instant local evaluation without installing a separate MySQL daemon
- **Third-Party Genomic Service**: Server-side proxy to **NCBI Entrez E-utilities** (`eutils.ncbi.nlm.nih.gov`) configured via `NCBI_API_KEY`

---

## Key Features

1. **Interactive Cell-Line Lineage Tree (`WITH RECURSIVE`)**
   - Visualizes multi-generation inheritance trees (`HEK-WT -> HEK-C1 -> HEK-C1-A -> HEK-C1-A1`)
   - Click any clone to trace its ancestors (`generations_back`) and inherited mutations, inspect descendant sub-clones, update lifecycle status (`active` / `frozen` / `discarded`), or register new sub-clones (with generation auto-computed by trigger)
2. **Off-Target Mutation Report & Risk Scoring**
   - Queries `v_offtarget_report` with risk classification (`HIGH`, `MEDIUM`, `LOW`)
   - Window ranking (`RANK() OVER`) inside each guide RNA and unhit predicted off-target loci (`LEFT JOIN`)
   - Enforces experiment–guide integrity before logging new `mutation_event` records
3. **Automated High-Frequency Alerting (`trg_high_freq_alert`)**
   - Automatically logs alerts into `alert_log` whenever a mutation event has `allele_freq >= 5%`
   - Highlights `v_high_risk_events`, tumor-suppressor/oncogene hits (`TP53`, `BRCA1`, `MYC`), and mutation-free clean clones
4. **Cas9 Fidelity & Mismatch Benchmarking**
   - Compares `Standard` (`SpCas9`, `SaCas9`) vs. `High` (`eSpCas9`, `SpCas9-HF1`) fidelity variants and plots mismatch count vs. mean allele frequency
5. **NCBI Entrez Gene Annotation Lookup**
   - Click any gene symbol (`HBB`, `TP53`, `BRCA1`, `MYC`, `CCR5`, `EMX1`, `VEGFA`, `Tyr`) to fetch official NCBI Gene IDs, cytogenetic bands, and functional summaries through a server-side proxy
6. **JWT-Secured REST API**
   - First-run lab administrator bootstrap (`POST /api/auth/bootstrap`)
   - Researcher registration & login (`POST /api/auth/register`, `POST /api/auth/login`)
   - Every `/api/*` endpoint verifies `Authorization: Bearer <token>`, with admin-only guards on destructive operations (`DELETE /api/samples/:id`)

---

## Repository Structure

```text
├── database/
│   └── schema.sql            # Complete MySQL 8.0+ DDL, triggers, views, procedure & seed data
├── server/
│   ├── auth.ts               # JWT signing/verification, bcrypt hashing, RBAC & bootstrap
│   ├── db.ts                 # Dual MySQL 8.0+ (mysql2) & embedded SQLite (sql.js) adapter
│   ├── ncbi.ts               # Server-side NCBI Entrez E-utilities integration
│   └── routes.ts             # Secured Express REST API routes
├── src/
│   ├── components/
│   │   ├── AlertsView.tsx
│   │   ├── AuthGate.tsx
│   │   ├── ExperimentsView.tsx
│   │   ├── GuidesView.tsx
│   │   ├── LineageView.tsx
│   │   ├── MutationsView.tsx
│   │   └── NcbiModal.tsx
│   ├── lib/api.ts            # Typed Bearer-authenticated HTTP client
│   ├── types.ts              # Shared frontend domain types
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── server.ts                 # Express + Vite entry point (port 3000)
├── .env.example              # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

---

## Setup Instructions

### 1. Clone & Install Dependencies

```bash
git clone <your-repo-url>
cd helixtrace-crispr-tracker
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `DB_CLIENT` | Database driver: `sqlite` (zero-config) or `mysql` (MySQL 8.0+) | `sqlite` |
| `MYSQL_HOST` | MySQL server hostname (when `DB_CLIENT=mysql`) | `127.0.0.1` |
| `MYSQL_PORT` | MySQL port | `3306` |
| `MYSQL_USER` | MySQL username | `root` |
| `MYSQL_PASSWORD` | MySQL password | — |
| `MYSQL_DATABASE` | Target schema name | `crispr_tracker` |
| `JWT_SECRET` | Optional HS256 signing secret (auto-generated in memory if omitted) | — |
| `NCBI_API_KEY` | Optional NCBI Entrez E-utilities API key for higher rate limits | — |
| `ADMIN_CLAIM_PASSCODE` | Optional passcode required during first-run admin bootstrap | — |

> **Security Note**: Never commit `.env` to version control. Private secrets (`MYSQL_PASSWORD`, `NCBI_API_KEY`, `JWT_SECRET`) remain strictly on the server and are never exposed to browser code.

---

### Option A: Zero-Config Embedded Mode (Fastest Start)

Keep `DB_CLIENT="sqlite"` in `.env` (or omit MySQL credentials). On startup, the server automatically creates `database/crispr_tracker.sqlite` with all tables, triggers, views, indexes, and seed data:

```bash
npm run dev
```

Open `http://localhost:3000`. On your first visit, complete the **Create Lab Administrator Account** form to initialize your admin credentials and receive a session JWT.

---

### Option B: Connect Your MySQL 8.0+ Database

1. Load the schema, triggers, views, stored procedure, and sample dataset into MySQL 8.0+:

   ```bash
   mysql -u root -p < database/schema.sql
   ```

2. Update `.env`:

   ```env
   DB_CLIENT="mysql"
   MYSQL_HOST="127.0.0.1"
   MYSQL_PORT=3306
   MYSQL_USER="your_mysql_user"
   MYSQL_PASSWORD="your_mysql_password"
   MYSQL_DATABASE="crispr_tracker"
   ```

3. Start the server:

   ```bash
   npm run dev
   ```

---

## Production Build

```bash
npm run build
NODE_ENV=production npm start
```

---

## REST API Reference

### Authentication (Public)
- `GET /api/health` — Service & active database dialect check
- `GET /api/auth/status` — Checks whether first-run admin bootstrap is required
- `POST /api/auth/bootstrap` — One-time creation of initial `admin` account (locks once claimed)
- `POST /api/auth/register` — Registers a new `researcher` account and returns a JWT
- `POST /api/auth/login` — Authenticates email/password and returns a JWT
- `GET /api/auth/me` — Returns current authenticated user profile (`Bearer` required)

### Protected Domain Endpoints (`Authorization: Bearer <jwt>`)
- `GET /api/dashboard` — KPI totals, `v_experiment_summary`, Cas9 fidelity stats, mismatch decay curve
- `GET /api/lineage` — Recursive CTE family trees (`WITH RECURSIVE`) with mutation counts
- `GET /api/lineage/:sampleCode/trace` — Recursive ancestor & descendant trace for a clone
- `GET /api/samples` / `POST /api/samples` / `PATCH /api/samples/:id` — Sample CRUD (trigger computes generation)
- `DELETE /api/samples/:id` — Admin-only leaf sample deletion
- `GET /api/mutations` / `POST /api/mutations` — `v_offtarget_report`, `RANK() OVER`, unhit sites, and mutation logging
- `GET /api/experiments` / `POST /api/experiments` — Experiment summaries and guide links
- `GET /api/guides` / `POST /api/guides` / `POST /api/off-target-sites` — Guide RNAs & off-target locus catalog
- `GET /api/alerts` — `alert_log`, `v_high_risk_events`, clean clones, and integrity check
- `GET /api/genes/:symbol/ncbi` — Server-side NCBI Entrez Gene lookup
