import { useEffect, useState } from 'react';
import api from './api/axios.js';
import { getToken, removeToken, saveToken } from './api/tokenStorage.js';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import SchedulePage from './pages/SchedulePage.jsx';
import overangeLogo from './assets/overange-logo.png';

export default function App() {
  // User lives in memory; only the JWT is saved between page reloads.
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('login');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [retryNumber, setRetryNumber] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function restoreSession() {
      setCheckingSession(true);
      setSessionError('');
      try {
        if (getToken()) {
          const response = await api.get('/auth/me', { signal: controller.signal });
          if (!controller.signal.aborted) setUser(response.data);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error.response?.status === 401) {
          removeToken();
          setUser(null);
          setSuccessMessage('Your session is no longer valid. Please log in again.');
        } else {
          // A temporary server outage should not erase a valid saved token.
          setSessionError('Could not check your session. Please try again.');
        }
      } finally {
        if (!controller.signal.aborted) setCheckingSession(false);
      }
    }

    restoreSession();
    return () => controller.abort();
  }, [retryNumber]);

  function handleLogin({ token, user: currentUser }) {
    saveToken(token);
    setUser(currentUser);
    setSuccessMessage('');
  }

  function handleLogout() {
    removeToken();
    setUser(null);
    setSessionError('');
    setSuccessMessage('');
    setRegisteredEmail('');
    setPage('login');
  }

  function handleRegistered(email) {
    setRegisteredEmail(email);
    setSuccessMessage('Account created successfully. You can now log in.');
    setPage('login');
  }

  function handleSessionExpired() {
    handleLogout();
    setSuccessMessage('Your session is no longer valid. Please log in again.');
  }

  return (
    <div className={`page ${user ? 'schedule-layout' : 'auth-layout'}`}>
      <header className="site-header">
        <div className="brand">
          <img className="brand-image" src={overangeLogo} alt="OVERANGE" />
          <div className="brand-copy">
            <span className="brand-name">OVERANGE CASTING</span>
            <span className="brand-caption">CASTING SYSTEM</span>
          </div>
        </div>
        {user && (
          <div className="header-account">
            <div className="account-identity">
              <span className="account-label">Đã đăng nhập</span>
              <span className="account-name">{user.name}</span>
            </div>
            <button className="secondary-button logout-button" type="button" onClick={handleLogout}>Logout</button>
          </div>
        )}
      </header>
      <main className={user ? 'schedule-main' : undefined}>
        {checkingSession ? (
          <section className="auth-card" role="status">Checking your session...</section>
        ) : sessionError ? (
          <section className="auth-card">
            <h1>Check your session</h1>
            <p className="message error" role="alert">{sessionError}</p>
            <button type="button" onClick={() => setRetryNumber((number) => number + 1)}>Try again</button>
            <button className="text-button" type="button" onClick={handleLogout}>Back to Login</button>
          </section>
        ) : user ? (
          <SchedulePage user={user} onLogout={handleLogout} onSessionExpired={handleSessionExpired} />
        ) : page === 'register' ? (
          <RegisterPage onRegistered={handleRegistered} onShowLogin={() => setPage('login')} />
        ) : (
          <LoginPage initialEmail={registeredEmail} successMessage={successMessage}
            onLogin={handleLogin} onShowRegister={() => {
              setSuccessMessage('');
              setPage('register');
            }} />
        )}
      </main>
    </div>
  );
}
