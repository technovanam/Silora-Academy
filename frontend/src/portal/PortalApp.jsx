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
// Each page file loads when it is first opened, so students and teachers never
// download the admin pages (and the other way round).
const named = (load, name) => lazyPage(() => load().then((m) => ({ default: m[name] })));
import { LoginPage, ForgotPasswordPage, ResetPasswordPage, homeFor } from "./pages/AuthPages.jsx";
const NotificationsPage = named(() => import("./pages/SharedPages.jsx"), "NotificationsPage");
const AnnouncementsPage = named(() => import("./pages/SharedPages.jsx"), "AnnouncementsPage");
const ProfilePage = named(() => import("./pages/SharedPages.jsx"), "ProfilePage");
const StudentDashboard = named(() => import("./pages/StudentPages.jsx"), "StudentDashboard");
const StudentClasses = named(() => import("./pages/StudentPages.jsx"), "StudentClasses");
const StudentMaterials = named(() => import("./pages/StudentPages.jsx"), "StudentMaterials");
const StudentProgress = named(() => import("./pages/StudentPages.jsx"), "StudentProgress");
const StudentAttendance = named(() => import("./pages/AttendancePages.jsx"), "StudentAttendance");
const TeacherAttendance = named(() => import("./pages/AttendancePages.jsx"), "TeacherAttendance");
const AdminAttendance = named(() => import("./pages/AttendancePages.jsx"), "AdminAttendance");
const TeacherDashboard = named(() => import("./pages/TeacherPages.jsx"), "TeacherDashboard");
const TeacherCalendar = named(() => import("./pages/TeacherPages.jsx"), "TeacherCalendar");
const TeacherStudents = named(() => import("./pages/TeacherPages.jsx"), "TeacherStudents");
const TeacherStudentDetail = named(() => import("./pages/TeacherPages.jsx"), "TeacherStudentDetail");
const TeacherMaterials = named(() => import("./pages/TeacherPages.jsx"), "TeacherMaterials");
const TeacherRequests = named(() => import("./pages/TeacherPages.jsx"), "TeacherRequests");
const AdminDashboard = named(() => import("./pages/admin/AdminDashboard.jsx"), "AdminDashboard");
const AdminAlerts = named(() => import("./pages/admin/AdminDashboard.jsx"), "AdminAlerts");
const AdminUsersPage = named(() => import("./pages/admin/AdminUsers.jsx"), "AdminUsersPage");
const AdminUserDetail = named(() => import("./pages/admin/AdminUsers.jsx"), "AdminUserDetail");
const AdminAdminsPage = named(() => import("./pages/admin/AdminUsers.jsx"), "AdminAdminsPage");
const AdminClasses = named(() => import("./pages/admin/AdminClasses.jsx"), "AdminClasses");
const AdminRequests = named(() => import("./pages/admin/AdminClasses.jsx"), "AdminRequests");
const AdminMaterials = named(() => import("./pages/admin/AdminContent.jsx"), "AdminMaterials");
const AdminAnnouncements = named(() => import("./pages/admin/AdminComms.jsx"), "AdminAnnouncements");
const AdminNotifications = named(() => import("./pages/admin/AdminComms.jsx"), "AdminNotifications");
const AdminReports = named(() => import("./pages/admin/AdminSystem.jsx"), "AdminReports");
const AdminSettings = named(() => import("./pages/admin/AdminSystem.jsx"), "AdminSettings");
const AdminBackups = named(() => import("./pages/admin/AdminSystem.jsx"), "AdminBackups");
const AdminRecordings = named(() => import("./pages/admin/AdminRecordings.jsx"), "AdminRecordings");
const StudentRecordings = named(() => import("./pages/StudentRecordings.jsx"), "StudentRecordings");
const MessagesPage = named(() => import("./pages/MessagesPage.jsx"), "MessagesPage");
const AdminMessagesPage = named(() => import("./pages/MessagesPage.jsx"), "AdminMessagesPage");
const StudentFees = named(() => import("./pages/FeePages.jsx"), "StudentFees");
const AdminSessions = named(() => import("./pages/FeePages.jsx"), "AdminSessions");
const AdminFees = named(() => import("./pages/FeePages.jsx"), "AdminFees");
const AdminSubjects = named(() => import("./pages/admin/AdminSubjects.jsx"), "AdminSubjects");
const SessionRegister = named(() => import("./pages/RegisterPages.jsx"), "SessionRegister");
const TeacherSessions = named(() => import("./pages/RegisterPages.jsx"), "TeacherSessions");
const AdminTeacherPayments = named(() => import("./pages/TeacherPaymentPages.jsx"), "AdminTeacherPayments");
const TeacherPayments = named(() => import("./pages/TeacherPaymentPages.jsx"), "TeacherPayments");
const AdminDemos = named(() => import("./pages/DemoPages.jsx"), "AdminDemos");
const GuestDone = named(() => import("./pages/DemoPages.jsx"), "GuestDone");
const GuestJoin = named(() => import("./pages/DemoPages.jsx"), "GuestJoin");
const TeacherDemos = named(() => import("./pages/DemoPages.jsx"), "TeacherDemos");
const AdminTimetable = named(() => import("./pages/TimetablePages.jsx"), "AdminTimetable");
const TeacherTimetable = named(() => import("./pages/TimetablePages.jsx"), "TeacherTimetable");
const StudentTimetable = named(() => import("./pages/TimetablePages.jsx"), "StudentTimetable");

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
        <Suspense fallback={<Loading className="min-h-svh" />}>
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
        </Suspense>
      </UiProvider>
    </AuthProvider>
  );
}
