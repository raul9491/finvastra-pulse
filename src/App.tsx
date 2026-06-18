import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthContext';
import { UiPrefsCloudSync } from './features/auth/UiPrefsCloudSync';
import { ToastProvider } from './components/ui/Toast';
import { ThemeProvider } from './components/ui/ThemeProvider';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { InstallAppBanner } from './components/ui/InstallAppBanner';
import { TourProvider } from './features/learn/TourProvider';
import { router } from './router';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        {/* Phase 6 — mirror pinned pages / open sections to the user doc (cross-device) */}
        <UiPrefsCloudSync />
        {/* First-run guided tours — renders a spotlight overlay above everything */}
        <TourProvider>
          <ToastProvider>
            {/* Phase P — global offline banner (Firestore queues writes offline) */}
            <OfflineIndicator />
            {/* Global "Install app" PWA banner (native on Android/Chrome, iOS instructions) */}
            <InstallAppBanner />
            <RouterProvider router={router} />
          </ToastProvider>
        </TourProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
