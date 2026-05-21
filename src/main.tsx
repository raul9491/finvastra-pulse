import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { validateClientEnv } from './lib/envValidation';
import App from './App.tsx';
import './index.css';

validateClientEnv();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
