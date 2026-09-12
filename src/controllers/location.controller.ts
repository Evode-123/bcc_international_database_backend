import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/data-source';
import { Continent } from '../entities/Continent';
import { Country } from '../entities/Country';
import { Center } from '../entities/Center';
import { Site } from '../entities/Site';
import { Language } from '../entities/Language';
import { parseIdParam } from '../utils/params.util';

/**
 * Returns the full geography hierarchy in one response:
 * every continent → countries → centers → sites.
 */
export async function getLocationsTree(_req: Request, res: Response, next: NextFunction) {
  try {
    const continentRepo = AppDataSource.getRepository(Continent);
    const languageRepo = AppDataSource.getRepository(Language);

    const [continents, languages] = await Promise.all([
      continentRepo.find({
        relations: { countries: { centers: { sites: true } } },
        order: { name: 'ASC' },
      }),
      languageRepo.find({ order: { name: 'ASC' } }),
    ]);

    res.json({ continents, languages });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Continents
// ---------------------------------------------------------------------------

export async function createContinent(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const repo = AppDataSource.getRepository(Continent);
    const existing = await repo.findOne({ where: { name: name.trim() } });
    if (existing) {
      res.status(409).json({ error: 'A continent with this name already exists' });
      return;
    }

    const continent = await repo.save(repo.create({ name: name.trim() }));
    res.status(201).json(continent);
  } catch (err) {
    next(err);
  }
}

export async function updateContinent(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const repo = AppDataSource.getRepository(Continent);
    await repo.update({ id }, { name: name.trim() });
    res.json({ id, name: name.trim() });
  } catch (err) {
    next(err);
  }
}

export async function deleteContinent(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const countryRepo = AppDataSource.getRepository(Country);
    const childCount = await countryRepo.count({ where: { continentId: id } });

    if (childCount > 0) {
      res.status(409).json({
        error: `Cannot delete: ${childCount} countr${childCount === 1 ? 'y' : 'ies'} still reference this continent. Remove or reassign them first.`,
      });
      return;
    }

    const repo = AppDataSource.getRepository(Continent);
    await repo.delete({ id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

export async function createCountry(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, continentId } = req.body as { name?: string; continentId?: number };
    if (!name?.trim() || !continentId) {
      res.status(400).json({ error: 'name and continentId are required' });
      return;
    }

    const repo = AppDataSource.getRepository(Country);
    const existing = await repo.findOne({ where: { name: name.trim() } });
    if (existing) {
      res.status(409).json({ error: 'A country with this name already exists' });
      return;
    }

    const country = await repo.save(repo.create({ name: name.trim(), continentId }));
    res.status(201).json(country);
  } catch (err) {
    next(err);
  }
}

export async function updateCountry(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const { name, continentId } = req.body as { name?: string; continentId?: number };

    const repo = AppDataSource.getRepository(Country);
    await repo.update(
      { id },
      { ...(name?.trim() && { name: name.trim() }), ...(continentId && { continentId }) }
    );
    res.json({ id });
  } catch (err) {
    next(err);
  }
}

/**
 * Deletes a country. Guarded against the most common way this fails --
 * centers still pointing at it -- with an explicit count check up front,
 * so the person always gets a plain-English reason rather than a raw
 * database error. (Countries have no other FK pointing at them besides
 * centers, so this one check is sufficient here; app.ts's global error
 * handler is the safety net for anything unforeseen.)
 */
