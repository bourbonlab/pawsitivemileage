import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureAmplify } from './auth/amplify-config';
import App from './App';
import './app.css';

// Configure Amplify before rendering
configureAmplify();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
