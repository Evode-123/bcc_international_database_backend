import { Router } from 'express';
import multer from 'multer';
import {
  listDisciples,
  getDisciple,
  createDisciple,
  updateDisciple,
  deleteDisciple,
  addRepeatAttendance,
  getDashboardStats,
  getRepeatAttendanceReport,
} from '../controllers/disciple.controller';
import { parseDiscipleImport, commitDiscipleImport } from '../controllers/discipleImport.controller';
import {
  requireAuth,
  blockIfMustChangePassword,
  requirePermission,
} from '../middleware/auth.middleware';

export const discipleRouter = Router();

// Memory storage -- the uploaded file only ever gets read into an
// XLSX.WorkBook in discipleImport.controller.ts and then discarded; it's
// never written to disk, so there's nothing to clean up afterwards.
// A 20,000-row disciple spreadsheet is typically 2-4MB, so 10MB leaves
// plenty of room while still protecting the server's memory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

discipleRouter.use(requireAuth, blockIfMustChangePassword);

discipleRouter.get('/dashboard-stats', requirePermission('disciple.view'), getDashboardStats);
discipleRouter.get(
  '/reports/repeat-attendance',
  requirePermission('report.generate'),
  getRepeatAttendanceReport
);

// Read-only parse/preview step for Excel import. Gated behind the same
// permission as creating a disciple manually, since it's the first step
// of the same underlying action -- nothing is written to the database
// by this route; actual saves still go through the normal POST / below,
// one row at a time, from the frontend's import review page.
discipleRouter.post(
  '/import/parse',
  requirePermission('disciple.create'),
  upload.single('file'),
  parseDiscipleImport
);

// Bulk import (up to 20,000 rows). ?dryRun=true reads and checks the file
// and returns counts WITHOUT saving; without it, every valid row is saved in
// batches and only the rows needing attention come back. Same permission as
// creating a disciple manually.
discipleRouter.post(
  '/import/commit',
  requirePermission('disciple.create'),
  upload.single('file'),
  commitDiscipleImport
);

discipleRouter.get('/', requirePermission('disciple.view'), listDisciples);
discipleRouter.get('/:id', requirePermission('disciple.view'), getDisciple);
discipleRouter.post('/', requirePermission('disciple.create'), createDisciple);
discipleRouter.put('/:id', requirePermission('disciple.edit'), updateDisciple);
discipleRouter.delete('/:id', requirePermission('disciple.delete'), deleteDisciple);

discipleRouter.post(
  '/:id/repeat-attendance',
  requirePermission('disciple.create'),
  addRepeatAttendance
);