export async function deleteCountry(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const centerRepo = AppDataSource.getRepository(Center);
    const childCount = await centerRepo.count({ where: { countryId: id } });

    if (childCount > 0) {
      res.status(409).json({
        error: `Cannot delete: ${childCount} center${childCount === 1 ? '' : 's'} still reference this country. Remove or reassign them first.`,
      });
      return;
    }

    const repo = AppDataSource.getRepository(Country);
    await repo.delete({ id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Centers
// ---------------------------------------------------------------------------

export async function createCenter(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, countryId, hasSites } = req.body as {
      name?: string;
      countryId?: number;
      hasSites?: boolean;
    };

    if (!name?.trim() || !countryId) {
      res.status(400).json({ error: 'name and countryId are required' });
      return;
    }

    const centerRepo = AppDataSource.getRepository(Center);
    const existing = await centerRepo.findOne({ where: { name: name.trim(), countryId } });
    if (existing) {
      res.status(409).json({ error: 'A center with this name already exists in this country' });
      return;
    }

    const result = await AppDataSource.transaction(async (manager) => {
      const cRepo = manager.getRepository(Center);
      const sRepo = manager.getRepository(Site);

      const center = await cRepo.save(cRepo.create({ name: name.trim(), countryId }));

      let defaultSite: Site | null = null;
      if (!hasSites) {
        defaultSite = await sRepo.save(
          sRepo.create({ name: center.name, centerId: center.id, isDefault: true })
        );
      }

      return { center, defaultSite };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateCenter(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const { name, countryId } = req.body as { name?: string; countryId?: number };

    const centerRepo = AppDataSource.getRepository(Center);
    await centerRepo.update(
      { id },
      { ...(name?.trim() && { name: name.trim() }), ...(countryId && { countryId }) }
    );

    // Keep the default site name in sync with the center name
    if (name?.trim()) {
      const siteRepo = AppDataSource.getRepository(Site);
      await siteRepo.update({ centerId: id, isDefault: true }, { name: name.trim() });
    }

    res.json({ id });
  } catch (err) {
    next(err);
  }
}

/**
 * Deletes a center and handles both scenarios:
 *
 * 1. Center = site (has one auto-created default site with is_default=true):
 *    First checks that no disciples or trainings reference that default site.
 *    If clear, deletes the default site + center in one transaction.
 *
 * 2. Center has real sub-sites (is_default=false):
 *    Blocked — admin must delete or reassign sub-sites first.
 */
export async function deleteCenter(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const siteRepo = AppDataSource.getRepository(Site);

    const sites = await siteRepo.find({ where: { centerId: id } });

    if (sites.length === 0) {
      // No sites at all — delete center directly
      const repo = AppDataSource.getRepository(Center);
      await repo.delete({ id });
      res.status(204).send();
      return;
    }

    const hasOnlyDefaultSite = sites.length === 1 && sites[0].isDefault;

    if (hasOnlyDefaultSite) {
      const defaultSiteId = sites[0].id;

      // Block deletion if disciples are still linked to this site
      const discipleRows = await AppDataSource.query(
        `SELECT COUNT(*)::int AS count FROM disciples WHERE training_site_id = $1`,
        [defaultSiteId]
      );
      const discipleCount = discipleRows[0].count;
      if (discipleCount > 0) {
        res.status(409).json({
          error: `Cannot delete: ${discipleCount} disciple${discipleCount === 1 ? '' : 's'} are linked to this center. Reassign or delete them first.`,
        });
        return;
      }

      // Block deletion if training records are still linked to this site
      const trainingRows = await AppDataSource.query(
        `SELECT COUNT(*)::int AS count FROM trainings WHERE training_site_id = $1`,
        [defaultSiteId]
      );
      const trainingCount = trainingRows[0].count;
      if (trainingCount > 0) {
        res.status(409).json({
          error: `Cannot delete: ${trainingCount} training record${trainingCount === 1 ? '' : 's'} are linked to this center. Reassign or delete them first.`,
        });
        return;
      }

      // Safe — delete default site then center together in one transaction
      await AppDataSource.transaction(async (manager) => {
        await manager.getRepository(Site).delete({ id: defaultSiteId });
        await manager.getRepository(Center).delete({ id });
      });
      res.status(204).send();
      return;
    }

    // Center has real sub-sites — block deletion
    const realSiteCount = sites.filter((s) => !s.isDefault).length;
    res.status(409).json({
      error: `Cannot delete: ${realSiteCount} site${realSiteCount === 1 ? '' : 's'} still belong to this center. Remove or reassign them first.`,
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export async function createSite(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, centerId } = req.body as { name?: string; centerId?: number };
    if (!name?.trim() || !centerId) {
      res.status(400).json({ error: 'name and centerId are required' });
      return;
    }

    const repo = AppDataSource.getRepository(Site);
    const existing = await repo.findOne({ where: { name: name.trim(), centerId } });
    if (existing) {
      res.status(409).json({ error: 'A site with this name already exists in this center' });
      return;
    }

    // Manually created sites are never default sites
    const site = await repo.save(
      repo.create({ name: name.trim(), centerId, isDefault: false })
    );
    res.status(201).json(site);
  } catch (err) {
    next(err);
  }
}

export async function updateSite(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const { name, centerId } = req.body as { name?: string; centerId?: number };

    const repo = AppDataSource.getRepository(Site);
    await repo.update(
      { id },
      { ...(name?.trim() && { name: name.trim() }), ...(centerId && { centerId }) }
    );
    res.json({ id });
  } catch (err) {
    next(err);
  }
}

/**
 * Deletes a (non-default) site. Default sites (is_default=true) can't be
 * deleted directly — they only go away as part of deleting the center
 * itself via deleteCenter above.
 *
 * This previously went straight to `repo.delete({ id })` with no check for
 * disciples/trainings still pointing at this site -- unlike deleteCenter's
 * equivalent check for its default site. That's exactly what let a raw
 * Postgres "violates foreign key constraint" error slip through to the
 * screen when someone tried to delete a site that still had people
 * assigned to it. Now it checks first and returns the same kind of plain
 * message deleteCenter already gives.
 */
export async function deleteSite(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const repo = AppDataSource.getRepository(Site);

    const site = await repo.findOne({ where: { id } });
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    if (site.isDefault) {
      res.status(409).json({
        error: 'Cannot delete the default site directly. Delete the center instead.',
      });
      return;
    }

    // Block deletion if disciples are still linked to this site
    const discipleRows = await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM disciples WHERE training_site_id = $1`,
      [id]
    );
    const discipleCount = discipleRows[0].count;
    if (discipleCount > 0) {
      res.status(409).json({
        error: `Cannot delete: ${discipleCount} disciple${discipleCount === 1 ? '' : 's'} are linked to this site. Reassign or delete them first.`,
      });
      return;
    }

    // Block deletion if training records are still linked to this site
    const trainingRows = await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM trainings WHERE training_site_id = $1`,
      [id]
    );
    const trainingCount = trainingRows[0].count;
    if (trainingCount > 0) {
      res.status(409).json({
        error: `Cannot delete: ${trainingCount} training record${trainingCount === 1 ? '' : 's'} are linked to this site. Reassign or delete them first.`,
      });
      return;
    }

    await repo.delete({ id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export async function createLanguage(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const repo = AppDataSource.getRepository(Language);
    const existing = await repo.findOne({ where: { name: name.trim() } });
    if (existing) {
      res.status(409).json({ error: 'A language with this name already exists' });
      return;
    }

    const language = await repo.save(repo.create({ name: name.trim() }));
    res.status(201).json(language);
  } catch (err) {
    next(err);
  }
}

/**
 * Deletes a language. There is currently no guard here for trainings that
 * reference it (trainings.training_language_id) -- if that ever happens,
 * app.ts's global foreign-key translator (see below) now catches it and
 * returns a plain message instead of a raw database error, even without a
 * dedicated check like the ones above.
 */
export async function deleteLanguage(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const repo = AppDataSource.getRepository(Language);
    await repo.delete({ id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}