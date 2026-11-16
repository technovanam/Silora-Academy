
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import App from './App.jsx';
import Home from './pages/Home.jsx';
import Maintenance from './pages/Maintenance.jsx';
import { MAINTENANCE_MODE, MAINTENANCE_PREVIEW_SECRET } from './config.js';
// Lazy load other pages
const About = React.lazy(() => import('./pages/About.jsx'));
const Services = React.lazy(() => import('./pages/Services.jsx'));
const Contact = React.lazy(() => import('./pages/Contact.jsx'));
const BookDemo = React.lazy(() => import('./pages/BookDemo.jsx'));
const JoinTutor = React.lazy(() => import('./pages/JoinTutor.jsx'));
const PortalApp = React.lazy(() => import('./portal/PortalApp.jsx'));
import './index.css';

// ============================================================
// APP ENTRY POINT & ROUTING
// ============================================================

// Helper: check if developer preview is enabled (via ?preview=devsecret)
function isDeveloperPreview() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('preview') === MAINTENANCE_PREVIEW_SECRET;
}

// App routes for normal site
function AppRoutes() {
  return (
    <Routes>
      {/* The App component is the layout route */}
      <Route path="/" element={<App />}>
        {/* Child routes are rendered inside App's <Outlet> */}
        <Route index element={<Home />} />
        <Route path="about" element={<About />} />
        <Route path="services" element={<Services />} />
        <Route path="contact" element={<Contact />} />
        <Route path="book-demo" element={<BookDemo />} />
        <Route path="join-tutor" element={<JoinTutor />} />
        {/* You can add a 404 Not Found page here later */}
      </Route>
      {/* Learning portal (admin / teacher / student) */}
      <Route
        path="/portal/*"
        element={
          <React.Suspense fallback={<div className="min-h-svh bg-surface" />}>
            <PortalApp />
          </React.Suspense>
        }
      />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {MAINTENANCE_MODE ? (
        <Routes>
          <Route
            path="*"
            element={
              isDeveloperPreview() ? <AppRoutes /> : <Maintenance />
            }
          />
        </Routes>
      ) : (
        <AppRoutes />
      )}
    </BrowserRouter>
  </React.StrictMode>
);
