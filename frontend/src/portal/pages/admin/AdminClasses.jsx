import React, { useMemo, useState } from "react";
import { Ban, CalendarDays, List, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { fmtDateTime } from "../../lib/format.js";
import { Button, Card, Dialog, Empty, ErrorBox, Field, IconButton, Loading, Menu, PageHeader, Segmented, Select, Textarea, useAsync, useUi } from "../../ui/index.jsx";
import { ClassDetailDialog, ClassFormDialog, ClassRow, JoinButton, WeekCalendar, mondayOf, useNow } from "../../components/classes.jsx";
import { ScheduleRequestsList } from "../TeacherPages.jsx";

export function AdminClasses() {
  const ui = useUi();
  const [view, setView] = useState("week");
  const [week, setWeek] = useState(mondayOf());
  const [teacherId, setTeacherId] = useState(null);
  const [listFilter, setListFilter] = useState("upcoming");
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState("");
  const meetings = useAsync(() => api.get("/meetings", { teacherId }), [teacherId]);
  const dir = useAsync(() => api.get("/admin/directory"), []);
  useNow(30000);
  const all = useMemo(() => meetings.data?.meetings || [], [meetings.data]);
  const reload = () => meetings.reload(true);
  const list = useMemo(() => {
    const now = Date.now();
    if (listFilter === "upcoming") return all.filter((m) => m.status === "scheduled" && new Date(m.endAt).getTime() > now);
    if (listFilter === "past") return all.filter((m) => m.status === "completed" || (m.status === "scheduled" && new Date(m.endAt).getTime() <= now)).reverse();
    return all.filter((m) => m.status === "cancelled").reverse();
  }, [all, listFilter]);

  const cancel = async () => {
    try {
      await api.post(`/meetings/${dialog.m.id}/cancel`, { reason });
      ui.toast("Class cancelled – teacher and students notified");
      setDialog(null);
      setReason("");
      reload();
    } catch (e) {
      ui.error(e);
    }
  };
  const remove = (m) =>
    ui.confirm({
      title: "Delete this class?",
      message: `"${m.title}" will be removed from everyone's calendar without a notification. Use Cancel instead if students should be told.`,
      danger: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        await api.del(`/meetings/${m.id}`);
        setDialog(null);
        reload();
      },
    });

  const actionsFor = (m) => (
    <>
      {m.status !== "cancelled" && <JoinButton m={m} size="sm" allowEarly />}
      <Menu
        trigger={<IconButton icon={MoreHorizontal} label="More" />}
        items={[
          { label: "Edit / reschedule", icon: Pencil, onClick: () => setDialog({ type: "edit", m }), hidden: m.status !== "scheduled" },
          { label: "Cancel class", icon: Ban, danger: true, onClick: () => setDialog({ type: "cancel", m }), hidden: m.status !== "scheduled" },
          { label: "Delete", icon: Trash2, danger: true, onClick: () => remove(m) },
        ]}
      />
    </>
  );

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="All classes across teachers. Students get reminders 5 minutes before each class."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "week", label: "Week", icon: CalendarDays },
                { value: "list", label: "List", icon: List },
              ]}
            />
            <Button icon={Plus} onClick={() => setDialog({ type: "new" })}>
              Schedule class
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-full sm:w-60" value={teacherId} onChange={setTeacherId} options={(dir.data?.teachers || []).map((t) => ({ value: t.id, label: t.name }))} placeholder="All teachers" clearable />
        {view === "list" && (
          <Segmented
            value={listFilter}
            onChange={setListFilter}
            options={[
              { value: "upcoming", label: "Upcoming" },
              { value: "past", label: "Past" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
        )}
      </div>
      <ErrorBox error={meetings.error} onRetry={meetings.reload} />
      {meetings.loading ? (
        <Loading />
      ) : view === "week" ? (
        <WeekCalendar weekStart={week} onWeekChange={setWeek} meetings={all} onSelect={(m) => setDialog({ type: "detail", m })} showTeacher />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={CalendarDays} title="No classes here" />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((m) => (
            <ClassRow key={m.id} m={m} showTeacher actions={actionsFor(m)} />
          ))}
        </div>
      )}

      <ClassFormDialog
        open={dialog?.type === "new" || dialog?.type === "edit"}
        meeting={dialog?.type === "edit" ? dialog.m : null}
        onClose={() => setDialog(null)}
        onSaved={reload}
        mode="admin"
        students={dir.data?.students || []}
        teachers={(dir.data?.teachers || []).filter((t) => t.active)}
      />
      <ClassDetailDialog meeting={dialog?.type === "detail" ? dialog.m : null} onClose={() => setDialog(null)} actions={dialog?.type === "detail" ? actionsFor(dialog.m) : null} />
      <Dialog
        open={dialog?.type === "cancel"}
        onClose={() => setDialog(null)}
        title="Cancel class"
        subtitle={dialog?.m && `${dialog.m.title} · ${fmtDateTime(dialog.m.startAt)}`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>Keep class</Button>
            <Button variant="danger" onClick={cancel}>Cancel class</Button>
          </>
        }
      >
        <Field label="Reason (shared with teacher and students)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
      </Dialog>
    </>
  );
}

export function AdminRequests() {
  return (
    <>
      <PageHeader title="Schedule requests" subtitle="Approve or decline teachers' reschedule and cancellation requests." />
      <ScheduleRequestsList admin />
    </>
  );
}
