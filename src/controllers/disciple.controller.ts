import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/data-source';
import { Disciple } from '../entities/Disciple';
import { Training } from '../entities/Training';
import { RepeatAttendance } from '../entities/RepeatAttendance';
import { Site } from '../entities/Site';
import { parseIdParam } from '../utils/params.util';
import { isSiteScopedRole } from '../utils/roleScope.util';

// Returns the site a site-scoped user (teacher, leader, or any other
// non-admin role) is locked to, or null for admin/super_admin who see
// every site. Centralized here so every disciple endpoint below applies
// exactly the same rule.
function getSiteScope(req: Request): number | null {
  if (!req.user || !isSiteScopedRole(req.user.roleName)) return null;
  return req.user.siteId ?? null;
}

export async function listDisciples(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, continentId, countryId, centerId, siteId, graduationYear } = req.query as {
      search?: string;
      continentId?: string;
      countryId?: string;
      centerId?: string;
      siteId?: string;
      graduationYear?: string;
    };

    const discipleRepo = AppDataSource.getRepository(Disciple);
    const qb = discipleRepo
      .createQueryBuilder('disciple')
      // Join through site → center → country → continent to allow filtering
      // at any level of the hierarchy without redundant FKs on the disciple.
      .leftJoinAndSelect('disciple.trainingSite', 'site')
      .leftJoinAndSelect('site.center', 'center')
      .leftJoinAndSelect('center.country', 'country')
      .leftJoinAndSelect('country.continent', 'continent')
      .leftJoinAndSelect('disciple.trainings', 'training')
      .leftJoinAndSelect('training.trainingSite', 'trainingSite')
      .leftJoinAndSelect('trainingSite.center', 'trainingCenter')
      .leftJoinAndSelect('trainingCenter.country', 'trainingCountry')
      .leftJoinAndSelect('training.trainingLanguage', 'trainingLanguage')
      .loadRelationIdAndMap('disciple.repeatAttendanceIds', 'disciple.repeatAttendances')
      .orderBy('disciple.familyName', 'ASC');

    if (search) {
      qb.andWhere(
        '(disciple.familyName ILIKE :search OR disciple.otherNames ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Site-scoped roles (teacher, leader, or any other non-admin role)
    // never see disciples outside their own site -- this overrides
    // whatever the client sent for siteId/centerId/countryId/continentId,
    // so a crafted request can't widen the view beyond their site.
    const scopedSiteId = getSiteScope(req);
    if (scopedSiteId) {
      qb.andWhere('disciple.trainingSiteId = :scopedSiteId', { scopedSiteId });
    } else if (siteId) {
      qb.andWhere('disciple.trainingSiteId = :siteId', { siteId: parseInt(siteId, 10) });
    } else if (centerId) {
      qb.andWhere('center.id = :centerId', { centerId: parseInt(centerId, 10) });
    } else if (countryId) {
      qb.andWhere('country.id = :countryId', { countryId: parseInt(countryId, 10) });
    } else if (continentId) {
      qb.andWhere('continent.id = :continentId', { continentId: parseInt(continentId, 10) });
    }
    if (graduationYear) {
      qb.andWhere('training.graduationYear = :graduationYear', {
        graduationYear: parseInt(graduationYear, 10),
      });
    }

    const disciples = await qb.getMany();
    res.json(disciples);
  } catch (err) {
    next(err);
  }
}

export async function getDisciple(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);

    const discipleRepo = AppDataSource.getRepository(Disciple);
    const disciple = await discipleRepo.findOne({
      where: { id },
      relations: {
        trainingSite: { center: { country: { continent: true } } },
        trainings: {
          trainingSite: { center: { country: true } },
          trainingLanguage: true,
        },
        repeatAttendances: { training: true },
      },
    });

    if (!disciple) {
      res.status(404).json({ error: 'Disciple not found' });
      return;
    }

    // A site-scoped user (teacher, leader, ...) can't view a disciple who
    // belongs to a different site -- reported as a plain 404 rather than
    // 403 so it doesn't confirm to them that a disciple with this id
    // exists elsewhere.
    const scopedSiteId = getSiteScope(req);
    if (scopedSiteId && disciple.trainingSiteId !== scopedSiteId) {
      res.status(404).json({ error: 'Disciple not found' });
      return;
    }

    res.json(disciple);
  } catch (err) {
    next(err);
  }
}

