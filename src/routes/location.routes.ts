import { Router } from 'express';
import {
  getLocationsTree,
  createContinent,
  updateContinent,
  deleteContinent,
  createCountry,
  updateCountry,
  deleteCountry,
  createCenter,
  updateCenter,
  deleteCenter,
  createSite,
  updateSite,
  deleteSite,
  createLanguage,
  deleteLanguage,
} from '../controllers/location.controller';
import {
  requireAuth,
  blockIfMustChangePassword,
  requirePermission,
} from '../middleware/auth.middleware';

export const locationRouter = Router();

locationRouter.use(requireAuth, blockIfMustChangePassword);

locationRouter.get('/tree', requirePermission('disciple.view'), getLocationsTree);

// Everything below actually changes the location tree, so it needs its
// own dedicated permission -- separate from user.manage, so that granting
// someone "Manage admin users" no longer also hands them the ability to
// add/edit/delete centers and sites.
locationRouter.use(requirePermission('location.manage'));

locationRouter.post('/continents', createContinent);
locationRouter.put('/continents/:id', updateContinent);
locationRouter.delete('/continents/:id', deleteContinent);

locationRouter.post('/countries', createCountry);
locationRouter.put('/countries/:id', updateCountry);
locationRouter.delete('/countries/:id', deleteCountry);

// POST body: { name, countryId, hasSites: boolean }
// hasSites=false → backend auto-creates a default site with the center's name
// hasSites=true  → admin adds sites manually afterwards via POST /sites
locationRouter.post('/centers', createCenter);
locationRouter.put('/centers/:id', updateCenter);
locationRouter.delete('/centers/:id', deleteCenter);

locationRouter.post('/sites', createSite);
locationRouter.put('/sites/:id', updateSite);
locationRouter.delete('/sites/:id', deleteSite);

locationRouter.post('/languages', createLanguage);
locationRouter.delete('/languages/:id', deleteLanguage);