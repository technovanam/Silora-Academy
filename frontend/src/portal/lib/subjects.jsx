// The academy's subject list (Settings → Subjects). Every subject field in the
// portal is a dropdown from it, so the same subject is always spelled the same
// way – that's what links classes to sessions and fees.
import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Select } from "../ui/index.jsx";

let cache = null;
let pending = null;
const listeners = new Set();

function load(force) {
  if (cache && !force) return Promise.resolve(cache);
  if (!pending || force)
    pending = api
      .get("/subjects")
      .then((r) => {
        cache = r.subjects || [];
        listeners.forEach((fn) => fn(cache));
        return cache;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}

/** Call after the admin changes the list */
export const refreshSubjects = () => load(true);

export function useSubjects() {
  const [list, setList] = useState(cache || []);
  useEffect(() => {
    listeners.add(setList);
    load().then(setList).catch(() => {});
    return () => listeners.delete(setList);
  }, []);
  return list;
}

/**
 * Subject dropdown. `only` narrows it (e.g. the subjects a teacher takes for a
 * student); a value no longer in the list (retired subject) stays selectable.
 */
export function SubjectSelect({ value, onChange, only, placeholder = "Choose subject", clearable, className, disabled, hints = {} }) {
  const all = useSubjects();
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  let names = only ? all.filter((s) => only.some((o) => same(o, s))) : all;
  if (only) for (const o of only) if (o && !names.some((n) => same(n, o))) names = [...names, o];
  if (value && !names.some((n) => same(n, value))) names = [...names, value];
  return (
    <Select
      className={className}
      value={value || null}
      onChange={(v) => onChange(v || "")}
      options={names.map((n) => ({ value: n, label: n, hint: hints[n] }))}
      placeholder={placeholder}
      searchable={names.length > 8}
      clearable={clearable}
      disabled={disabled}
      emptyText="No subjects yet – an admin adds them in Settings → Subjects"
    />
  );
}