interface CreateDiscipleBody {
  familyName: string;
  otherNames?: string;
  gender?: 'Male' | 'Female';
  // Replaces the old numeric `age` field -- expects 'YYYY-MM-DD', which is
  // exactly what an <input type="date"> sends.
  dateOfBirth?: string;
  phoneNumber?: string;
  email?: string;
  city?: string;
  fellowshipChurch?: string;
  trainingSiteId: number;
  training: {
    // When editing an existing disciple, the frontend sends back the id
    // of the exact Training row it loaded and displayed, so the backend
    // updates THAT row rather than guessing which one is "the latest."
    // Omitted when creating a brand new disciple (there's no row yet).
    id?: number;
    graduationYear: number;
    trainingMode?: 'Online' | 'In-person';
    trainingLanguageId?: number;
    // trainingSiteId on training defaults to the disciple's trainingSiteId
    // unless explicitly overridden (e.g. disciple moved between sites).
    trainingSiteId?: number;
  };
}

export async function createDisciple(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as CreateDiscipleBody;

    if (!body.familyName) {
      res.status(400).json({ error: 'familyName is required' });
      return;
    }

    // Site-scoped users (teacher, leader, ...) can only ever add disciples
    // to their own site -- their assigned site wins regardless of what was
    // submitted, so a crafted request can't sneak a disciple into a
    // different site. Unscoped users (admin/super_admin) must pick one.
    const scopedSiteId = getSiteScope(req);
    if (scopedSiteId) {
      body.trainingSiteId = scopedSiteId;
      if (body.training) body.training.trainingSiteId = scopedSiteId;
    } else if (!body.trainingSiteId) {
      res.status(400).json({ error: 'trainingSiteId is required' });
      return;
    }

    if (!body.training?.graduationYear) {
      res.status(400).json({ error: 'training.graduationYear is required' });
      return;
    }

    // Verify the site exists before creating anything.
    const siteRepo = AppDataSource.getRepository(Site);
    const site = await siteRepo.findOne({ where: { id: body.trainingSiteId } });
    if (!site) {
      res.status(400).json({ error: 'trainingSiteId does not match any existing site' });
      return;
    }

    const result = await AppDataSource.transaction(async (manager) => {
      const discipleRepo = manager.getRepository(Disciple);
      const trainingRepo = manager.getRepository(Training);

      const disciple = await discipleRepo.save(
        discipleRepo.create({
          familyName: body.familyName,
          otherNames: body.otherNames,
          gender: body.gender as any,
          dateOfBirth: body.dateOfBirth || null,
          phoneNumber: body.phoneNumber,
          email: body.email,
          city: body.city,
          fellowshipChurch: body.fellowshipChurch,
          trainingSiteId: body.trainingSiteId,
          createdById: req.user!.id,
        })
      );

      const training = await trainingRepo.save(
        trainingRepo.create({
          discipleId: disciple.id,
          graduationYear: body.training.graduationYear,
          trainingMode: body.training.trainingMode as any,
          trainingLanguageId: body.training.trainingLanguageId,
          // Use the training-specific site if provided, otherwise inherit
          // from the disciple's own site.
          trainingSiteId: body.training.trainingSiteId ?? body.trainingSiteId,
        })
      );

      return { disciple, training };
    });

    res.status(201).json({ ...result.disciple, trainings: [result.training] });
  } catch (err) {
    next(err);
  }
}

/**
 * Updates a disciple's personal/location fields AND their training
 * record (graduation year, mode, language) in one request.
 *
 * Two things matter here beyond the obvious field mapping:
 *
 * 1. We update the disciple's Training row by its own `id`, sent back
 *    by the frontend as `training.id` (the exact row the edit form
 *    loaded), with an ownership check against `discipleId`. An earlier
 *    version of this endpoint picked "whichever training row has the
 *    highest graduationYear" -- that silently broke for disciples with
 *    more than one Training row: editing graduationYear down, for
 *    example, would update the intended row, but a subsequent "pick the
 *    latest by graduationYear" for display would then show a DIFFERENT,
 *    unchanged row -- making it look like nothing saved.
 *
 * 2. `dateOfBirth` replaces the old `age` field, since age goes stale
 *    the moment it's saved.
 */
