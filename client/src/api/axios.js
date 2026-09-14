import axios from 'axios';
import { getToken } from './tokenStorage.js';

// All API requests share this base URL and timeout.
const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL?.trim() || '/api').replace(/\/+$/, ''),
  timeout: 5000,
});

// Read the latest token before each request, including after login or logout.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getErrorMessage(error) {
  return error.response?.data?.error || 'Could not connect to the server. Please try again.';
}

export default api;

