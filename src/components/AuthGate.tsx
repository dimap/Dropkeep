import { ArrowRight, Eye, EyeOff, Folder, Pause, Play } from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, setAuthToken } from '../api';
import { DropkeepLogo } from './DropkeepLogo';
import './AuthGate.css';

const backgroundFolders = [
  { x: 12, y: 23, size: 94, angle: -19, color: 'blue', duration: 16, delay: -3 },
  { x: 80, y: 21, size: 76, angle: 15, color: 'violet', duration: 19, delay: -8 },
  { x: 17, y: 78, size: 76, angle: 15, color: 'mint', duration: 18, delay: -5 },
  { x: 78, y: 82, size: 100, angle: -18, color: 'blue', duration: 20, delay: -11 },
  { x: 43, y: 14, size: 43, angle: 23, color: 'amber', duration: 17, delay: -7 },
  { x: 43, y: 91, size: 57, angle: 17, color: 'pink', duration: 19, delay: -13 },
  { x: 26, y: 40, size: 48, angle: 12, color: 'pink', duration: 17, delay: -2 },
  { x: 94, y: 44, size: 104, angle: -16, color: 'mint', duration: 21, delay: -9 },
  { x: 68, y: 10, size: 59, angle: -24, color: 'mint', duration: 18, delay: -11 },
  { x: 8, y: 57, size: 43, angle: -12, color: 'violet', duration: 16, delay: -6 },
  { x: 73, y: 55, size: 53, angle: 23, color: 'amber', duration: 20, delay: -8 },
  { x: 26, y: 94, size: 44, angle: -26, color: 'blue', duration: 16, delay: -1 },
  { x: 93, y: 68, size: 39, angle: 17, color: 'pink', duration: 18, delay: -6 },
];

interface AuthGateProps {
  onAuthenticated: () => void;
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backgroundPaused, setBackgroundPaused] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading || !password) return;
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

  const PasswordIcon = passwordVisible ? EyeOff : Eye;
  const MotionIcon = backgroundPaused ? Play : Pause;
  const passwordAction = passwordVisible ? 'Скрыть пароль' : 'Показать пароль';
  const motionAction = backgroundPaused ? 'Возобновить анимацию фона' : 'Приостановить анимацию фона';

  return (
    <main className="auth-screen relative isolate grid min-h-dvh grid-cols-1 place-items-center px-4 pt-24 pb-20 sm:px-6">
      <div className="auth-folders pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true" data-paused={backgroundPaused}>
        {backgroundFolders.map(({ x, y, size, angle, color, duration, delay }) => (
          <Folder
            key={`${x}-${y}`}
            className="auth-folder"
            data-color={color}
            size={size}
            strokeWidth={1.25}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              '--folder-size': `${size}px`,
              '--folder-angle': `${angle}deg`,
              animationDuration: `${duration}s`,
              animationDelay: `${delay}s`,
            } as CSSProperties}
          />
        ))}
      </div>

      <div className="absolute start-4 top-5 flex items-center gap-2 text-xl font-bold tracking-tight text-[#15243B] sm:start-7 dark:text-[#F3F6FC]">
        <DropkeepLogo className="size-8 shrink-0" />
        <span>Dropkeep</span>
      </div>

      <form
        onSubmit={handleSubmit}
        aria-labelledby="auth-title"
        aria-busy={loading}
        className="auth-card grid w-full max-w-[378px] grid-cols-1 gap-5 rounded-[17px] border border-[#DCE6F6] bg-white p-6 text-[#15243B] sm:p-9 dark:border-[#465570] dark:bg-[#191F2A] dark:text-[#F3F6FC]"
      >
        <div className="grid gap-2">
          <h1 id="auth-title" className="text-[clamp(1.75rem,5vw,2.25rem)] leading-tight font-bold tracking-[-0.045em] text-balance">
            Вход в Dropkeep
          </h1>
          <p className="text-sm text-[#50617B] dark:text-[#B2BDD2]">Введите мастер-пароль сервера.</p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <label htmlFor="auth-password" className="text-sm font-semibold">Мастер-пароль</label>
          <div className="flex min-h-12 items-center rounded-[10px] border border-[#CCD6E6] bg-[#F8FAFF] pe-0.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#0566E5] dark:border-[#53627E] dark:bg-[#121925] dark:focus-within:outline-[#74ADFF]">
            <input
              id="auth-password"
              name="password"
              type={passwordVisible ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="Введите пароль"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'auth-password-error' : undefined}
              readOnly={loading}
              required
              autoFocus
              className="min-w-0 grow bg-transparent py-2.5 ps-3 text-base outline-none placeholder:text-[#50617B] dark:placeholder:text-[#B2BDD2]"
            />
            <button
              type="button"
              aria-label={passwordAction}
              title={passwordAction}
              onClick={() => setPasswordVisible((visible) => !visible)}
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg text-[#50617B] hover:bg-[#EAF1FC] hover:text-[#15243B] focus-visible:outline-2 focus-visible:outline-[#0566E5] dark:text-[#B2BDD2] dark:hover:bg-[#23314A] dark:hover:text-white dark:focus-visible:outline-[#74ADFF]"
            >
              <PasswordIcon className="size-[18px]" aria-hidden="true" />
            </button>
          </div>

          {error && (
            <p id="auth-password-error" role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !password}
          className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#0566E5] px-4 py-2.5 text-sm font-semibold text-white enabled:hover:bg-[#0459C9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0566E5] disabled:cursor-not-allowed disabled:opacity-65 motion-safe:transition-colors dark:focus-visible:outline-[#74ADFF]"
        >
          {loading ? 'Проверка…' : 'Войти'}
          {!loading && <ArrowRight className="size-4" aria-hidden="true" />}
        </button>
      </form>

      <button
        type="button"
        aria-label={motionAction}
        title={motionAction}
        onClick={() => setBackgroundPaused((paused) => !paused)}
        className="absolute end-4 bottom-4 grid size-11 cursor-pointer place-items-center rounded-full border border-[#BBCBE1] bg-white/80 text-[#50617B] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0566E5] motion-reduce:hidden sm:end-7 sm:bottom-6 dark:border-[#53627E] dark:bg-[#191F2A] dark:text-[#B2BDD2] dark:hover:bg-[#23314A] dark:focus-visible:outline-[#74ADFF]"
      >
        <MotionIcon className="size-4" aria-hidden="true" />
      </button>
    </main>
  );
}
