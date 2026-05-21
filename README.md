Replace README.md entirely with a proper Finvastra Pulse README.
No code changes — documentation only.

Content to write:

# Finvastra Pulse — Operations Platform

Internal operations platform for Finvastra Advisors Pvt. Ltd.
Covers CRM (loan pipeline, lead management, commissions), 
HRMS (attendance, leave, payslips), and MIS (commission 
reconciliation, RM payouts).

## Stack
React 19 + Vite 6 + TypeScript + Tailwind v4 + Firebase 
(Auth + Firestore + Hosting) + Express

## Local Development

Prerequisites: Node.js 18+, Java 21+ (for Firebase emulators)

1. Install dependencies:
   npm install

2. Copy environment template:
   cp .env.example .env.local
   Fill in the values from the pre-launch checklist.

3. Start emulators + dev server:
   npm run dev:emulator

4. Seed employee data (first time only):
   npm run seed:emulator

5. Open http://localhost:3000

## Production Deployment

npm run build:prod
firebase deploy --only hosting

Live at: https://pulse.finvastra.com

## Access
Login restricted to @finvastra.com domain only.
Admin: rahulv@finvastra.com

## Notes
- No AI or LLM in this platform — all logic is deterministic code
- Personal Gmail IDs in employee records are contact info only, 
  never used for login
- See CLAUDE.md for full architecture documentation

Commit message: "docs: replace AI Studio template README with 
Finvastra Pulse documentation"
