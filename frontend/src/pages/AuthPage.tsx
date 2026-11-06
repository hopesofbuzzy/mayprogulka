import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../features/auth/AuthProvider';
import { authenticate, AuthError, CancelledAuthError, validateAuth } from '../features/auth/api';
import type { AuthFields, AuthMode, FieldErrors, FieldName } from '../features/auth/api';
import { authReturnState, returnToFromState } from '../features/auth/redirect';
import { WalkingScene } from '../shared/assets/WalkingScene';
import styles from './AuthPage.module.css';

const emptyFields: AuthFields = { username: '', email: '', password: '', confirmation: '' };
const labels: Record<FieldName, string> = { username: 'Имя пользователя', email: 'Email', password: 'Пароль', confirmation: 'Повторите пароль' };

function AuthPage({ mode }: { mode: AuthMode }) {
  const { isAuthenticated, session } = useAuth();
  const location = useLocation();
  const returnTo = returnToFromState(location.state, session?.role);
  const [values, setValues] = useState<AuthFields>(emptyFields);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const id = useId();
  const signup = mode === 'signup';
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (message) errorSummary.current?.focus(); }, [message]);

  if (isAuthenticated) return <Navigate to={returnTo} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const validation = validateAuth(mode, values);
    setErrors(validation);
    setMessage('');
    const firstInvalid = Object.keys(validation)[0];
    if (firstInvalid) { document.getElementById(`${id}-${firstInvalid}`)?.focus(); return; }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    request.current = controller;
    try { await authenticate(mode, values, controller.signal); }
    catch (error) {
      if (!(error instanceof CancelledAuthError) && !controller.signal.aborted) {
        const failure = error instanceof AuthError ? error : new AuthError('Не удалось выполнить запрос. Попробуйте ещё раз.');
        setErrors(failure.fields);
        setMessage(failure.message);
      }
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  const names: FieldName[] = signup ? ['username', 'email', 'password', 'confirmation'] : ['username', 'password'];
  return (
    <section className={`container ${styles.page}`} aria-labelledby={`${id}-title`}>
      <div className={styles.frame}>
        <aside className={styles.aside} aria-hidden="true">
          <p className={styles.eyebrow}>Традиция Екатеринбурга</p>
          <h2>У каждого<br />свой путь.</h2>
          <p>Город, лесные тропы<br />и новые впечатления.</p>
          <div className={styles.scene}><WalkingScene /></div>
        </aside>
        <div className={styles.panel}>
          <nav className={styles.tabs} aria-label="Доступ к аккаунту">
            <Link to="/login" state={authReturnState(location.state)} aria-current={!signup ? 'page' : undefined}>Вход</Link>
            <Link to="/signup" state={authReturnState(location.state)} aria-current={signup ? 'page' : undefined}>Регистрация</Link>
          </nav>
          <h1 id={`${id}-title`}>{signup ? 'Создать аккаунт' : 'Вход'}</h1>
          <p className={styles.intro}>{signup ? 'Ваш первый шаг к личному кабинету.' : 'Войдите, чтобы открыть личный кабинет.'}</p>
          <form onSubmit={(event) => { void submit(event); }} noValidate aria-busy={pending}>
            {message && <div ref={errorSummary} tabIndex={-1} role="alert" className={styles.errorSummary}>{message}</div>}
            <fieldset className={styles.fields} disabled={pending}>
              <legend className={styles.srOnly}>{signup ? 'Данные нового аккаунта' : 'Данные для входа'}</legend>
              {names.map((name) => {
                const password = name === 'password' || name === 'confirmation';
                const hint = signup && name === 'password';
                return (
                  <div className={styles.field} key={name}>
                    <label htmlFor={`${id}-${name}`}>{labels[name]}</label>
                    <input id={`${id}-${name}`} name={name} type={password ? 'password' : name === 'email' ? 'email' : 'text'}
                      autoComplete={password ? signup ? 'new-password' : 'current-password' : name}
                      autoCapitalize={password || name === 'username' ? 'none' : undefined} spellCheck={false}
                      required value={values[name]} onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                      aria-invalid={Boolean(errors[name])} aria-describedby={[errors[name] ? `${id}-${name}-error` : '', hint ? `${id}-password-hint` : ''].filter(Boolean).join(' ') || undefined} />
                    {hint && <small id={`${id}-password-hint`}>От 6 до 72 символов.</small>}
                    {errors[name] && <p id={`${id}-${name}-error`} className={styles.fieldError}>{errors[name]}</p>}
                  </div>
                );
              })}
            </fieldset>
            <button type="submit" className={styles.submit} disabled={pending}>{pending ? signup ? 'Создаём аккаунт…' : 'Входим…' : signup ? 'Создать аккаунт' : 'Войти'}<span aria-hidden="true">↗</span></button>
            {pending && <p className={styles.progress} role="status">Ждём ответ сервера…</p>}
          </form>
          <p className={styles.sessionNote}>Сессия действует в этой вкладке до обновления страницы. После обновления потребуется войти снова.</p>
        </div>
      </div>
    </section>
  );
}

export function LoginPage() { return <AuthPage key="login" mode="login" />; }
export function SignupPage() { return <AuthPage key="signup" mode="signup" />; }
