import { useState } from 'react';
import api, { getErrorMessage } from '../api/axios.js';

export default function LoginPage({ onLogin, onShowRegister, initialEmail, successMessage }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/auth/login', { email, password });
      onLogin(response.data);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <p className="eyebrow">Identity / Access</p>
      <h1 id="login-title">Casting booking</h1>
      <p className="intro">Đăng nhập để xem lịch và đặt khung giờ casting.</p>
      {successMessage && <p className="message success" role="status">{successMessage}</p>}
      <form onSubmit={handleSubmit}>
        <fieldset disabled={loading}>
          <label htmlFor="login-email">Email</label>
          <input id="login-email" type="email" autoComplete="email" value={email}
            onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error && <p className="message error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">{loading ? 'Logging in...' : 'Login'}</button>
        </fieldset>
      </form>
      <p className="switch-page">New here?{' '}
        <button className="text-button" type="button" disabled={loading} onClick={onShowRegister}>Register</button>
      </p>
    </section>
  );
}
