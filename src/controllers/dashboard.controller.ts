import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/data-source';
import { Disciple } from '../entities/Disciple';
import { Training } from '../entities/Training';
import { Site } from '../entities/Site';
import { isSiteScopedRole } from '../utils/roleScope.util';

export async function getDashboardStats(req: Request, res: Response, next: NextFunction) {
  try {
    // Any role other than admin/super_admin (teacher, leader, or any other
    // role a super_admin creates later) only ever sees stats for their own
    // site -- never the whole system. See roleScope.util.ts.
    const siteScopeId: number | null =
      req.user && isSiteScopedRole(req.user.roleName) ? req.user.siteId ?? null : null;

    const discipleRepo = AppDataSource.getRepository(Disciple);
    const trainingRepo = AppDataSource.getRepository(Training);

    function discipleQB(alias = 'd') {
      const qb = discipleRepo
        .createQueryBuilder(alias)
        .leftJoin(`${alias}.trainingSite`, 'site')
        .leftJoin('site.center', 'center');
      if (siteScopeId) {
        qb.where('site.id = :siteId', { siteId: siteScopeId });
      }
      return qb;
    }

    function trainingQB(alias = 't') {
      const qb = trainingRepo
        .createQueryBuilder(alias)
        .innerJoin(`${alias}.disciple`, 'd')
        .leftJoin('d.trainingSite', 'site')
        .leftJoin('site.center', 'center');
      if (siteScopeId) {
        qb.where('site.id = :siteId', { siteId: siteScopeId });
      }
      return qb;
    }

    const currentYear = new Date().getFullYear();
    const fromYear = currentYear - 9;

    // Just for display on a site-scoped dashboard -- e.g. "Showing stats
    // for Masoro (ERC)" -- never used for filtering (siteScopeId already
    // handles that above).
    const scopedSitePromise = siteScopeId
      ? AppDataSource.getRepository(Site).findOne({
          where: { id: siteScopeId },
          relations: { center: { country: true } },
        })
      : Promise.resolve(null);

    // Run all queries in parallel for speed
    const [
      totalDisciples,
      byContinent,
      byCountry,
      graduationRaw,
      graduatesThisYearRaw,
      byGender,
      byTrainingMode,
      byLanguage,
      centersReachedRaw,
      byAgeGroup,
      scopedSite,
    ] = await Promise.all([

      discipleQB().getCount(),

      discipleQB('d')
        .leftJoin('center.country', 'country')
        .leftJoin('country.continent', 'continent')
        .select('continent.name', 'name')
        .addSelect('COUNT(d.id)', 'count')
        .groupBy('continent.name')
        .orderBy('count', 'DESC')
        .getRawMany(),

      discipleQB('d')
        .leftJoin('center.country', 'country')
        .select('country.name', 'name')
        .addSelect('COUNT(d.id)', 'count')
        .groupBy('country.name')
        .orderBy('count', 'DESC')
        .limit(15)
        .getRawMany(),

      trainingQB()
        .select('t.graduationYear', 'year')
        .addSelect('COUNT(t.id)', 'count')
        .andWhere('t.graduationYear >= :fromYear', { fromYear })
        .andWhere('t.graduationYear <= :currentYear', { currentYear })
        .groupBy('t.graduationYear')
        .orderBy('t.graduationYear', 'ASC')
        .getRawMany(),

      // Graduates this year only
      trainingQB()
        .select('COUNT(t.id)', 'count')
        .andWhere('t.graduationYear = :currentYear', { currentYear })
        .getRawOne(),

      discipleQB('d')
        .select('d.gender', 'gender')
        .addSelect('COUNT(d.id)', 'count')
        .groupBy('d.gender')
        .getRawMany(),

      trainingQB()
        .select('t.trainingMode', 'trainingMode')
        .addSelect('COUNT(t.id)', 'count')
        .groupBy('t.trainingMode')
        .getRawMany(),

      trainingQB()
        .leftJoin('t.trainingLanguage', 'lang')
        .select('lang.name', 'name')
        .addSelect('COUNT(t.id)', 'count')
        .andWhere('t.trainingLanguageId IS NOT NULL')
        .groupBy('lang.name')
        .orderBy('count', 'DESC')
        .getRawMany(),

      // NEW: distinct centers that have at least one disciple. Powers the
      // "Total # of Centers with BCC Graduates" card on the dashboard
      // (renamed from "Churches" in the UI).
      discipleQB('d')
        .select('COUNT(DISTINCT center.id)', 'count')
        .getRawOne(),

      // NEW: age-group breakdown, bucketed straight in SQL from
      // date_of_birth. Replaces the old marital-status chart slot on the
      // dashboard with something derived from data we actually collect.
      discipleQB('d')
        .select(
          `CASE
            WHEN d.dateOfBirth IS NULL THEN 'Unknown'
            WHEN DATE_PART('year', AGE(d.dateOfBirth)) < 18 THEN 'Under 18'
            WHEN DATE_PART('year', AGE(d.dateOfBirth)) < 26 THEN '18-25'
            WHEN DATE_PART('year', AGE(d.dateOfBirth)) < 36 THEN '26-35'
            WHEN DATE_PART('year', AGE(d.dateOfBirth)) < 46 THEN '36-45'
            WHEN DATE_PART('year', AGE(d.dateOfBirth)) < 61 THEN '46-60'
            ELSE '60+'
          END`,
          'ageGroup'
        )
        .addSelect('COUNT(d.id)', 'count')
        .groupBy('"ageGroup"')
        .getRawMany(),

      scopedSitePromise,
    ]);

    // Fill zeros for missing years so the chart line is continuous
    const graduationMap = new Map(
      graduationRaw.map((r: any) => [Number(r.year), Number(r.count)])
    );
    const graduationByYear = Array.from({ length: 10 }, (_, i) => ({
      year: fromYear + i,
      count: graduationMap.get(fromYear + i) ?? 0,
    }));

    // Age groups come back from SQL in arbitrary order; re-sort into a
    // natural youngest-to-oldest order, dropping buckets with zero people
    // so an empty bucket doesn't clutter the chart.
    const AGE_GROUP_ORDER = ['Under 18', '18-25', '26-35', '36-45', '46-60', '60+', 'Unknown'];
    const ageGroupMap = new Map(
      byAgeGroup.map((r: any) => [r.ageGroup ?? 'Unknown', Number(r.count)])
    );
    const byAgeGroupSorted = AGE_GROUP_ORDER
      .filter((label) => ageGroupMap.has(label))
      .map((label) => ({ ageGroup: label, count: ageGroupMap.get(label)! }));

    res.json({
      totalDisciples,
      currentYear,
      graduatesThisYear: Number(graduatesThisYearRaw?.count ?? 0),
      // True for any site-scoped role (teacher, leader, ...). The frontend
      // uses this to swap the "global reach" cards and continent/country
      // charts for a simpler, site-focused layout instead.
      scopedToCenter: siteScopeId !== null,
      // Display-only info about the scoped site itself (null for
      // admin/super_admin) -- e.g. for a "Showing stats for Masoro (ERC)"
      // subtitle. Never used for filtering; siteScopeId already did that.
      site: scopedSite
        ? {
            id: scopedSite.id,
            name: scopedSite.name,
            centerName: scopedSite.center?.name ?? null,
            countryName: scopedSite.center?.country?.name ?? null,
          }
        : null,
      centersReached: Number(centersReachedRaw?.count ?? 0),
      byContinent:     byContinent.map((r: any)     => ({ name: r.name ?? 'Unknown',                   count: Number(r.count) })),
      byCountry:       byCountry.map((r: any)       => ({ name: r.name ?? 'Unknown',                   count: Number(r.count) })),
      graduationByYear,
      byGender:        byGender.map((r: any)        => ({ gender: r.gender ?? 'Unknown',               count: Number(r.count) })),
      byTrainingMode:  byTrainingMode.map((r: any)  => ({ trainingMode: r.trainingMode ?? 'Unknown',   count: Number(r.count) })),
      byLanguage:      byLanguage.map((r: any)      => ({ name: r.name ?? 'Unknown',                   count: Number(r.count) })),
      byAgeGroup:      byAgeGroupSorted,
    });
  } catch (err) {
    console.error('[dashboard] getDashboardStats error:', err);
    next(err);
  }
}