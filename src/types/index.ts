// Exam Types
export interface Exam {
    id: string;
    examName: string;
    examPassword?: string;
    examPasswordHash?: string;
    duration: number; // in minutes
    startTime: Date;
    endTime: Date;
    status: 'draft' | 'active' | 'completed' | 'cancelled';
    questions: Question[];
    questionCount?: number;
    createdBy: string;
    createdAt: Date;
    settings: ExamSettings;
    assignedFaculty?: string[];
    allowedStudents?: { rollNo: string; name: string }[];
}

export interface ExamSettings {
    allowReview: boolean;
    showResults: boolean;
    maxAttempts: number;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    requireRollNo?: boolean;
    requireName?: boolean;
    requirePhone?: boolean;
    requireEmail?: boolean;
    maxWarnings?: number;
    geofence?: GeofenceConfig;
    schedulingEnabled?: boolean;
    scheduledStartTime?: any;
    scheduledEndTime?: any;
    deviceRestriction?: 'mobile_only' | 'desktop_only' | 'both';
    lateEntryPolicy?: 'allow' | 'disallow';
    cameraAntiCheat?: boolean;
}

export type GeofenceConfig = 
    | { type: 'polygon'; points: { lat: number; lng: number }[] }
    | { type: 'circle'; center: { lat: number; lng: number }; radius: number };

export interface Question {
    id: string;
    text: string;
    type: 'mcq' | 'true_false' | 'short_answer';
    options: string[];
    correctAnswer?: string | number;
    answerKeyHash?: string;
    points: number;
    mediaUrl?: string;
}

// Session Types
export interface ExamSession {
    id: string;
    examId: string;
    studentRollNo: string;
    studentName: string;
    studentPhone?: string;
    studentEmail?: string;
    department?: string;
    year?: string;
    startTime: Date;
    endTime?: Date;
    status: 'started' | 'completed' | 'terminated' | 'cancelled';
    score?: number;
    answers: Answer[];
    cheatingEvents: CheatingEvent[];
    tabSwitchCount: number;
    warningCount: number;
    deviceInfo: DeviceInfo;
    ipAddress?: string;
    startLocation?: GeoLocation;
    endLocation?: GeoLocation;
    createdAt?: any;
    terminationReason?: string;
}

export interface Answer {
    questionId: string;
    answer: string | number;
    answeredAt: Date;
    score?: number;
}

export interface CheatingEvent {
    type: 'tab_switch' | 'keyboard_shortcut' | 'context_menu' | 'devtools' | 'fullscreen_exit' | 'copy_paste' | 'split_screen';
    timestamp: Date;
    details: string;
    severity: 'low' | 'medium' | 'high';
}

export interface GeoLocation {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: Date;
}

export interface DeviceInfo {
    userAgent: string;
    platform: string;
    screenWidth: number;
    screenHeight: number;
    deviceName?: string;
    browser?: string;
    os?: string;
}



// Admin Types
export interface AdminUser {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'faculty' | 'superadmin';
    permissions: string[];
    createdAt: Date;
    lastLogin?: Date;
}

// Blocked Student Types
export interface BlockedStudent {
    rollNo: string;
    examId: string;
    reason: string;
    blockedAt: Date;
    blockedBy: string;
    isUnblocked: boolean;
    unblockedAt?: Date;
    unblockedBy?: string;
}

// Stats Types
export interface DashboardStats {
    totalExams: number;
    activeExams: number;
    totalSessions: number;
    activeSessions: number;
    cheatingAlerts: number;
    terminatedSessions: number;
}
