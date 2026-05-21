// Called once at app startup (src/main.tsx).
// Firebase config comes from firebase-applet-config.json (committed, safe to ship).
// The only env-level check needed is the emulator flag — it must be off in prod.
export function validateClientEnv(): void {
  if (!import.meta.env.PROD) return;

  if (import.meta.env.VITE_USE_EMULATOR === 'true') {
    throw new Error(
      '[envValidation] VITE_USE_EMULATOR is "true" in a production build. ' +
      'This flag must never be set to "true" in production.',
    );
  }
}
