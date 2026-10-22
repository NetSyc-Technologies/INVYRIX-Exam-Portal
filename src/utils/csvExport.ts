import { getSessionDocs } from '../services/staffData';
import { Exam, ExamSession } from '../types';

export const exportExamResultsToCSV = async (exam: Exam) => {
    try {
        // 1. Fetch all sessions for this exam
        const snapshot = await getSessionDocs();
        const sessions = snapshot.docs.map(doc => doc.data() as ExamSession).filter(session => session.examId === exam.id);

        if (sessions.length === 0) {
            alert('No results found for this exam.');
            return;
        }

        // 2. Prepare CSV Header
        const headers = [
            'Student Name',
            'Roll Number',
            'Department',
            'Year',
            'Exam Name',
            'Date Taken',
            'Status',
            'Score',
            'Total Points',
            'Percentage',
            'Cheating Alerts'
        ];

        // 3. Transform Data
        const csvRows = sessions.map(session => {
            const studentName = session.studentName || 'Unknown';
            // Fix: property is studentRollNo, not rollNumber
            const rollNumber = session.studentRollNo || 'N/A';
            const department = session.department || 'N/A';
            const year = session.year || 'N/A';
            const examName = exam.examName || 'Exam';

            // Handle Timestamp or Date safely
            let dateTaken = 'N/A';
            if (session.startTime) {
                // Check if it's a Firestore Timestamp (has seconds property)
                if (typeof session.startTime === 'object' && 'seconds' in session.startTime) {
                    // @ts-ignore
                    dateTaken = new Date(session.startTime.seconds * 1000).toLocaleDateString();
                } else if (session.startTime instanceof Date) {
                    dateTaken = session.startTime.toLocaleDateString();
                }
            }

            const status = session.status || 'Unknown';
            const score = session.score !== undefined ? session.score : 'Pending';

            // Calculate total points from exam questions, not session
            const totalPoints = exam.questions ? exam.questions.reduce((sum, q) => sum + (q.points || 0), 0) : 0;

            let percentage = '0%';
            if (typeof score === 'number' && totalPoints > 0) {
                percentage = ((score / totalPoints) * 100).toFixed(2) + '%';
            }

            const cheatingAlerts = session.cheatingEvents ? session.cheatingEvents.length : 0;

            // Escape fields containing commas
            const escape = (str: string | number) => `"${String(str).replace(/^[=+@\-\t\r]/, character => "'" + character).replace(/"/g, '""')}"`;

            return [
                escape(studentName),
                escape(rollNumber),
                escape(department),
                escape(year),
                escape(examName),
                escape(dateTaken),
                escape(status),
                escape(score),
                escape(totalPoints),
                escape(percentage),
                escape(cheatingAlerts)
            ].join(',');
        });

        // 4. Combine Header and Rows
        const csvContent = [headers.join(','), ...csvRows].join('\n');

        // 5. Trigger Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${exam.examName.replace(/[^a-z0-9]/gi, '_')}_results.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.error('Error exporting CSV:', error);
        alert('Failed to export results. Please try again.');
    }
};
