// ============================================================
// PORTAL ROUTES – /portal/*
// ============================================================
import React, { Suspense, useEffect } from "react";
import { lazyPage } from "../lazyPage.js";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth, can } from "./lib/auth.jsx";
import { UiProvider, Loading, Empty } from "./ui/index.jsx";
import { ShieldOff } from "lucide-react";
import PortalLayout from "./PortalLayout.jsx";

const ClassRoom = lazyPage(() => import("./pages/ClassRoom.jsx"));
import { LoginPage, ForgotPasswordPage, ResetPasswordPage, homeFor } from "./pages/AuthPages.jsx";
import { NotificationsPage, AnnouncementsPage, ProfilePage } from "./pages/SharedPages.jsx";
import { StudentDashboard, StudentClasses, StudentMaterials, StudentProgress } from "./pages/StudentPages.jsx";
import { StudentAttendance, TeacherAttendance, AdminAttendance } from "./pages/AttendancePages.jsx";
import { TeacherDashboard, TeacherCalendar, TeacherStudents, TeacherStudentDetail, TeacherMaterials, TeacherRequests } from "./pages/TeacherPages.jsx";
import { AdminDashboard, AdminAlerts } from "./pages/admin/AdminDashboard.jsx";
import { AdminUsersPage, AdminUserDetail, AdminAdminsPage } from "./pages/admin/AdminUsers.jsx";
import { AdminClasses, AdminRequests } from "./pages/admin/AdminClasses.jsx";
import { AdminMaterials } from "./pages/admin/AdminContent.jsx";
import { AdminAnnouncements, AdminNotifications } from "./pages/admin/AdminComms.jsx";
import { AdminReports, AdminSettings, AdminBackups } from "./pages/admin/AdminSystem.jsx";
import { AdminRecordings } from "./pages/admin/AdminRecordings.jsx";
import { StudentRecordings } from "./pages/StudentRecordings.jsx";
import { MessagesPage, AdminMessagesPage } from "./pages/MessagesPage.jsx";
import { StudentFees, AdminSessions, AdminFees } from "./pages/FeePages.jsx";
import { AdminSubjects } from "./pages/admin/AdminSubjects.jsx";
import { SessionRegister, TeacherSessions } from "./pages/RegisterPages.jsx";
import { AdminTeacherPayments, TeacherPayments } from "./pages/TeacherPaymentPages.jsx";
import { AdminDemos, GuestDone, GuestJoin, TeacherDemos } from "./pages/DemoPages.jsx";
import { AdminTimetable, TeacherTimetable, StudentTimetable } from "./pages/TimetablePages.jsx";

// The class page loads only when someone opens a class

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading className="min-h-svh" label="Loading your portal…" />;
  if (!user) return <Navigate to="/portal/login" replace state={{ from: location.pathname + location.search }} />;
  // A demo guest can only be in their one class
  if (user.role === "guest" && location.pathname !== `/portal/class/${user.meetingId}`) return <Navigate to={`/portal/class/${user.meetingId}`} replace />;
  return children;
}

function Role({ role, perm, superOnly, children }) {
  const { user } = useAuth();
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  if ((perm && !can(user, perm)) || (superOnly && !user.superAdmin))
    return <Empty icon={ShieldOff} title="You don't have access to this page" text="Ask a super admin to give your account this permission." />;
  return children;
}

// The register opens for the session's teacher and for admins with sessions / attendance
function RegisterRoute() {
  const { user } = useAuth();
  if (user.role === "teacher") return <SessionRegister />;
  return A(["sessions", "attendance"], <SessionRegister />);
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user)} replace />;
}

function Title() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = "Portal · Silora Academy";
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const A = (perm, el, superOnly) => (
  <Role role="admin" perm={perm} superOnly={superOnly}>
    {el}
  </Role>
);
function MessagesRoute() {
  const { user } = useAuth();
  if (user.role === "admin") return <Navigate to="/portal/admin/messages" replace />;
  return <MessagesPage />;
}
const T = (el) => <Role role="teacher">{el}</Role>;
const S = (el) => <Role role="student">{el}</Role>;

