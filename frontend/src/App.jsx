import React from "react";
import { Outlet } from "react-router-dom";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import ScrollToTop from "./components/ScrollToTop.jsx";

// ============================================================
// MAIN APP LAYOUT COMPONENT
// ============================================================

function App() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />

      <ScrollToTop />

      <main className="flex-grow pt-16 lg:pt-[72px]">
        <React.Suspense fallback={<div className="flex h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand" /></div>}>
          <Outlet />
        </React.Suspense>
      </main>

      <Footer />
    </div>
  );
}

export default App;