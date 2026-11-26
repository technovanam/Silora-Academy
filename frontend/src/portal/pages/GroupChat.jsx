// ============================================================
// GROUP CHATS – the pieces MessagesPage uses for groups:
//  • GroupDialog        admin: create / edit / delete a group
//  • MembersDialog      members list; managers (teachers) add / remove
//                       their own students, admins anyone
//  • MessageInfoDialog  who has received / seen one of your messages
// Members only ever see names and roles – never contact details.
// ============================================================
import React, { useEffect, useMemo, useState } from "react";
import { Check, CheckCheck, Megaphone, Shield, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api.js";
import { fmtDateTime } from "../lib/format.js";
import { Avatar, Badge, Button, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Notice, Select, Textarea, Toggle, cx, useAsync, useUi } from "../ui/index.jsx";

const ROLE = { teacher: "Teacher", student: "Student" };

export function GroupAvatar({ announcement, className }) {
  const Icon = announcement ? Megaphone : Users;
  return (
    <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", announcement ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700", className)}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

// ---- Admin: create / edit -------------------------------------------------------------
export function GroupDialog({ group, onClose, onSaved, onDeleted }) {
  const ui = useUi();
  const open = !!group;
  const editing = !!group?.id;
  const [f, setF] = useState(null);
  const [people, setPeople] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!group) return;
    setF({ name: group.name || "", description: group.description || "", memberIds: group.memberIds || [], managerIds: group.managerIds || [], onlyAdminsPost: !!group.onlyAdminsPost });
    setPeople(null);
    Promise.all([
      api.get("/admin/groups/contacts"),
      editing ? api.get(`/admin/groups/conversations/${group.id}/members`) : Promise.resolve({ members: [] }),
      editing ? Promise.resolve({ templates: [] }) : api.get("/admin/groups/templates"),
    ])
      .then(([c, m, t]) => {
        // Existing members who are no longer active still show (so they can be removed)
        const map = new Map(c.contacts.map((u) => [u.id, u]));
        for (const u of m.members) if (!map.has(u.id)) map.set(u.id, { ...u, subtitle: "inactive" });
        setPeople([...map.values()]);
        setTemplates(t.templates);
      })
      .catch((e) => {
        ui.error(e);
        setPeople([]);
      });
  }, [group]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries((people || []).map((u) => [u.id, u])), [people]);
  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const teacherMembers = f.memberIds.filter((id) => byId[id]?.role === "teacher");
  const counts = { teacher: teacherMembers.length, student: f.memberIds.length - teacherMembers.length };

  const applyTemplate = (key) => {
    const t = templates.find((x) => x.key === key);
    if (t) setF((x) => ({ ...x, name: x.name || t.name, memberIds: t.memberIds, managerIds: t.managerIds || [], onlyAdminsPost: !!t.onlyAdminsPost }));
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, managerIds: f.managerIds.filter((id) => f.memberIds.includes(id)) };
      if (editing) {
        await api.patch(`/admin/groups/${group.id}`, body);
        ui.toast("Group updated");
        onSaved(group.id);
      } else {
        const r = await api.post("/admin/groups", body);
        ui.toast(`Group created – ${f.memberIds.length} members`);
        onSaved(r.id);
      }
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await ui.confirm({
      title: `Delete “${group.name}”?`,
      message: "The group, all its messages and files are deleted for every member. This can't be undone.",
      confirmLabel: "Delete group",
      danger: true,
      onConfirm: () => api.del(`/admin/groups/${group.id}`),
    });
    if (ok) {
      ui.toast("Group deleted");
      onDeleted();
    }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={editing ? "Edit group" : "New group"} subtitle="Members see each other's names only – never phone numbers or emails.">
      {!people ? (
        <Loading className="py-12" />
      ) : (
        <form onSubmit={save} className="space-y-4">
          {!editing && templates.length > 0 && (
            <Field label="Start from" hint="Fills in the members – you can change them below">
              <Select value={null} onChange={applyTemplate} placeholder="Choose a template (optional)…" searchable options={templates.map((t) => ({ value: t.key, label: t.label, hint: `${t.count} people` }))} />
            </Field>
          )}
          <Field label="Group name" required>
            <Input value={f.name} onChange={set("name")} maxLength={80} required placeholder="e.g. Mathematics – Students" />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={f.description} onChange={set("description")} maxLength={300} />
          </Field>
          <Field label="Members" hint={`${counts.teacher} teachers · ${counts.student} students`}>
            <Select multiple searchable value={f.memberIds} onChange={set("memberIds")} placeholder="Add teachers and students…" options={people.map((u) => ({ value: u.id, label: u.name, hint: [ROLE[u.role], u.subtitle].filter(Boolean).join(" · ") }))} />
          </Field>
          <Field label="Group managers" hint="Teacher members who may add and remove their own students">
            <Select multiple value={f.managerIds.filter((id) => teacherMembers.includes(id))} onChange={set("managerIds")} placeholder={teacherMembers.length ? "No managers" : "Add a teacher as a member first"} disabled={!teacherMembers.length} options={teacherMembers.map((id) => ({ value: id, label: byId[id]?.name || "Teacher" }))} />
          </Field>
          <Toggle checked={f.onlyAdminsPost} onChange={set("onlyAdminsPost")} label="Announcements only" description="Only Silora Academy and group managers can send messages. Students don't see the member list." />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button type="submit" loading={busy} disabled={!f.name.trim()}>
              {editing ? "Save changes" : "Create group"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {editing && (
              <Button variant="danger" icon={Trash2} className="ml-auto" onClick={remove}>
                Delete group
              </Button>
            )}
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ---- Members -----------------------------------------------------------------------------
export function MembersDialog({ base, id, admin, onClose, onChanged }) {
  const ui = useUi();
  const { data, loading, error, reload } = useAsync(() => api.get(`${base}/conversations/${id}/members`), [base, id]);
  const [adding, setAdding] = useState(null); // contacts list while adding
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const memberIds = new Set((data?.members || []).map((m) => m.id));

  const change = async (body, msg) => {
    setBusy(true);
    try {
      await api.post(`${base}/conversations/${id}/members`, body);
      ui.toast(msg);
      setAdding(null);
      setPicked([]);
      reload(true);
      onChanged?.();
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };

  const startAdding = async () => {
    try {
      const r = await api.get(`${base}/contacts`);
      setAdding(r.contacts.filter((c) => (admin || c.role === "student") && !memberIds.has(c.id)));
    } catch (e) {
      ui.error(e);
    }
  };

  const removeOne = (m) =>
    ui.confirm({
      title: `Remove ${m.name}?`,
      message: "They lose access to the group straight away. Messages they already sent stay.",
      confirmLabel: "Remove",
      danger: true,
      onConfirm: () => change({ remove: [m.id] }, `${m.name} removed`),
    });

  return (
    <Dialog open onClose={onClose} size="md" title="Group members" subtitle={data ? `${data.members.length} members` : ""}>
      {loading ? (
        <Loading className="py-10" />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          {data.canManage &&
            (adding ? (
              <div className="mb-4 space-y-2 rounded-xl border border-line p-3">
                {adding.length ? (
                  <>
                    <Select multiple searchable value={picked} onChange={setPicked} placeholder={admin ? "Choose teachers or students…" : "Choose your students…"} options={adding.map((c) => ({ value: c.id, label: c.name, hint: [admin && ROLE[c.role], c.subtitle].filter(Boolean).join(" · ") }))} />
                    <div className="flex gap-2">
                      <Button size="sm" icon={UserPlus} loading={busy} disabled={!picked.length} onClick={() => change({ add: picked }, `Added ${picked.length} member${picked.length === 1 ? "" : "s"}`)}>
                        Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <Notice tone="info">{admin ? "Every active teacher and student is already in this group." : "All your students are already in this group."}</Notice>
                )}
              </div>
            ) : (
              <Button size="sm" variant="outline" icon={UserPlus} className="mb-4" onClick={startAdding}>
                {admin ? "Add members" : "Add my students"}
              </Button>
            ))}
          {!data.members.length && <Empty icon={Users} title="No members" className="py-8" />}
          <ul className="-mx-2 max-h-[55vh] space-y-0.5 overflow-y-auto" data-lenis-prevent>
            {data.members.map((m) => {
              const removable = data.canManage && !m.you && (admin || m.role === "student");
              return (
                <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <Avatar name={m.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {m.name}
                      {m.you && <span className="font-normal text-muted"> (you)</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {ROLE[m.role] || m.role}
                      {m.isManager && (
                        <Badge tone="blue">
                          <Shield className="mr-1 inline h-3 w-3" />
                          Manager
                        </Badge>
                      )}
                      {m.active === false && <Badge tone="gray">Inactive</Badge>}
                    </span>
                  </span>
                  {removable && <IconButton icon={UserMinus} label={`Remove ${m.name}`} disabled={busy} onClick={() => removeOne(m)} />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}

// ---- Message info ------------------------------------------------------------------------
export function MessageInfoDialog({ base, id, m, onClose }) {
  const { data, loading, error, reload } = useAsync(() => api.get(`${base}/conversations/${id}/messages/${m.id}/info`), [base, id, m.id]);
  const section = (title, Icon, color, list) =>
    list.length > 0 && (
      <div className="mb-4">
        <p className={cx("mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", color)}>
          <Icon className="h-4 w-4" />
          {title} ({list.length})
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-line text-sm">
          {list.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate">
                {x.name} <span className="text-xs text-muted">· {ROLE[x.role] || x.role}</span>
              </span>
              {x.at && <span className="shrink-0 text-[11px] text-slate-400">{fmtDateTime(x.at)}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <Dialog open onClose={onClose} size="sm" title="Message info" subtitle={m.text ? m.text.slice(0, 80) : m.file?.fileName || ""}>
      {loading ? (
        <Loading className="py-10" />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.members.length ? (
        <Empty title="No one else was in the group yet" className="py-8" />
      ) : (
        <>
          {section("Seen", CheckCheck, "text-sky-600", data.members.filter((x) => x.state === "seen"))}
          {section("Delivered", CheckCheck, "text-slate-500", data.members.filter((x) => x.state === "delivered"))}
          {section("Not delivered yet", Check, "text-slate-400", data.members.filter((x) => x.state === "sent"))}
        </>
      )}
    </Dialog>
  );
}