export default function PortalApp() {
  return (
    <AuthProvider>
      <UiProvider>
        <Title />
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="demo/:token" element={<GuestJoin />} />
          <Route path="demo-done" element={<GuestDone />} />
          <Route
            path="class/:id"
            element={
              <RequireAuth>
                <Suspense fallback={<div className="flex h-svh items-center justify-center bg-[#0b1724]"><Loading label="Opening class…" /></div>}>
                  <ClassRoom />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route
            element={
              <RequireAuth>
                <PortalLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="messages" element={<MessagesRoute />} />

            <Route path="student" element={S(<StudentDashboard />)} />
            <Route path="student/classes" element={S(<StudentClasses />)} />
            <Route path="student/timetable" element={S(<StudentTimetable />)} />
            <Route path="student/materials" element={S(<StudentMaterials />)} />
            <Route path="student/recordings" element={S(<StudentRecordings />)} />
            <Route path="student/attendance" element={S(<StudentAttendance />)} />
            <Route path="student/progress" element={S(<StudentProgress />)} />
            <Route path="student/fees" element={S(<StudentFees />)} />

            <Route path="teacher" element={T(<TeacherDashboard />)} />
            <Route path="teacher/calendar" element={T(<TeacherCalendar />)} />
            <Route path="teacher/timetable" element={T(<TeacherTimetable />)} />
            <Route path="teacher/classes" element={<Navigate to="/portal/teacher/calendar" replace />} />
            <Route path="teacher/attendance" element={T(<TeacherAttendance />)} />
            <Route path="teacher/sessions" element={T(<TeacherSessions />)} />
            <Route path="sessions/:id/register" element={<RegisterRoute />} />
            <Route path="teacher/payments" element={T(<TeacherPayments />)} />
            <Route path="teacher/demos" element={T(<TeacherDemos />)} />
            <Route path="teacher/students" element={T(<TeacherStudents />)} />
            <Route path="teacher/students/:id" element={T(<TeacherStudentDetail />)} />
            <Route path="teacher/materials" element={T(<TeacherMaterials />)} />
            <Route path="teacher/requests" element={T(<TeacherRequests />)} />

            <Route path="admin" element={A(null, <AdminDashboard />)} />
            <Route path="admin/students" element={A("users", <AdminUsersPage key="s" role="student" />)} />
            <Route path="admin/teachers" element={A("users", <AdminUsersPage key="t" role="teacher" />)} />
            <Route path="admin/admins" element={A(null, <AdminAdminsPage />, true)} />
            <Route path="admin/users/:id" element={A("users", <AdminUserDetail />)} />
            <Route path="admin/sessions" element={A("sessions", <AdminSessions />)} />
            <Route path="admin/subjects" element={A(["settings", "users", "sessions"], <AdminSubjects />)} />
            <Route path="admin/fees" element={A("fees", <AdminFees />)} />
            <Route path="admin/teacher-payments" element={A("teacherPayments", <AdminTeacherPayments />)} />
            <Route path="admin/demos" element={A("demos", <AdminDemos />)} />
            <Route path="admin/classes" element={A("classes", <AdminClasses />)} />
            <Route path="admin/timetable" element={A("classes", <AdminTimetable />)} />
            <Route path="admin/requests" element={A("classes", <AdminRequests />)} />
            <Route path="admin/schedule-requests" element={<Navigate to="/portal/admin/requests" replace />} />
            <Route path="admin/materials" element={A("materials", <AdminMaterials />)} />
            <Route path="admin/attendance" element={A("attendance", <AdminAttendance />)} />
            <Route path="admin/recordings" element={A("recordings", <AdminRecordings />)} />
            <Route path="admin/messages" element={A(["messages", "groups"], <AdminMessagesPage />)} />
            <Route path="admin/announcements" element={A("announcements", <AdminAnnouncements />)} />
            <Route path="admin/notifications" element={A("notifications", <AdminNotifications />)} />
            <Route path="admin/alerts" element={A(null, <AdminAlerts />)} />
            <Route path="admin/reports" element={A("reports", <AdminReports />)} />
            <Route path="admin/settings" element={A("settings", <AdminSettings />)} />
            <Route path="admin/backups" element={A("backups", <AdminBackups />)} />
            <Route path="*" element={<Empty title="Page not found" text="Use the menu to find what you're looking for." />} />
          </Route>
        </Routes>
      </UiProvider>
    </AuthProvider>
  );
}
