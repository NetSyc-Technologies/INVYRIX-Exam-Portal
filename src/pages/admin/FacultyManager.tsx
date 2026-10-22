import { api } from '../../services/platform';
import { useState, useEffect } from 'react';
import { getDocs, query, where } from 'firebase/firestore';
import { collection } from '../../services/tenant';
import { db } from '../../services/firebase';
import { AdminUser } from '../../types';

export default function FacultyManager() {
    const [faculty, setFaculty] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newFaculty, setNewFaculty] = useState({ name: '', email: '' });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [editingFaculty, setEditingFaculty] = useState<AdminUser | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);

    const fetchFaculty = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'admin_users'), where('role', '==', 'faculty'));
            const snapshot = await getDocs(q);
            setFaculty(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdminUser)));
        } catch (err) {
            console.error('Error fetching faculty:', err);
            setError('Failed to load faculty list');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFaculty();
    }, []);

    const handleAddFaculty = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!newFaculty.name.trim() || !newFaculty.email.trim()) {
            setError('Name and Email are required');
            return;
        }

        try {
            // Check if email already exists
            const checkQuery = query(collection(db, 'admin_users'), where('email', '==', newFaculty.email));
            const checkSnapshot = await getDocs(checkQuery);
            if (!checkSnapshot.empty) {
                setError('A user with this email already exists');
                return;
            }

            // Create new faculty user
            const newUser: Omit<AdminUser, 'id'> = {
                name: newFaculty.name,
                email: newFaculty.email,
                role: 'faculty',
                permissions: ['monitor_exam', 'view_results', 'grade_exam'], // Default permissions
                createdAt: new Date(),
            };

            await api('manageFaculty', { action: 'save', name: newUser.name, email: newUser.email.trim().toLowerCase() });

            setSuccess('Faculty added successfully');
            setNewFaculty({ name: '', email: '' });
            setShowAddModal(false);
            fetchFaculty();
        } catch (err) {
            console.error('Error adding faculty:', err);
            setError('Failed to add faculty');
        }
    };

    const handleUpdateFaculty = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!editingFaculty || !editingFaculty.name.trim() || !editingFaculty.email.trim()) {
            setError('Name and Email are required');
            return;
        }

        try {
            // Check if email already exists on a different document
            const checkQuery = query(
                collection(db, 'admin_users'),
                where('email', '==', editingFaculty.email)
            );
            const checkSnapshot = await getDocs(checkQuery);
            const duplicate = checkSnapshot.docs.find(doc => doc.id !== editingFaculty.id);
            if (duplicate) {
                setError('A user with this email already exists');
                return;
            }

            // Update faculty details in firebase
            await api('manageFaculty', { action: 'save', previousEmail: editingFaculty.id, email: editingFaculty.email.trim().toLowerCase(), name: editingFaculty.name });

            setSuccess('Faculty updated successfully');
            setEditingFaculty(null);
            setShowEditModal(false);
            fetchFaculty();
        } catch (err) {
            console.error('Error updating faculty:', err);
            setError('Failed to update faculty');
        }
    };

    const handleRemoveFaculty = async (id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to remove access for ${name}?`)) return;

        try {
            await api('manageFaculty', { action: 'remove', email: id });
            setSuccess('Faculty removed successfully');
            fetchFaculty();
        } catch (err) {
            console.error('Error removing faculty:', err);
            setError('Failed to remove faculty');
        }
    };

    return (
        <div>
            <div className="page-header flex justify-between items-center">
                <div>
                    <h1 className="page-title">Faculty Management</h1>
                    <p className="page-subtitle">Manage faculty access to the platform</p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setShowAddModal(true)}
                >
                    <span>➕</span>
                    <span>Add Faculty</span>
                </button>
            </div>

            {error && (
                <div className="alert alert-error mb-lg">
                    <span>⚠️</span>
                    <span>{error}</span>
                </div>
            )}

            {success && (
                <div className="alert alert-success mb-lg">
                    <span>✅</span>
                    <span>{success}</span>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center p-xl">
                    <div className="spinner"></div>
                </div>
            ) : faculty.length > 0 ? (
                <div className="card">
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Email</th>
                                    <th>Joined</th>
                                    <th>Last Login</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {faculty.map(user => (
                                    <tr key={user.id}>
                                        <td className="font-medium">{user.name}</td>
                                        <td>{user.email}</td>
                                        <td className="text-secondary text-sm">
                                            {user.createdAt ? new Date(user.createdAt as any).toLocaleDateString() : 'N/A'}
                                        </td>
                                        <td className="text-secondary text-sm">
                                            {user.lastLogin ? new Date(user.lastLogin as any).toLocaleDateString() : 'Never'}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    className="btn btn-warning btn-sm"
                                                    onClick={() => {
                                                        setEditingFaculty(user);
                                                        setShowEditModal(true);
                                                    }}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    className="btn btn-danger btn-sm"
                                                    onClick={() => handleRemoveFaculty(user.id, user.name)}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="card p-xl text-center">
                    <div className="text-4xl mb-md">👨‍🏫</div>
                    <h3 className="text-lg font-medium mb-sm">No Faculty Found</h3>
                    <p className="text-secondary mb-lg">Add faculty members to assign them exams.</p>
                </div>
            )}

            {/* Add Faculty Modal */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Add New Faculty</h3>
                            <button className="modal-close" onClick={() => setShowAddModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleAddFaculty}>
                            <div className="modal-body">
                                <div className="input-group mb-lg">
                                    <label className="input-label required">Full Name</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={newFaculty.name}
                                        onChange={e => setNewFaculty(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="e.g. Dr. John Doe"
                                        required
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label required">Email Address</label>
                                    <input
                                        type="email"
                                        className="input"
                                        value={newFaculty.email}
                                        onChange={e => setNewFaculty(prev => ({ ...prev, email: e.target.value }))}
                                        placeholder="e.g. john.doe@example.com"
                                        required
                                    />
                                    <p className="text-xs text-muted mt-xs">
                                        This email must match their Google account email.
                                    </p>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Add Faculty</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Faculty Modal */}
            {showEditModal && editingFaculty && (
                <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Faculty Details</h3>
                            <button className="modal-close" onClick={() => setShowEditModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleUpdateFaculty}>
                            <div className="modal-body">
                                <div className="input-group mb-lg">
                                    <label className="input-label required">Full Name</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={editingFaculty.name}
                                        onChange={e => setEditingFaculty(prev => prev ? { ...prev, name: e.target.value } : null)}
                                        placeholder="e.g. Dr. John Doe"
                                        required
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label required">Email Address</label>
                                    <input
                                        type="email"
                                        className="input"
                                        value={editingFaculty.email}
                                        onChange={e => setEditingFaculty(prev => prev ? { ...prev, email: e.target.value } : null)}
                                        placeholder="e.g. john.doe@example.com"
                                        required
                                    />
                                    <p className="text-xs text-muted mt-xs">
                                        This email must match their Google account email.
                                    </p>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowEditModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
