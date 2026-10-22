import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { InstituteProvider } from './context/InstituteContext';
import { tenantId, tenantBase } from './services/tenant';
import InstituteGate from './components/InstituteGate';
const InstituteSettings = lazy(() => import('./pages/admin/InstituteSettings'));
const Landing = lazy(() => import('./pages/platform/Landing'));
const Register = lazy(() => import('./pages/platform/Register'));
const Account = lazy(() => import('./pages/platform/Account'));
const SuperAdmin = lazy(() => import('./pages/platform/SuperAdmin'));
const Terms = lazy(() => import('./pages/platform/Terms'));
const Download = lazy(() => import('./pages/platform/Download'));
import './platform.css';

// Student Pages
const ExamEntry = lazy(() => import('./pages/student/ExamEntry'));
const PreExamCheck = lazy(() => import('./pages/student/PreExamCheck'));
const ExamInterface = lazy(() => import('./pages/student/ExamInterface'));
const ExamTerminated = lazy(() => import('./pages/student/ExamTerminated'));
const ExamResults = lazy(() => import('./pages/student/ExamResults'));
const StudentResults = lazy(() => import('./pages/student/StudentResults'));

// Admin Pages
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const ExamManager = lazy(() => import('./pages/admin/ExamManager'));
const ExamCreate = lazy(() => import('./pages/admin/ExamCreate'));
const ExamEdit = lazy(() => import('./pages/admin/ExamEdit'));
const LiveMonitor = lazy(() => import('./pages/admin/LiveMonitor'));
const Analytics = lazy(() => import('./pages/admin/Analytics'));
const BlockedStudents = lazy(() => import('./pages/admin/BlockedStudents'));
const SessionManager = lazy(() => import('./pages/admin/SessionManager'));
const SessionDetails = lazy(() => import('./pages/admin/SessionDetails'));
const FacultyManager = lazy(() => import('./pages/admin/FacultyManager'));
const AdminResult = lazy(() => import('./pages/admin/AdminResult'));

// Components
import ProtectedRoute from './components/ProtectedRoute';

function App() {
    return (
        <InstituteProvider><AuthProvider>
            <BrowserRouter basename={tenantBase || "/"}><Suspense fallback={<div className="platform-gate"><div className="spinner" /><p>Loading INVYRIX…</p></div>}>
                {tenantId ? <InstituteGate>
                <Routes>
                    {/* Student Routes */}
                    <Route path="/" element={<ExamEntry />} />
                    <Route path="/exam/verify" element={<PreExamCheck />} />
                    <Route path="/exam/:sessionId" element={<ExamInterface />} />
                    <Route path="/exam/terminated" element={<ExamTerminated />} />
                    <Route path="/exam/results/:sessionId" element={<ExamResults />} />
                    <Route path="/results" element={<StudentResults />} />

                    {/* Admin Routes */}
                    <Route path="/admin" element={<AdminLogin />} />
                    <Route
                        path="/admin/dashboard"
                        element={
                            <ProtectedRoute>
                                <AdminLayout />
                            </ProtectedRoute>
                        }
                    >
                        <Route index element={<Dashboard />} />
                        <Route path="subscription" element={<InstituteSettings />} />
                        <Route path="exams" element={<ExamManager />} />
                        <Route path="exams/create" element={<ProtectedRoute adminOnly><ExamCreate /></ProtectedRoute>} />
                        <Route path="exams/edit/:examId" element={<ProtectedRoute adminOnly><ExamEdit /></ProtectedRoute>} />
                        <Route path="monitor" element={<LiveMonitor />} />
                        <Route path="analytics" element={<Analytics />} />
                        <Route path="blocked" element={<ProtectedRoute adminOnly><BlockedStudents /></ProtectedRoute>} />
                        <Route path="sessions" element={<SessionManager />} />
                        <Route path="sessions/:sessionId" element={<SessionDetails />} />
                        <Route path="faculty" element={<ProtectedRoute adminOnly><FacultyManager /></ProtectedRoute>} />
                        <Route path="results" element={<AdminResult />} />
                    </Route>

                    {/* Fallback */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes></InstituteGate> : <Routes><Route path="/" element={<Landing />} /><Route path="/register" element={<Register />} /><Route path="/admin/*" element={<Account />} /><Route path="/superadmin" element={<SuperAdmin />} /><Route path="/terms" element={<Terms />} /><Route path="/download" element={<Download />} /><Route path="/desktop" element={<Download setup />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>}
            </Suspense></BrowserRouter>
        </AuthProvider></InstituteProvider>
    );
}

export default App;

