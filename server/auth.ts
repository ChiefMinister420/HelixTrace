import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from './db.ts';

export interface AuthUser {
  sub: number;
  email: string;
  fullName: string;
  role: 'admin' | 'researcher';
  labId: number | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

const RUNTIME_JWT_SECRET = crypto.randomBytes(32).toString('hex');

function getJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET?.trim();
  return envSecret && envSecret.length >= 16 ? envSecret : RUNTIME_JWT_SECRET;
}

function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.sub,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      labId: user.labId,
    },
    getJwtSecret(),
    { expiresIn: '8h', algorithm: 'HS256' },
  );
}

function timingSafeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Provide a valid Bearer JWT token.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication token is empty.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as unknown as AuthUser;
    req.user = {
      sub: Number(decoded.sub),
      email: String(decoded.email),
      fullName: String(decoded.fullName),
      role: decoded.role === 'admin' ? 'admin' : 'researcher',
      labId: decoded.labId ?? null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token. Please sign in again.' });
  }
}

export function requireRole(role: 'admin') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: `Insufficient permissions. ${role} role required.` });
      return;
    }
    next();
  };
}

interface UserRow {
  user_id: number;
  full_name: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'researcher';
  lab_id: number | null;
}

function getConfiguredAdminPasscode(): string | null {
  const val = process.env.ADMIN_CLAIM_PASSCODE?.trim();
  if (!val || /^my_/i.test(val) || val.toLowerCase() === 'admin_claim_passcode') {
    return null;
  }
  return val;
}

export async function handleAuthStatus(_req: Request, res: Response): Promise<void> {
  try {
    const db = await getDb();
    const counts = await db.query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM app_user');
    const adminCounts = await db.query<{ cnt: number }>("SELECT COUNT(*) AS cnt FROM app_user WHERE role = 'admin'");
    const labs = await db.query<{ lab_id: number; lab_name: string; department: string }>(
      'SELECT lab_id, lab_name, department FROM lab ORDER BY lab_id',
    );
    const hasAdmin = Number(adminCounts[0]?.cnt ?? 0) > 0;
    const hasUsers = Number(counts[0]?.cnt ?? 0) > 0;

    res.json({
      needsBootstrap: !hasAdmin,
      hasUsers,
      envPasscodeConfigured: Boolean(getConfiguredAdminPasscode()),
      labs,
    });
  } catch (err) {
    console.error('[auth/status]', err);
    res.status(500).json({ error: 'Failed to check authentication status.' });
  }
}

export async function handleBootstrapAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { fullName, email, password, labId, claimPasscode } = req.body ?? {};

    if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 80) {
      res.status(400).json({ error: 'Full name must be between 2 and 80 characters.' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      return;
    }

    const configuredPasscode = getConfiguredAdminPasscode();
    if (configuredPasscode) {
      if (typeof claimPasscode !== 'string' || !timingSafeMatch(claimPasscode, configuredPasscode)) {
        res.status(403).json({ error: 'Invalid administrator claim passcode.' });
        return;
      }
    }

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();
    const parsedLabId = labId ? Number(labId) : null;

    const createdUser = await db.transaction(async (tx) => {
      const adminCounts = await tx.query<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM app_user WHERE role = 'admin'",
      );
      if (Number(adminCounts[0]?.cnt ?? 0) > 0) {
        return null;
      }

      if (parsedLabId !== null) {
        const labRows = await tx.query<{ lab_id: number }>('SELECT lab_id FROM lab WHERE lab_id = ?', [parsedLabId]);
        if (labRows.length === 0) {
          throw new Error('INVALID_LAB');
        }
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const insertRes = await tx.execute(
        'INSERT INTO app_user (full_name, email, password_hash, role, lab_id) VALUES (?, ?, ?, ?, ?)',
        [fullName.trim(), normalizedEmail, passwordHash, 'admin', parsedLabId],
      );

      return {
        sub: Number(insertRes.insertId),
        email: normalizedEmail,
        fullName: fullName.trim(),
        role: 'admin' as const,
        labId: parsedLabId,
      };
    });

    if (!createdUser) {
      res.status(409).json({ error: 'An administrator account has already been initialized.' });
      return;
    }

    const token = signToken(createdUser);
    res.status(201).json({ token, user: createdUser });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_LAB') {
      res.status(400).json({ error: 'Selected lab does not exist.' });
      return;
    }
    console.error('[auth/bootstrap]', err);
    res.status(500).json({ error: 'Failed to initialize administrator account.' });
  }
}

export async function handleRegister(req: Request, res: Response): Promise<void> {
  try {
    const { fullName, email, password, labId } = req.body ?? {};

    if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 80) {
      res.status(400).json({ error: 'Full name must be between 2 and 80 characters.' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'Valid email address is required.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      return;
    }

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();
    const parsedLabId = labId ? Number(labId) : null;

    if (parsedLabId !== null) {
      const labRows = await db.query<{ lab_id: number }>('SELECT lab_id FROM lab WHERE lab_id = ?', [parsedLabId]);
      if (labRows.length === 0) {
        res.status(400).json({ error: 'Selected lab does not exist.' });
        return;
      }
    }

    const existing = await db.query<{ user_id: number }>('SELECT user_id FROM app_user WHERE email = ?', [
      normalizedEmail,
    ]);
    if (existing.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insertRes = await db.execute(
      'INSERT INTO app_user (full_name, email, password_hash, role, lab_id) VALUES (?, ?, ?, ?, ?)',
      [fullName.trim(), normalizedEmail, passwordHash, 'researcher', parsedLabId],
    );

    const user: AuthUser = {
      sub: Number(insertRes.insertId),
      email: normalizedEmail,
      fullName: fullName.trim(),
      role: 'researcher',
      labId: parsedLabId,
    };

    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Failed to register researcher account.' });
  }
}

export async function handleLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();
    const rows = await db.query<UserRow>(
      'SELECT user_id, full_name, email, password_hash, role, lab_id FROM app_user WHERE email = ?',
      [normalizedEmail],
    );

    const record = rows[0];
    if (!record) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const matches = await bcrypt.compare(password, record.password_hash);
    if (!matches) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const user: AuthUser = {
      sub: Number(record.user_id),
      email: record.email,
      fullName: record.full_name,
      role: record.role === 'admin' ? 'admin' : 'researcher',
      labId: record.lab_id ?? null,
    };

    const token = signToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Authentication failed.' });
  }
}

export async function handleGetMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  try {
    const db = await getDb();
    let labName: string | null = null;
    if (req.user.labId !== null) {
      const labs = await db.query<{ lab_name: string }>('SELECT lab_name FROM lab WHERE lab_id = ?', [
        req.user.labId,
      ]);
      labName = labs[0]?.lab_name ?? null;
    }

    res.json({
      user: req.user,
      labName,
    });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
}