export async function updateDisciple(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const body = req.body as Partial<CreateDiscipleBody>;

    const discipleRepo = AppDataSource.getRepository(Disciple);
    const existing = await discipleRepo.findOne({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Disciple not found' });
      return;
    }

    // A site-scoped user (teacher, leader, ...) can't edit a disciple who
    // belongs to a different site, and can't move a disciple they DO own
    // to a different site either -- their site always wins.
    const scopedSiteId = getSiteScope(req);
    if (scopedSiteId) {
      if (existing.trainingSiteId !== scopedSiteId) {
        res.status(404).json({ error: 'Disciple not found' });
        return;
      }
      body.trainingSiteId = scopedSiteId;
      if (body.training) body.training.trainingSiteId = scopedSiteId;
    }

    // If a new trainingSiteId is provided, make sure it actually exists
    // before we write anything.
    if (body.trainingSiteId) {
      const siteRepo = AppDataSource.getRepository(Site);
      const site = await siteRepo.findOne({ where: { id: body.trainingSiteId } });
      if (!site) {
        res.status(400).json({ error: 'trainingSiteId does not match any existing site' });
        return;
      }
    }

    await AppDataSource.transaction(async (manager) => {
      const discipleRepoTx = manager.getRepository(Disciple);
      const trainingRepoTx = manager.getRepository(Training);

      await discipleRepoTx.update(
        { id },
        {
          familyName: body.familyName,
          otherNames: body.otherNames,
          gender: body.gender as any,
          dateOfBirth: body.dateOfBirth !== undefined ? (body.dateOfBirth || null) : undefined,
          phoneNumber: body.phoneNumber,
          email: body.email,
          city: body.city,
          fellowshipChurch: body.fellowshipChurch,
          trainingSiteId: body.trainingSiteId,
          updatedById: req.user!.id,
        }
      );

      if (body.training) {
        const trainingSiteId = body.training.trainingSiteId ?? body.trainingSiteId;
        const trainingId = body.training.id;

        let targetTraining: Training | null = null;

        if (trainingId) {
          // Ownership check: this training row must actually belong to
          // this disciple -- never trust a bare id from the client.
          targetTraining = await trainingRepoTx.findOne({
            where: { id: trainingId, discipleId: id },
          });
        }

        // Fallback for disciples that somehow have no matched training
        // row yet (e.g. legacy data): fall back to the single most
        // recent one rather than failing outright.
        if (!targetTraining) {
          targetTraining = await trainingRepoTx.findOne({
            where: { discipleId: id },
            order: { graduationYear: 'DESC' },
          });
        }

        if (targetTraining) {
          await trainingRepoTx.update(
            { id: targetTraining.id },
            {
              graduationYear: body.training.graduationYear,
              trainingMode: body.training.trainingMode as any,
              trainingLanguageId: body.training.trainingLanguageId,
              ...(trainingSiteId ? { trainingSiteId } : {}),
            }
          );
        } else if (body.training.graduationYear) {
          // No training row exists at all yet -- create one instead of
          // silently discarding the submitted training data.
          await trainingRepoTx.save(
            trainingRepoTx.create({
              discipleId: id,
              graduationYear: body.training.graduationYear,
              trainingMode: body.training.trainingMode as any,
              trainingLanguageId: body.training.trainingLanguageId,
              trainingSiteId: trainingSiteId ?? existing.trainingSiteId ?? undefined,
            })
          );
        }
      }
    });

    const updated = await discipleRepo.findOneOrFail({
      where: { id },
      relations: {
        trainingSite: { center: { country: { continent: true } } },
        trainings: {
          trainingSite: { center: { country: true } },
          trainingLanguage: true,
        },
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteDisciple(req: Request, res: Response, next: NextFunction) {
  try {
    const id = parseIdParam(req.params.id);
    const discipleRepo = AppDataSource.getRepository(Disciple);

    // A site-scoped user (teacher, leader, ...) can only delete disciples
    // that belong to their own site.
    const scopedSiteId = getSiteScope(req);
    if (scopedSiteId) {
      const existing = await discipleRepo.findOne({ where: { id } });
      if (!existing || existing.trainingSiteId !== scopedSiteId) {
        res.status(404).json({ error: 'Disciple not found' });
        return;
      }
    }

    await discipleRepo.delete({ id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function addRepeatAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    const discipleId = parseIdParam(req.params.id);
    const { trainingId, attendanceYear, notes } = req.body as {
      trainingId?: number;
      attendanceYear?: number;
      notes?: string;
    };

    if (!trainingId || !attendanceYear) {
      res.status(400).json({ error: 'trainingId and attendanceYear are required' });
      return;
    }

    // A site-scoped user can only log repeat attendance for a disciple
    // who belongs to their own site.
    const scopedSiteId = getSiteScope(req);
    if (scopedSiteId) {
      const discipleRepo = AppDataSource.getRepository(Disciple);
      const disciple = await discipleRepo.findOne({ where: { id: discipleId } });
      if (!disciple || disciple.trainingSiteId !== scopedSiteId) {
        res.status(404).json({ error: 'Disciple not found' });
        return;
      }
    }

    const trainingRepo = AppDataSource.getRepository(Training);
    const originalTraining = await trainingRepo.findOne({
      where: { id: trainingId, discipleId },
    });

    if (!originalTraining) {
      res.status(400).json({
        error: 'trainingId must refer to a training this disciple already graduated from',
      });
      return;
    }

    const repeatRepo = AppDataSource.getRepository(RepeatAttendance);
    const repeat = await repeatRepo.save(
      repeatRepo.create({ discipleId, trainingId, attendanceYear, notes })
    );

    res.status(201).json(repeat);
  } catch (err) {
    next(err);
  }
}

/**
 * Dashboard summary stats. Joins through the normalized chain
 * site → center → country → continent instead of direct FKs.
 */
export async function getDashboardStats(req: Request, res: Response, next: NextFunction) {
  try {
    const discipleRepo = AppDataSource.getRepository(Disciple);
    const trainingRepo = AppDataSource.getRepository(Training);

    // Kept in sync with the real dashboard endpoint (dashboard.controller.ts)
    // even though the frontend currently calls that one instead of this
    // route -- this route is still live, so it shouldn't leak system-wide
    // numbers to a site-scoped user if something ever calls it directly.
    const scopedSiteId = getSiteScope(req);

    const totalDisciples = await discipleRepo
      .createQueryBuilder('d')
      .where(scopedSiteId ? 'd.trainingSiteId = :scopedSiteId' : '1=1', { scopedSiteId })
      .getCount();

    // Count distinct continents that have at least one training
    const continentsWithGraduates = await trainingRepo
      .createQueryBuilder('training')
      .innerJoin('training.trainingSite', 'site')
      .innerJoin('site.center', 'center')
      .innerJoin('center.country', 'country')
      .innerJoin('country.continent', 'continent')
      .where(scopedSiteId ? 'site.id = :scopedSiteId' : '1=1', { scopedSiteId })
      .select('COUNT(DISTINCT continent.id)', 'count')
      .getRawOne();

    const countriesWithGraduates = await trainingRepo
      .createQueryBuilder('training')
      .innerJoin('training.trainingSite', 'site')
      .innerJoin('site.center', 'center')
      .innerJoin('center.country', 'country')
      .where(scopedSiteId ? 'site.id = :scopedSiteId' : '1=1', { scopedSiteId })
      .select('COUNT(DISTINCT country.id)', 'count')
      .getRawOne();

    const centersWithGraduates = await trainingRepo
      .createQueryBuilder('training')
      .innerJoin('training.trainingSite', 'site')
      .innerJoin('site.center', 'center')
      .where(scopedSiteId ? 'site.id = :scopedSiteId' : '1=1', { scopedSiteId })
      .select('COUNT(DISTINCT center.id)', 'count')
      .getRawOne();

    const byYearRaw: { graduationYear: number; count: string }[] = await trainingRepo
      .createQueryBuilder('training')
      .innerJoin('training.trainingSite', 'site')
      .where(scopedSiteId ? 'site.id = :scopedSiteId' : '1=1', { scopedSiteId })
      .select('training.graduationYear', 'graduationYear')
      .addSelect('COUNT(training.id)', 'count')
      .groupBy('training.graduationYear')
      .orderBy('training.graduationYear', 'ASC')
      .getRawMany();

    const graduatesByYear = byYearRaw.map((row) => ({
      year: row.graduationYear,
      count: parseInt(row.count, 10),
    }));

    res.json({
      totalDisciples,
      continentsWithGraduates: parseInt(continentsWithGraduates?.count || '0', 10),
      countriesWithGraduates: parseInt(countriesWithGraduates?.count || '0', 10),
      centersWithGraduates: parseInt(centersWithGraduates?.count || '0', 10),
      graduatesByYear,
    });
  } catch (err) {
    next(err);
  }
}

export async function getRepeatAttendanceReport(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const discipleRepo = AppDataSource.getRepository(Disciple);
    const scopedSiteId = getSiteScope(req);

    const rows: {
      id: number;
      familyName: string;
      otherNames: string | null;
      timesRepeated: string;
    }[] = await discipleRepo
      .createQueryBuilder('disciple')
      .innerJoin('disciple.repeatAttendances', 'repeatAttendance')
      .where(scopedSiteId ? 'disciple.trainingSiteId = :scopedSiteId' : '1=1', { scopedSiteId })
      .select('disciple.id', 'id')
      .addSelect('disciple.familyName', 'familyName')
      .addSelect('disciple.otherNames', 'otherNames')
      .addSelect('COUNT(repeatAttendance.id)', 'timesRepeated')
      .groupBy('disciple.id')
      .addGroupBy('disciple.familyName')
      .addGroupBy('disciple.otherNames')
      .orderBy('"timesRepeated"', 'DESC')
      .getRawMany();

    res.json(
      rows.map((r) => ({
        id: r.id,
        familyName: r.familyName,
        otherNames: r.otherNames,
        timesRepeated: parseInt(r.timesRepeated, 10),
      }))
    );
  } catch (err) {
    next(err);
  }
}