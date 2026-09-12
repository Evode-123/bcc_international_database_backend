import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authRouter } from './routes/auth.routes';
import { adminUserRouter } from './routes/adminUser.routes';
import { discipleRouter } from './routes/disciple.routes';
import { lookupRouter } from './routes/lookup.routes';
import { permissionRouter } from './routes/permission.routes';
import { locationRouter } from './routes/location.routes';
import { dashboardRouter } from './routes/dashboard.routes';   // ← ADD THIS

/**
 * Human-readable labels for the tables in this schema, used only to build
 * the friendly foreign-key message below. Missing/unknown tables still
 * get a sensible generic fallback, so adding a new entity later never
 * breaks this -- it just won't have a pretty label until added here.
 */
const TABLE_LABELS: Record<string, string> = {
  centers: 'one or more centers',
  sites: 'one or more training sites',
  disciples: 'one or more disciples',
  trainings: 'one or more training records',
  countries: 'one or more countries',
  continents: 'one or more continents',
  admin_users: 'one or more admin user accounts',
  repeat_attendances: 'one or more repeat-attendance records',
  role_permissions: 'one or more role permissions',
};

/**
 * Turns a raw Postgres foreign-key-violation error (code 23503 -- thrown
 * whenever a DELETE or UPDATE would leave another row pointing at
 * nothing) into one plain sentence, instead of letting the database's own
 * message ("update or delete on table \"countries\" violates foreign key
 * constraint ...") reach the screen.
 *
 * This is a SAFETY NET, not the primary defense -- the delete controllers
 * in location.controller.ts already check row counts up front and return
 * a specific, situation-aware message (e.g. "3 disciples are linked to
 * this site") before they ever attempt the delete. This only fires for
 * cases nothing upstream explicitly guarded against, so no matter what,
 * nobody ever sees raw SQL.
 *
 * Returns null if `err` isn't a foreign-key violation, so the caller can
 * fall through to the normal error response.
 */
function buildForeignKeyErrorMessage(err: any): string | null {
  const pgCode = err?.code || err?.driverError?.code;
  if (pgCode !== '23503') return null;

  // Postgres's own detail text looks like:
  //   Key (id)=(5) is still referenced from table "centers".
  // Pulling the table name out of that is more reliable than trying to
  // parse the constraint name, which varies by naming convention.
  const detail: string = err?.detail || err?.driverError?.detail || '';
  const match = detail.match(/is still referenced from table "([^"]+)"/i);
  const referencingTable = match?.[1];

  const label = referencingTable
    ? TABLE_LABELS[referencingTable] || `related records in "${referencingTable}"`
    : 'other records';

  return `Cannot delete this: it is still linked to ${label}. Remove or reassign those first, then try again.`;
}

export function createApp(): Express {
  const app = express();

  if (env.nodeEnv === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin-users', adminUserRouter);
  app.use('/api/disciples', discipleRouter);
  app.use('/api/lookups', lookupRouter);
  app.use('/api/permissions', permissionRouter);
  app.use('/api/locations', locationRouter);
  app.use('/api/dashboard', dashboardRouter);   // ← ADD THIS

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  // Centralized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);

    // Translate any unguarded foreign-key violation into plain language
    // before falling back to the generic 500 handling below.
    const fkMessage = buildForeignKeyErrorMessage(err);
    if (fkMessage) {
      res.status(409).json({ error: fkMessage });
      return;
    }

    const status = err.status || 500;
    const message = err.message || 'Internal server error';
    res.status(status).json({ error: message });
  });

  return app;
}