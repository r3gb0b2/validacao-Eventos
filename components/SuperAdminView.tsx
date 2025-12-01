
import React, { useState, useEffect } from 'react';
import { Firestore, collection, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { User, Event } from '../types';
import { UsersIcon, PlusCircleIcon, TrashIcon } from './Icons';

interface SuperAdminViewProps {
    db: Firestore;
    events: Event[];
    onClose: () => void;
}

const SuperAdminView: React.FC<SuperAdminViewProps> = ({ db, events, onClose }) => {
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // Create User Form
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [selectedEventsForNewUser, setSelectedEventsForNewUser] = useState<string[]>([]);

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        setIsLoading(true);
        try {
            const snap = await getDocs(collection(db, 'users'));
            const usersList = snap.docs.map(doc => {
                const data = doc.data();
                // Safety check: ensure arrays and strings exist to prevent white screen crashes
                return { 
                    id: doc.id, 
                    username: data.username || 'Usuário Desconhecido',
                    password: data.password || '',
                    role: data.role || 'ADMIN',
                    allowedEvents: Array.isArray(data.allowedEvents) ? data.allowedEvents : []
                } as User;
            });
            setUsers(usersList);
        } catch (e) {
            console.error("Failed to load users", e);
            alert("Erro ao carregar lista de usuários.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateUser = async () => {
        if (!newUsername || !newPassword) return alert("Preencha usuário e senha.");
        
        // Check existing
        if (users.some(u => u.username === newUsername)) return alert("Usuário já existe.");

        setIsLoading(true);
        try {
            await addDoc(collection(db, 'users'), {
                username: newUsername,
                password: newPassword, // In a real app, hash this!
                role: 'ADMIN',
                allowedEvents: selectedEventsForNewUser
            });
            
            setNewUsername('');
            setNewPassword('');
            setSelectedEventsForNewUser([]);
            await loadUsers();
            alert("Usuário criado com sucesso!");
        } catch (e) {
            alert("Erro ao criar usuário.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteUser = async (userId: string, username: string) => {
        if (username === 'admin') return alert("Não é possível remover o Super Admin.");
        if (confirm(`Tem certeza que deseja remover o usuário "${username}"?`)) {
            try {
                await deleteDoc(doc(db, 'users', userId));
                await loadUsers();
            } catch (e) {
                alert("Erro ao remover.");
            }
        }
    };

    const handleUpdateUserEvents = async (userId: string, eventId: string, currentEvents: string[]) => {
        const safeCurrentEvents = Array.isArray(currentEvents) ? currentEvents : [];
        const newEvents = safeCurrentEvents.includes(eventId) 
            ? safeCurrentEvents.filter(id => id !== eventId)
            : [...safeCurrentEvents, eventId];
        
        try {
            // Optimistic update locally
            setUsers(users.map(u => u.id === userId ? { ...u, allowedEvents: newEvents } : u));
            
            await updateDoc(doc(db, 'users', userId), { allowedEvents: newEvents });
        } catch (e) {
            console.error("Fail to update perm", e);
            await loadUsers(); // Revert on fail
        }
    };

    const toggleEventForNewUser = (eventId: string) => {
        if (selectedEventsForNewUser.includes(eventId)) {
            setSelectedEventsForNewUser(selectedEventsForNewUser.filter(id => id !== eventId));
        } else {
            setSelectedEventsForNewUser([...selectedEventsForNewUser, eventId]);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center bg-gray-800 p-4 rounded-lg border-l-4 border-purple-500">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center">
                        <UsersIcon className="w-6 h-6 mr-2" />
                        Gestão de Usuários (Super Admin)
                    </h2>
                    <p className="text-gray-400 text-sm">Crie administradores e delegue eventos específicos.</p>
                </div>
                <button onClick={onClose} className="text-sm text-gray-400 hover:text-white underline">
                    Voltar ao Painel
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Create Form */}
                <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg">
                    <h3 className="font-bold text-lg mb-4 text-purple-400">Novo Administrador</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">Usuário</label>
                            <input 
                                type="text" 
                                value={newUsername} 
                                onChange={e => setNewUsername(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">Senha</label>
                            <input 
                                type="text" 
                                value={newPassword} 
                                onChange={e => setNewPassword(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 mb-2">Eventos Permitidos</label>
                            <div className="max-h-40 overflow-y-auto bg-gray-900 p-2 rounded border border-gray-600 space-y-1">
                                {events.map(ev => (
                                    <label key={ev.id} className="flex items-center p-1 hover:bg-gray-800 rounded cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedEventsForNewUser.includes(ev.id)}
                                            onChange={() => toggleEventForNewUser(ev.id)}
                                            className="mr-2 rounded text-purple-600 bg-gray-700 border-gray-500"
                                        />
                                        <span className="text-sm text-gray-300">{ev.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <button 
                            onClick={handleCreateUser}
                            disabled={isLoading}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 rounded flex justify-center items-center"
                        >
                            <PlusCircleIcon className="w-5 h-5 mr-2" />
                            Criar Usuário
                        </button>
                    </div>
                </div>

                {/* User List */}
                <div className="lg:col-span-2 space-y-4">
                    {users.map(user => {
                        const safeUsername = user.username || '???';
                        const safeRole = user.role || 'ADMIN';
                        const safeEvents = Array.isArray(user.allowedEvents) ? user.allowedEvents : [];

                        return (
                            <div key={user.id} className="bg-gray-800 p-4 rounded-lg border border-gray-700 flex flex-col md:flex-row gap-4">
                                <div className="flex-shrink-0 min-w-[150px]">
                                    <div className="flex items-center">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white mr-3 ${safeRole === 'SUPER_ADMIN' ? 'bg-orange-600' : 'bg-blue-600'}`}>
                                            {safeUsername.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-bold text-white">{safeUsername}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded font-bold ${safeRole === 'SUPER_ADMIN' ? 'bg-orange-900 text-orange-300' : 'bg-blue-900 text-blue-300'}`}>
                                                {safeRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                                            </span>
                                        </div>
                                    </div>
                                    {safeRole !== 'SUPER_ADMIN' && (
                                        <button 
                                            onClick={() => handleDeleteUser(user.id, safeUsername)}
                                            className="mt-3 text-xs text-red-400 hover:text-red-300 flex items-center"
                                        >
                                            <TrashIcon className="w-3 h-3 mr-1" /> Remover Usuário
                                        </button>
                                    )}
                                </div>

                                <div className="flex-grow bg-gray-900/50 p-3 rounded border border-gray-700/50">
                                    <p className="text-xs text-gray-500 font-bold uppercase mb-2">Acesso aos Eventos:</p>
                                    {safeRole === 'SUPER_ADMIN' ? (
                                        <p className="text-sm text-green-400 italic">Acesso Total (Todos os eventos)</p>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {events.map(ev => {
                                                const hasAccess = safeEvents.includes(ev.id);
                                                return (
                                                    <button 
                                                        key={ev.id}
                                                        onClick={() => handleUpdateUserEvents(user.id, ev.id, safeEvents)}
                                                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                                                            hasAccess 
                                                            ? 'bg-green-900/30 border-green-600 text-green-300 hover:bg-red-900/30 hover:border-red-600 hover:text-red-300' 
                                                            : 'bg-gray-800 border-gray-600 text-gray-500 hover:bg-green-900/30 hover:border-green-600 hover:text-green-300'
                                                        }`}
                                                        title={hasAccess ? "Clique para remover acesso" : "Clique para dar acesso"}
                                                    >
                                                        {ev.name}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default SuperAdminView;
    