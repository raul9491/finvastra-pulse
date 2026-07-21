/**
 * server/db.ts — the ONE place Firebase Admin is initialized and the named
 * Firestore handle is created. Extracted from server.ts (2026-07-21, Phase 3
 * refactor foundation) so route/helper modules can `import { db, admin }` from
 * a single source instead of closing over server.ts's module scope.
 *
 * Behavior is byte-identical to the old inline init in server.ts:
 *   • idempotent admin.initializeApp() (ADC in Cloud Run)
 *   • emulator → default DB; production → the named `pulse` DB
 * dotenv is loaded here too so VITE_USE_EMULATOR resolves correctly regardless
 * of ESM import order (this module may evaluate before server.ts's body runs).
 */
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";

dotenv.config();

// Initialize Firebase Admin (uses Application Default Credentials in Cloud Run).
if (!admin.apps.length) {
  admin.initializeApp();
}

// Named Firestore database — must match firestoreDatabaseId in firebase-applet-config.json.
// The emulator uses the default database; production uses the named one.
// Migrated 2026-06-10 from the AI-Studio free-tier DB (ai-studio-27afcadd-…), which
// had an unliftable 50k-reads/day cap, to a standard uncapped database.
const FIRESTORE_DB_ID = "pulse";
export const useEmulator = process.env.VITE_USE_EMULATOR === "true";

export const db = useEmulator
  ? admin.firestore()
  : getFirestore(admin.app(), FIRESTORE_DB_ID);

export { admin };
