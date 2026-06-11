import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import { ThemeProvider } from './components/ui/ThemeProvider';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { router } from './router';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          {/* Phase P — global offline banner (Firestore queues writes offline) */}
          <OfflineIndicator />
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
