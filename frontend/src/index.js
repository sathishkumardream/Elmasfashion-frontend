import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App, { ResetPasswordPage } from './App';
import AdminApp from './AdminApp';
import reportWebVitals from './reportWebVitals';

// Simple pathname-based split: /admin renders the admin panel,
// /reset-password renders the standalone password-reset page (reached via
// the link emailed by /forgot-password), everything else renders the
// customer storefront.
// (No router library is used — the hosting config just needs to serve
// index.html for both paths, which is standard for any SPA deploy.)
const path = window.location.pathname;
const isAdminRoute = path.startsWith('/admin');
const isResetPasswordRoute = path.startsWith('/reset-password');

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {isAdminRoute ? <AdminApp /> : isResetPasswordRoute ? <ResetPasswordPage /> : <App />}
  </React.StrictMode>
);

reportWebVitals();
