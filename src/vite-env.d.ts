/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set to 'true' only when running alongside Firebase emulators (npm run dev:app).
  // MUST NOT be 'true' in production — validated at startup by envValidation.ts.
  readonly VITE_USE_EMULATOR?: string;
}
