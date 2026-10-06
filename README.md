# SMART PRINT KIOSK
> **Tagline:** Upload. Verify. Pay. Print.

Smart Print Kiosk is a production-ready, commercial-grade self-service printing kiosk software system designed for deployment on physical Windows kiosk computers connected to real hardware printers (HP, Canon, Epson, Xerox, etc.).

---

## Architecture Overview

```
Customer Mobile Phone (Web QR) 
       │
       ▼ (Upload & Configure Options)
Backend API Server (Node.js/Express + PostgreSQL + Drizzle ORM)
       │
       ├── Pricing Calculation Engine (Database Rules)
       ├── 6-Digit OTP Authentication Service (2-min expiry & brute-force shield)
       ├── Automatic Privacy Cleanup Daemon (Purges binaries after printing)
       │
       ▼ (Enter OTP on Kiosk Touchscreen)
Physical Kiosk Terminal (ATM/Airport Touchscreen UI + Multi-Language EN/MR/HI)
       │
       ▼ (Payment Desk Authorization: Cash / UPI)
Print Queue & Local Printer Service
       │
       ▼
Windows Print Spooler (PowerShell / Win32 Spooler Daemon)
       │
       ▼
Physical Laser/Inkjet Printer
```

---

## Key Features

1. **ATM-Grade Kiosk Terminal UI**:
   - High-contrast, large touch targets, minimal clutter.
   - On-screen large numeric touch keypad for OTP entry.
   - Discreet kiosk ID (`KSK-001`).
   - Multilingual support: **English**, **मराठी (Marathi)**, and **हिंदी (Hindi)**.
   - Live hardware status indicator (Ready, Printing, Offline, Paper servicing).
   - Real-time step progress indicator (`UPLOAD → SETTINGS → VERIFY → PAYMENT → PRINT → DONE`).

2. **Mobile Customer Portal**:
   - Zero app installation required; customer scans kiosk QR code.
   - Instant PDF page count calculation via `pdf-lib`.
   - Real-time pricing calculator for A4/A3, Black & White, Full Color, Single/Double-sided (Duplex), Custom Page Ranges (e.g., `1-5, 8`), and Copies.
   - 2-minute countdown OTP display screen with real-time status tracker.

3. **Cryptographic OTP Authentication**:
   - Binds Kiosk ID + Session ID + Job ID + Customer Phone.
   - 6-digit one-time code, 120-second expiration.
   - Maximum 3 verification attempts with rate-limiting and brute-force mitigation.
   - SHA-256 salted hashing in database.

4. **Strict Privacy-First Lifecycle**:
   - Uploaded customer documents are stored only temporarily in secure local spool storage.
   - Immediately unlinked from disk upon successful printing or job cancellation.
   - Automated cleanup daemon sweeps and purges any file older than 15 minutes.
   - Customer document binaries are never retained in permanent profiles.
   - Customer profile stores only transaction metadata (Name, Phone, Total Jobs, Spent ₹).

5. **Operator & Admin Desk Console**:
   - Real-time print queue and payment authorization desk (Cash & UPI).
   - Dynamic Pricing Rules engine (A4 B&W, A4 Color, A3, Duplex surcharge).
   - Hardware monitoring (Tray paper levels, toner gauge, heartbeat).
   - Authorized reprint and retry actions with idempotency duplicate-printing prevention.
   - Immutable audit logging (`JOB_CREATED`, `OTP_VERIFIED`, `PAYMENT_MARKED_PAID`, `PRINT_STARTED`, `PRINT_COMPLETED`, `DOCUMENT_DELETED`).

---

## Windows Physical Kiosk Deployment

### 1. Requirements on Physical Windows PC:
- Windows 10/11 Pro or Enterprise (64-bit)
- USB or Network printer connected and installed in Windows Settings
- Node.js 20+ installed (or bundled Electron executable)

### 2. Windows Print Spooler Agent:
A native PowerShell spooler agent is included in `printer-agent/windows-spooler-agent.ps1`.
Run on the kiosk machine:
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\printer-agent\windows-spooler-agent.ps1 -BackendUrl "http://localhost:3000" -KioskId "KSK-001"
```

### 3. Windows Assigned Access (Full-Screen Kiosk Mode):
1. Open **Settings** > **Accounts** > **Other users** > **Set up a kiosk** (Assigned Access).
2. Select Microsoft Edge as the kiosk application.
3. Configure Edge to run as a digital sign or interactive display pointing to your Kiosk URL:
   ```
   msedge.exe --kiosk http://localhost:3000 --edge-kiosk-type=fullscreen --no-first-run
   ```

---

## Database Schema (PostgreSQL)

- `users` — Customer transaction profiles and usage totals.
- `kiosks` — Terminal hardware configurations, location, and heartbeat.
- `printers` — Spooler drivers, ports, and paper/toner capacity.
- `pricing_rules` — Active pricing per paper size, color mode, and duplex.
- `sessions` — Ephemeral kiosk QR pairing sessions.
- `print_jobs` — Print jobs with state machine and page range configurations.
- `otp_verifications` — Salted hashes, attempt counter, and expiration timestamps.
- `payments` — Transaction ledger (Cash, UPI, Card).
- `job_events` — State machine event log.
- `audit_logs` — Immutable security audit trail.
- `administrator_accounts` — Operator and admin desk credentials.

---

## API Endpoints

- `GET /api/kiosks` — Retrieve list of kiosks and printer states.
- `GET /api/kiosks/:id` — Retrieve specific kiosk status and hardware health.
- `POST /api/sessions/create` — Initialize QR pairing session.
- `POST /api/upload` — Upload document (PDF/Images/DOCX) and analyze page counts.
- `POST /api/pricing/calculate` — Calculate price quote based on database rules.
- `POST /api/jobs/create` — Create print job and generate secure OTP.
- `POST /api/kiosk/verify-otp` — Verify customer OTP from touchscreen.
- `POST /api/jobs/:id/pay` — Authorize payment and enqueue to physical printer.
- `GET /api/jobs` — Retrieve print queue for admin dashboard.
- `POST /api/jobs/:id/retry` — Authorize reprint for failed job.
- `GET /api/pricing-rules` — List pricing rules.
- `PUT /api/pricing-rules/:id` — Update pricing rule.
- `GET /api/audit-logs` — Retrieve security audit trail.
- `GET /api/stream` — Real-time Server-Sent Events (SSE) feed.
