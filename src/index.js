import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AdminApp from './AdminApp';
import reportWebVitals from './reportWebVitals';

// Simple pathname-based split: /admin renders the admin panel,
// everything else renders the customer storefront.
// (No router library is used — the hosting config just needs to serve
// index.html for both paths, which is standard for any SPA deploy.)
const isAdminRoute = window.location.pathname.startsWith('/admin');

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {isAdminRoute ? <AdminApp /> : <App />}
  </React.StrictMode>
);

reportWebVitals();
