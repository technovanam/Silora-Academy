import React from "react";
import { api } from "../../lib/api.js";
import { ErrorBox, Loading, PageHeader, useAsync } from "../../ui/index.jsx";
import { MaterialsManager } from "../../components/materials.jsx";

// ---- Materials ---------------------------------------------------------------------
// (Attendance moved to pages/AttendancePages.jsx)
export function AdminMaterials() {
  const dir = useAsync(() => api.get("/admin/directory"), []);
  return (
    <>
      <PageHeader title="Materials" subtitle="Every teacher's materials, with “opened” tracking for each student." />
      <ErrorBox error={dir.error} onRetry={dir.reload} />
      {dir.loading ? <Loading /> : <MaterialsManager mode="admin" students={dir.data?.students || []} teachers={dir.data?.teachers || []} />}
    </>
  );
}
