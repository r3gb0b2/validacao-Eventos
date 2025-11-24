import React, { useState } from 'react';
import { LockClosedIcon, XCircleIcon } from './Icons';

interface LoginModalProps {
    onLogin: (user: string, pass: string) => Promise<void>;
    onCancel: () => void;
    isLoading: boolean;
}

const LoginModal: React.FC<LoginModalProps> = ({ onLogin, onCancel, isLoading }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onLogin(username, password);
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm bg-gray-800 rounded-lg shadow-2xl border border-gray-700 p-8 relative">
                <button 
                    onClick={onCancel} 
                    className="absolute top-3 right-3 text-gray-500 hover:text-white"
                >
                    <XCircleIcon className="w-6 h-6" />
                </button>

                <div className="text-center mb-6">
                    <div className="bg-orange-600/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <LockClosedIcon className="w-8 h-8 text-orange-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-white">Acesso Administrativo</h2>
                    <p className="text-gray-400 text-sm">Entre com suas credenciais</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Usuário</label>
                        <input 
                            type="text" 
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Senha</label>
                        <input 
                            type="password" 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                        />
                    </div>

                    <button 
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-lg shadow-lg mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Verificando...' : 'Entrar'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default LoginModal;