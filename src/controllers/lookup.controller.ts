import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/data-source';
import { Continent } from '../entities/Continent';
import { Country } from '../entities/Country';
import { Center } from '../entities/Center';
import { Site } from '../entities/Site';
import { Language } from '../entities/Language';
import { Role } from '../entities/Role';

export async function getContinents(_req: Request, res: Response, next: NextFunction) {
  try {
    const repo = AppDataSource.getRepository(Continent);
    const continents = await repo.find({ order: { name: 'ASC' } });
    res.json(continents);
  } catch (err) {
    next(err);
  }
}

export async function getCountries(req: Request, res: Response, next: NextFunction) {
  try {
    const continentId = req.query.continentId
      ? parseInt(req.query.continentId as string, 10)
      : undefined;

    const repo = AppDataSource.getRepository(Country);
    const countries = await repo.find({
      where: continentId ? { continentId } : {},
      order: { name: 'ASC' },
    });
    res.json(countries);
  } catch (err) {
    next(err);
  }
}

// Returns centers filtered by country. Used by the frontend to cascade
// the dropdown: user picks country → this loads centers for that country.
export async function getCenters(req: Request, res: Response, next: NextFunction) {
  try {
    const countryId = req.query.countryId
      ? parseInt(req.query.countryId as string, 10)
      : undefined;

    const repo = AppDataSource.getRepository(Center);
    const centers = await repo.find({
      where: countryId ? { countryId } : {},
      order: { name: 'ASC' },
    });
    res.json(centers);
  } catch (err) {
    next(err);
  }
}

// Returns sites filtered by center. Used by the frontend to cascade
// the dropdown: user picks center → this loads sites for that center.
// The response includes `isDefault` so the frontend can hide the site
// selector when only one default site exists.
export async function getSites(req: Request, res: Response, next: NextFunction) {
  try {
    const centerId = req.query.centerId
      ? parseInt(req.query.centerId as string, 10)
      : undefined;

    const repo = AppDataSource.getRepository(Site);
    const sites = await repo.find({
      where: centerId ? { centerId } : {},
      order: { name: 'ASC' },
    });
    res.json(sites);
  } catch (err) {
    next(err);
  }
}

export async function getLanguages(_req: Request, res: Response, next: NextFunction) {
  try {
    const repo = AppDataSource.getRepository(Language);
    const languages = await repo.find({ order: { name: 'ASC' } });
    res.json(languages);
  } catch (err) {
    next(err);
  }
}

export async function getRoles(req: Request, res: Response, next: NextFunction) {
  try {
    const repo = AppDataSource.getRepository(Role);
    const roles = await repo.find({ order: { name: 'ASC' } });

    // Hides "super_admin" from this list for anyone who isn't a Super
    // Admin themselves. This is what feeds BOTH the "Invite user" role
    // picker and the "Change role" picker on Manage Users -- so a regular
    // admin literally cannot select Super Admin for anyone, on top of the
    // server-side rejection in adminUser.controller.ts if they somehow did.
    const isSuperAdmin = req.user?.roleName === 'super_admin';
    const visibleRoles = isSuperAdmin ? roles : roles.filter((r) => r.name !== 'super_admin');

    res.json(visibleRoles);
  } catch (err) {
    next(err);
  }
}