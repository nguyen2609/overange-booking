import { useState } from 'react';
import api, { getErrorMessage } from '../api/axios.js';

export default function RegisterPage({ onRegistered, onShowLogin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/auth/register', { name, email, password });
      onRegistered(response.data.user.email);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="register-title">
      <p className="eyebrow">Identity / Registration</p>
      <h1 id="register-title">Create an account</h1>
      <p className="intro">Tạo tài khoản để tham gia lịch casting OVERANGE.</p>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={loading}>
          <label htmlFor="register-name">Name</label>
          <input id="register-name" autoComplete="name" value={name}
            onChange={(event) => setName(event.target.value)} required />
          <label htmlFor="register-email">Email</label>
          <input id="register-email" type="email" autoComplete="email" value={email}
            onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="register-password">Password</label>
          <input id="register-password" type="password" autoComplete="new-password"
            minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required />
          <p className="hint">Use at least 6 characters.</p>
          {error && <p className="message error" role="alert">{error}</p>}
          <button className="primary-button" type="submit">{loading ? 'Registering...' : 'Register'}</button>
        </fieldset>
      </form>
      <p className="switch-page">Already have an account?{' '}
        <button className="text-button" type="button" disabled={loading} onClick={onShowLogin}>Login</button>
      </p>
    </section>
  );
}

