import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api, setAuthToken } from '../api';

interface AuthGateProps {
  onAuthenticated: () => void;
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.login(password);
      setAuthToken(res.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неверный пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F6F7F9] dark:bg-[#1A1B1E] p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[360px] rounded-xl bg-white dark:bg-[#222429] border border-[#E6E8EC] dark:border-[#34373E] p-6 space-y-4"
      >
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-[#0B72E7] flex items-center justify-center text-white">
            <Lock className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-[16px] font-bold text-[#181A1F] dark:text-[#F1F3F5]">Dropkeep</h1>
            <p className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3]">
              Введите мастер-пароль сервера
            </p>
          </div>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Мастер-пароль"
          autoFocus
          className="w-full h-10 px-3 rounded-lg text-[14px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
        />

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full h-10 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-50 text-white text-[13.5px] font-medium transition-colors"
        >
          {loading ? 'Проверка...' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
