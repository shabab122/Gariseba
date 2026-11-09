import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/manrope';
import '@fontsource-variable/noto-sans-bengali';
import './style.css';
import { AppProvider, useApp } from './context.jsx';
import { PublicLayout } from './layout.jsx';
import { Home, Privacy } from './home.jsx';

const RequestWizard = lazy(() => import('./request.jsx'));
const Assistant = lazy(() => import('./assistant.jsx'));
const Track = lazy(() => import('./track.jsx'));
const Admin = lazy(() => import('./admin.jsx'));

function Loading() {
  const { t } = useApp();
  return <div className="container-wide py-12 muted" role="status">{t.checking}</div>;
}

function Unavailable() {
  const { t } = useApp();
  return <div className="container-wide py-20"><h1>{t.notFound}</h1><Link className="text-link" to="/">{t.home}</Link></div>;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route index element={<Home />} />
              <Route path="/request" element={<RequestWizard />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/track" element={<Track />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="*" element={<Unavailable />} />
            </Route>
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </Suspense>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
