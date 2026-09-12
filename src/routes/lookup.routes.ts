import { Router } from 'express';
import {
  getContinents,
  getCountries,
  getCenters,
  getSites,
  getLanguages,
  getRoles,
} from '../controllers/lookup.controller';
import { requireAuth, blockIfMustChangePassword } from '../middleware/auth.middleware';

export const lookupRouter = Router();

lookupRouter.use(requireAuth, blockIfMustChangePassword);

lookupRouter.get('/continents', getContinents);
lookupRouter.get('/countries', getCountries);   // ?continentId=1
lookupRouter.get('/centers', getCenters);        // ?countryId=1
lookupRouter.get('/sites', getSites);            // ?centerId=1
lookupRouter.get('/languages', getLanguages);
lookupRouter.get('/roles', getRoles);