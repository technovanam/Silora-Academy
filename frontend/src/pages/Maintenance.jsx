import React from "react";
import { Wrench } from "lucide-react";
import { SITE } from "../data/site";

// Maintenance page – shown when MAINTENANCE_MODE is on
export default function Maintenance() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-3xl border border-line bg-white p-10 text-center shadow-sm">
        <img src={SITE.logo} alt={`${SITE.name} Logo`} className="mx-auto h-12 w-auto" />
        <span className="mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
          <Wrench className="h-6 w-6 text-brand-hover" />
        </span>
        <h1 className="mt-5 text-2xl font-bold">We'll be back soon!</h1>
        <p className="mt-3 text-muted">
          Our website is currently undergoing scheduled maintenance. Thank you for your patience and understanding.
        </p>
        <p className="mt-4 text-sm font-semibold text-brand-hover">— {SITE.name} Team</p>
      </div>
    </div>
  );
}
