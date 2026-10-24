import React from 'react';
import ReactDOM from 'react-dom/client';
import * as z from 'zod';
import { configureAmplify } from './auth/amplify-config';
import App from './App';
import './app.css';

// zod's JIT compiles validators with new Function, which the CSP (no 'unsafe-eval') blocks;
// jitless mode skips that and its eval probe, so the console stays free of CSP violations
z.config({ jitless: true });

// Configure Amplify before rendering
configureAmplify();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
