/**
 * Looks up Firebase Auth UIDs for the three super admins by empCode.
 * Run: npx tsx scripts/test/lookupSuperAdmins.ts
 */
import admin from "firebase-admin";
import { readFileSync, readdirSync } from "fs";
import { getFirestore } from "firebase-admin/firestore";

const keyPath = (() => {
  const dir = "C:/Users/raul9/Downloads";
  const f = readdirSync(dir).find(n => n.includes("firebase-adminsdk") || n.includes("service-account"));
  if (f) return `${dir}/${f}`;
  throw new Error("Service account key not found");
})();

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf-8"))) });
const db = getFirestore(admin.app(), "ai-studio-27afcadd-87fc-4f68-8a88-587e904a31bf");

async function main() {
  const targets = [
    { empCode: "FAPL-000", name: "Ajay", email: "ajay@finvastra.com" },
    { empCode: "FAPL-003", name: "Kumar", email: "kumar@finvastra.com" },
    { empCode: "FAPL-022", name: "Rahul", email: "rahulv@finvastra.com" },
  ];

  console.log("\n=== Super Admin UID Lookup ===\n");
  const uids: string[] = [];

  for (const t of targets) {
    const snap = await db.collection("users").where("employeeId", "==", t.empCode).limit(1).get();
    if (snap.empty) {
      // Try by email via Firebase Auth
      try {
        const record = await admin.auth().getUserByEmail(t.email);
        console.log(`${t.name} (${t.empCode}): uid = ${record.uid}  [found via Auth]`);
        uids.push(record.uid);
      } catch {
        console.log(`${t.name} (${t.empCode}): NOT FOUND`);
      }
    } else {
      const uid = snap.docs[0].id;
      const data = snap.docs[0].data();
      console.log(`${t.name} (${t.empCode}): uid = ${uid}  email=${data.email ?? t.email}`);
      uids.push(uid);
    }
  }

  console.log("\n=== SUPER_ADMIN_UIDS env var value ===");
  console.log(uids.join(","));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
