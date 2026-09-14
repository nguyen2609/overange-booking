import cors from 'cors';
import { getFrontendOrigin } from '../config.js';

export function createCorsMiddleware(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const frontendOrigin = getFrontendOrigin(
    environment.FRONTEND_URL || (production ? '' : 'http://localhost:5173'), production,
  );
  const allowedOrigins = production
    ? [frontendOrigin]
    : [...new Set(['http://localhost:5173', 'http://127.0.0.1:5173', frontendOrigin])];
  const middleware = cors({
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  return (req, res, next) => {
    const origin = req.get('Origin');
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Origin is not allowed.' });
    }
    // Requests without Origin (health checks, PowerShell) still reach the API.
    return middleware(req, res, next);
  };
}
