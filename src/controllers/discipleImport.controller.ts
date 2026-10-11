import { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../config/data-source';
import { Continent } from '../entities/Continent';
import { Country } from '../entities/Country';
import { Center } from '../entities/Center';
import { Site } from '../entities/Site';
import { Language } from '../entities/Language';
import { Disciple, Gender } from '../entities/Disciple';
import { Training, TrainingMode } from '../entities/Training';
import { findBestMatches, similarity } from '../utils/stringSimilarity.util';
import { isSiteScopedRole } from '../utils/roleScope.util';

const GENDERS = ['Male', 'Female'];
const TRAINING_MODES = ['Online', 'In-person'];

// ─── Limits ──────────────────────────────────────────────────────────────────
// Biggest file the bulk import accepts. Raised from 1,000 to 20,000 rows.
export const MAX_IMPORT_ROWS = 20000;
// The older read-only preview endpoint returns every row to the browser, so
// it stays small. Big files go through the bulk endpoint instead.
const PREVIEW_ONLY_MAX_ROWS = 2000;
// Rows inserted per database round trip. 1,000 rows x ~11 columns is well
// under Postgres's 65,535 parameter limit and keeps each transaction short.
const INSERT_CHUNK_SIZE = 1000;
// Only this many flagged rows are sent back to the screen, so the browser
// never has to draw thousands of rows. The true count is always returned.
const MAX_PROBLEM_ROWS_RETURNED = 500;

// Same lengths as the columns in the Disciple entity. Checking up front means
// one oversized value can't make a whole batch of 1,000 rows fail.
const MAX_LEN = {
  familyName: 150,
  otherNames: 150,
  phoneNumber: 30,
  email: 150,
  city: 150,
  fellowshipChurch: 200,
} as const;

// The exact column headers the downloadable template uses. Kept in one
// place (mirrored in the frontend's template generator) so the two never
// drift apart -- sheet_to_json below reads whatever headers are actually
// in row 1, so as long as the person doesn't rename columns, this list
// is just documentation for what parseRow expects to find.
export const IMPORT_TEMPLATE_COLUMNS = [
  'familyName', 'otherNames', 'gender', 'dateOfBirth',
  'phoneNumber', 'email', 'city', 'fellowshipChurch',
  'continent', 'country', 'center', 'site',
  'graduationYear', 'trainingMode', 'trainingLanguage',
] as const;

interface NamedEntity {
  id: number;
  name: string;
}

interface SuggestionDTO {
  id: number;
  name: string;
  score: number;
}

interface ParsedRowResult {
  rowNumber: number; // 1-based, matches the data row in the spreadsheet (header excluded)
  raw: Record<string, string>;
  status: 'ready' | 'needs_review' | 'invalid';
  errors: string[];
  suggestions: {
    continent?: SuggestionDTO[];
    country?: SuggestionDTO[];
    center?: SuggestionDTO[];
    site?: SuggestionDTO[];
    trainingLanguage?: SuggestionDTO[];
  };
  // Whichever levels of continent/country/center DID resolve, even if a
  // level further down (e.g. site) didn't. Lets the frontend pre-select
  // the cascading dropdowns as far as they can go instead of making the
  // person re-pick everything from scratch for a row that only had one
  // typo'd field.
  resolvedIds: {
    continentId?: number;
    countryId?: number;
    centerId?: number;
    siteId?: number;
  };
  // Already in the exact shape POST /disciples expects. When status is
  // 'ready' this can be submitted as-is. When 'needs_review' or
  // 'invalid', the frontend lets the person fix the offending fields
  // (via the normal cascading location dropdowns) before it's usable --
  // see DiscipleExcelImportPage.js's per-row edit panel.
  payload: {
    familyName: string;
    otherNames?: string;
    gender?: string;
    dateOfBirth?: string;
    phoneNumber?: string;
    email?: string;
    city?: string;
    fellowshipChurch?: string;
    trainingSiteId?: number;
    training: {
      graduationYear?: number;
      trainingMode?: string;
      trainingLanguageId?: number;
    };
  };
}

// Internal-only extras used while deciding a row's status. Stripped before
// anything is sent to the browser.
interface ResolvedRow extends ParsedRowResult {
  locationErrors: string[];
  otherErrors: string[];
  unfixable: boolean;
}

function toDTO(r: ResolvedRow): ParsedRowResult {
  return {
    rowNumber: r.rowNumber,
    raw: r.raw,
    status: r.status,
    errors: r.errors,
    suggestions: r.suggestions,
    resolvedIds: r.resolvedIds,
    payload: r.payload,
  };
}

function normalizeEnum(
  value: string,
  allowed: string[]
): { matched?: string; suggestions: string[] } {
  if (!value?.trim()) return { suggestions: [] };
  const exact = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  if (exact) return { matched: exact, suggestions: [] };
  const suggestions = allowed
    .map((a) => ({ a, score: similarity(value, a) }))
    .filter((x) => x.score >= 0.4)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
  return { suggestions };
}

function exactMatch<T extends NamedEntity>(value: string, items: T[]): T | undefined {
  if (!value?.trim()) return undefined;
  const wanted = value.trim().toLowerCase();
  return items.find((i) => i.name.trim().toLowerCase() === wanted);
}

/**
 * Accepts YYYY-MM-DD, or anything JavaScript can read as a date (Excel often
 * hands over things like 1/15/90). Always returns YYYY-MM-DD so Postgres
 * never receives a string it can't store -- one bad date would otherwise make
 * a whole batch fail.
 */
function normalizeDateOfBirth(value: string): { value?: string; error?: string } {
  if (!value) return {};
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = iso ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `Date of birth "${value}" is not a valid date (use YYYY-MM-DD).` };
  }
  const y = iso ? parsed.getUTCFullYear() : parsed.getFullYear();
  const m = (iso ? parsed.getUTCMonth() : parsed.getMonth()) + 1;
  const d = iso ? parsed.getUTCDate() : parsed.getDate();
  const out = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (iso && out !== value) {
    return { error: `Date of birth "${value}" is not a valid date (use YYYY-MM-DD).` };
  }
  if (y < 1900 || y > new Date().getFullYear()) {
    return { error: `Date of birth "${value}" is outside a sensible range.` };
  }
  return { value: out };
}

// ─── Reading the file ────────────────────────────────────────────────────────
function readImportRows(
  file: Express.Multer.File | undefined,
  maxRows: number,
  tooManyHint: string
): { rows: Record<string, unknown>[] } | { error: string } {
  if (!file) {
    return { error: 'No file was uploaded. Please attach an .xlsx file.' };
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file.buffer, { type: 'buffer' });
  } catch {
    return { error: 'Could not read this file. Please upload a valid .xlsx or .xls file.' };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { error: 'The uploaded file has no sheets.' };
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: '',
    raw: false,
  });

  if (rows.length === 0) {
    return { error: 'The uploaded file has no data rows.' };
  }
  if (rows.length > maxRows) {
    return {
      error: `This file has too many rows (max ${maxRows.toLocaleString()} per import). ${tooManyHint}`,
    };
  }
  return { rows };
}

// ─── Reference data (loaded once per request) ───────────────────────────────
interface ReferenceData {
  continents: Continent[];
  countries: Country[];
  centers: Center[];
  sites: Site[];
  languages: Language[];
  countriesByContinent: Map<number, Country[]>;
  centersByCountry: Map<number, Center[]>;
  sitesByCenter: Map<number, Site[]>;
  // "Did you mean...?" lookups are the slow part of resolving a row. The same
  // typo usually appears hundreds of times in a big file, so each distinct
  // (kind, scope, text) is only worked out once.
  suggestionCache: Map<string, SuggestionDTO[]>;
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

async function loadReferenceData(): Promise<ReferenceData> {
  const [continents, countries, centers, sites, languages] = await Promise.all([
    AppDataSource.getRepository(Continent).find(),
    AppDataSource.getRepository(Country).find(),
    AppDataSource.getRepository(Center).find(),
    AppDataSource.getRepository(Site).find(),
    AppDataSource.getRepository(Language).find(),
  ]);
  return {
    continents,
    countries,
    centers,
    sites,
    languages,
    countriesByContinent: groupBy(countries, (c) => c.continentId),
    centersByCountry: groupBy(centers, (c) => c.countryId),
    sitesByCenter: groupBy(sites, (s) => s.centerId),
    suggestionCache: new Map(),
  };
}

function suggestionsFor<T extends NamedEntity>(
  ref: ReferenceData,
  kind: string,
  scopeId: number | string,
  value: string,
  items: T[]
): SuggestionDTO[] {
  const cacheKey = `${kind}|${scopeId}|${value.trim().toLowerCase()}`;
  const cached = ref.suggestionCache.get(cacheKey);
  if (cached) return cached;
  const result = findBestMatches(value, items, (i) => i.name).map((m) => ({
    id: m.item.id,
    name: m.item.name,
    score: Math.round(m.score * 100) / 100,
  }));
  ref.suggestionCache.set(cacheKey, result);
  return result;
}

// ─── Turning one spreadsheet row into a result ──────────────────────────────
function resolveRow(
  raw: Record<string, unknown>,
  index: number,
  ref: ReferenceData
): ResolvedRow {
  const get = (key: string) => String(raw[key] ?? '').trim();

  const familyName = get('familyName');
  const otherNames = get('otherNames');
  const genderRaw = get('gender');
  const dateOfBirthRaw = get('dateOfBirth');
  const phoneNumber = get('phoneNumber');
  const email = get('email');
  const city = get('city');
  const fellowshipChurch = get('fellowshipChurch');
  const continentText = get('continent');
  const countryText = get('country');
  const centerText = get('center');
  const siteText = get('site');
  const graduationYearRaw = get('graduationYear');
  const trainingModeRaw = get('trainingMode');
  const trainingLanguageRaw = get('trainingLanguage');

  const dataErrors: string[] = []; // blank/oversized/invalid values that need retyping
  const locationErrors: string[] = [];
  const otherErrors: string[] = [];
  const suggestions: ParsedRowResult['suggestions'] = {};

  if (!familyName) dataErrors.push('Family name is required.');

  const graduationYear = parseInt(graduationYearRaw, 10);
  if (!graduationYearRaw || Number.isNaN(graduationYear)) {
    dataErrors.push('Graduation year is required and must be a number.');
  } else if (graduationYear < 1900 || graduationYear > 2100) {
    dataErrors.push(`Graduation year "${graduationYearRaw}" is not a sensible year.`);
  }

  const tooLong: Array<[string, string, number]> = [
    ['Family name', familyName, MAX_LEN.familyName],
    ['Other names', otherNames, MAX_LEN.otherNames],
    ['Phone number', phoneNumber, MAX_LEN.phoneNumber],
    ['Email', email, MAX_LEN.email],
    ['City', city, MAX_LEN.city],
    ['Fellowship church', fellowshipChurch, MAX_LEN.fellowshipChurch],
  ];
  for (const [label, value, max] of tooLong) {
    if (value.length > max) dataErrors.push(`${label} is longer than ${max} characters.`);
  }

  const dob = normalizeDateOfBirth(dateOfBirthRaw);
  if (dob.error) dataErrors.push(dob.error);

  // ---- Location chain: continent -> country -> center -> site ----
  let resolvedContinent: Continent | undefined;
  if (!continentText) {
    locationErrors.push('Continent is required.');
  } else {
    resolvedContinent = exactMatch(continentText, ref.continents);
    if (!resolvedContinent) {
      suggestions.continent = suggestionsFor(ref, 'continent', 0, continentText, ref.continents);
      locationErrors.push(`Continent "${continentText}" was not found.`);
    }
  }

  const countriesInScope = resolvedContinent
    ? ref.countriesByContinent.get(resolvedContinent.id) ?? []
    : ref.countries;
  let resolvedCountry: Country | undefined;
  if (!countryText) {
    locationErrors.push('Country is required.');
  } else {
    resolvedCountry = exactMatch(countryText, countriesInScope);
    if (!resolvedCountry) {
      suggestions.country = suggestionsFor(
        ref, 'country', resolvedContinent?.id ?? 'all', countryText, countriesInScope
      );
      locationErrors.push(
        `Country "${countryText}" was not found${resolvedContinent ? ` under ${resolvedContinent.name}` : ''}.`
      );
    }
  }

  const centersInScope = resolvedCountry
    ? ref.centersByCountry.get(resolvedCountry.id) ?? []
    : ref.centers;
  let resolvedCenter: Center | undefined;
  if (!centerText) {
    locationErrors.push('Center is required.');
  } else {
    resolvedCenter = exactMatch(centerText, centersInScope);
    if (!resolvedCenter) {
      suggestions.center = suggestionsFor(
        ref, 'center', resolvedCountry?.id ?? 'all', centerText, centersInScope
      );
      locationErrors.push(
        `Center "${centerText}" was not found${resolvedCountry ? ` under ${resolvedCountry.name}` : ''}.`
      );
    }
  }

  let resolvedSite: Site | undefined;
  if (resolvedCenter) {
    const sitesInCenter = ref.sitesByCenter.get(resolvedCenter.id) ?? [];
    if (!siteText && sitesInCenter.length === 1 && sitesInCenter[0].isDefault) {
      // Same rule the manual form uses: a center with only its
      // auto-created default site never requires a site name.
      resolvedSite = sitesInCenter[0];
    } else if (siteText) {
      resolvedSite = exactMatch(siteText, sitesInCenter);
      if (!resolvedSite) {
        suggestions.site = suggestionsFor(ref, 'site', resolvedCenter.id, siteText, sitesInCenter);
        locationErrors.push(`Site "${siteText}" was not found under ${resolvedCenter.name}.`);
      }
    } else if (sitesInCenter.length > 1) {
      locationErrors.push(`${resolvedCenter.name} has multiple sites -- please specify which one.`);
    } else if (sitesInCenter.length === 0) {
      locationErrors.push(`${resolvedCenter.name} has no sites configured yet.`);
    }
  }

  // ---- Enum-style fields ----
  const genderMatch = normalizeEnum(genderRaw, GENDERS);
  if (genderRaw && !genderMatch.matched) {
    otherErrors.push(`Gender "${genderRaw}" is not recognized (expected Male or Female).`);
  }
  const modeMatch = normalizeEnum(trainingModeRaw, TRAINING_MODES);
  if (trainingModeRaw && !modeMatch.matched) {
    otherErrors.push(`Training mode "${trainingModeRaw}" is not recognized (expected Online or In-person).`);
  }

  let resolvedLanguage: Language | undefined;
  if (trainingLanguageRaw) {
    resolvedLanguage = exactMatch(trainingLanguageRaw, ref.languages);
    if (!resolvedLanguage) {
      suggestions.trainingLanguage = suggestionsFor(
        ref, 'language', 0, trainingLanguageRaw, ref.languages
      );
      otherErrors.push(`Training language "${trainingLanguageRaw}" was not found.`);
    }
  }

  // A blank/oversized/invalid value can't be fixed by picking a dropdown
  // suggestion -- those rows need actual retyping, so they're flagged
  // distinctly ('invalid') from a location typo ('needs_review').
  const unfixable = dataErrors.length > 0;
  const errors = [...dataErrors, ...locationErrors, ...otherErrors];
  const status: ParsedRowResult['status'] = unfixable
    ? 'invalid'
    : errors.length > 0
    ? 'needs_review'
    : 'ready';

  return {
    rowNumber: index + 1,
    raw: {
      familyName, otherNames, gender: genderRaw,
      dateOfBirth: dateOfBirthRaw, phoneNumber, email, city, fellowshipChurch,
      continent: continentText, country: countryText, center: centerText, site: siteText,
      graduationYear: graduationYearRaw, trainingMode: trainingModeRaw,
      trainingLanguage: trainingLanguageRaw,
    },
    status,
    errors,
    suggestions,
    resolvedIds: {
      continentId: resolvedContinent?.id,
      countryId: resolvedCountry?.id,
      centerId: resolvedCenter?.id,
      siteId: resolvedSite?.id,
    },
    payload: {
      familyName,
      otherNames: otherNames || undefined,
      gender: genderMatch.matched,
      dateOfBirth: dob.value,
      phoneNumber: phoneNumber || undefined,
      email: email || undefined,
      city: city || undefined,
      fellowshipChurch: fellowshipChurch || undefined,
      trainingSiteId: resolvedSite?.id,
      training: {
        graduationYear: Number.isNaN(graduationYear) ? undefined : graduationYear,
        trainingMode: modeMatch.matched,
        trainingLanguageId: resolvedLanguage?.id,
      },
    },
    locationErrors,
    otherErrors,
    unfixable,
  };
}

/**
 * Site-scoped users (teacher, leader, ...) can only ever add disciples to
 * their own site -- exactly the rule createDisciple applies. For them the
 * location columns in the file don't matter, so location problems are
 * ignored and the row goes to their own site.
 */
function applySiteScope(row: ResolvedRow, scopedSiteId: number): void {
  row.payload.trainingSiteId = scopedSiteId;
  row.resolvedIds.siteId = scopedSiteId;
  row.errors = [...row.errors.filter((e) => !row.locationErrors.includes(e))];
  row.locationErrors = [];
  row.status = row.unfixable ? 'invalid' : row.errors.length > 0 ? 'needs_review' : 'ready';
}

function getSiteScope(req: Request): number | null {
  if (!req.user || !isSiteScopedRole(req.user.roleName)) return null;
  return req.user.siteId ?? null;
}

// ─── Old endpoint: read-only preview, small files only ──────────────────────
/**
 * Reads an uploaded .xlsx/.xls file and, for every row, tries to resolve the
 * plain-text continent/country/center/site chain down to a concrete
 * trainingSiteId. NEVER writes to the database. Kept for small files; the
 * import page now uses commitDiscipleImport below, which scales to 20,000
 * rows.
 */
export async function parseDiscipleImport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const read = readImportRows(
      req.file,
      PREVIEW_ONLY_MAX_ROWS,
      'Use the bulk import for larger files.'
    );
    if ('error' in read) {
      res.status(400).json({ error: read.error });
      return;
    }

    const ref = await loadReferenceData();
    const results = read.rows.map((raw, index) => resolveRow(raw, index, ref));

    res.json({
      totalRows: results.length,
      readyCount: results.filter((r) => r.status === 'ready').length,
      needsReviewCount: results.filter((r) => r.status === 'needs_review').length,
      invalidCount: results.filter((r) => r.status === 'invalid').length,
      rows: results.map(toDTO),
    });
  } catch (err) {
    next(err);
  }
}

// ─── Bulk import ─────────────────────────────────────────────────────────────
function duplicateKey(p: ParsedRowResult['payload']): string {
  return [
    p.familyName.trim().toLowerCase(),
    (p.otherNames ?? '').trim().toLowerCase(),
    (p.phoneNumber ?? '').trim(),
    p.training.graduationYear ?? '',
    p.trainingSiteId ?? '',
  ].join('|');
}

/**
 * Keys of every disciple already in the database (name + phone + graduation
 * year + site). Used to skip rows that are already there, so uploading the
 * same file twice -- or re-uploading after a partial failure -- can't create
 * duplicates.
 */
async function loadExistingKeys(): Promise<Set<string>> {
  const existing: Array<{
    family_name: string;
    other_names: string | null;
    phone_number: string | null;
    training_site_id: number | null;
    graduation_year: number;
  }> = await AppDataSource.query(
    `SELECT d.family_name, d.other_names, d.phone_number, d.training_site_id, t.graduation_year
       FROM disciples d
       JOIN trainings t ON t.disciple_id = d.id`
  );
  const keys = new Set<string>();
  for (const e of existing) {
    keys.add(
      [
        e.family_name.trim().toLowerCase(),
        (e.other_names ?? '').trim().toLowerCase(),
        (e.phone_number ?? '').trim(),
        e.graduation_year,
        e.training_site_id ?? '',
      ].join('|')
    );
  }
  return keys;
}

async function insertRows(
  manager: EntityManager,
  rows: ResolvedRow[],
  createdById: number
): Promise<void> {
  const discipleInsert = await manager
    .createQueryBuilder()
    .insert()
    .into(Disciple)
    .values(
      rows.map((r) => ({
        familyName: r.payload.familyName,
        otherNames: r.payload.otherNames,
        gender: r.payload.gender as Gender | undefined,
        dateOfBirth: r.payload.dateOfBirth ?? null,
        phoneNumber: r.payload.phoneNumber,
        email: r.payload.email,
        city: r.payload.city,
        fellowshipChurch: r.payload.fellowshipChurch,
        trainingSiteId: r.payload.trainingSiteId,
        createdById,
      }))
    )
    .execute();

  const ids = discipleInsert.identifiers.map((i) => i.id as number);
  if (ids.length !== rows.length) {
    throw new Error(`Expected ${rows.length} new ids, got ${ids.length}`);
  }

  await manager
    .createQueryBuilder()
    .insert()
    .into(Training)
    .values(
      rows.map((r, i) => ({
        discipleId: ids[i],
        graduationYear: r.payload.training.graduationYear as number,
        trainingMode: r.payload.training.trainingMode as TrainingMode | undefined,
        trainingLanguageId: r.payload.training.trainingLanguageId,
        trainingSiteId: r.payload.trainingSiteId,
      }))
    )
    .execute();
}

/**
 * Bulk import. Handles up to MAX_IMPORT_ROWS rows without making the server
 * or the browser struggle:
 *  - the file is read ONCE and every row resolved in memory (location lists
 *    are loaded once, suggestions are cached);
 *  - rows that are fully valid are saved in batches of INSERT_CHUNK_SIZE
 *    (one multi-row INSERT per table, per batch), instead of one request per
 *    row;
 *  - only the rows that need a person's attention are sent back, capped at
 *    MAX_PROBLEM_ROWS_RETURNED, so the screen stays fast.
 *
 * Call with ?dryRun=true first to see the counts without saving anything.
 */
export async function commitDiscipleImport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const startedAt = Date.now();
    const dryRun = String(req.query.dryRun ?? '') === 'true';

    const read = readImportRows(
      req.file,
      MAX_IMPORT_ROWS,
      'Please split it into smaller files.'
    );
    if ('error' in read) {
      res.status(400).json({ error: read.error });
      return;
    }

    const ref = await loadReferenceData();
    const scopedSiteId = getSiteScope(req);

    const resolved = read.rows.map((raw, index) => {
      const row = resolveRow(raw, index, ref);
      if (scopedSiteId) applySiteScope(row, scopedSiteId);
      return row;
    });

    const existingKeys = await loadExistingKeys();

    const ready: ResolvedRow[] = [];
    const problems: ResolvedRow[] = [];
    let skippedDuplicates = 0;

    for (const row of resolved) {
      if (row.status !== 'ready') {
        problems.push(row);
        continue;
      }
      const key = duplicateKey(row.payload);
      if (existingKeys.has(key)) {
        // Already saved earlier, or repeated inside this same file.
        skippedDuplicates++;
        continue;
      }
      existingKeys.add(key);
      ready.push(row);
    }

    let savedCount = 0;

    if (!dryRun) {
      const userId = req.user!.id;

      for (let i = 0; i < ready.length; i += INSERT_CHUNK_SIZE) {
        const chunk = ready.slice(i, i + INSERT_CHUNK_SIZE);
        try {
          await AppDataSource.transaction((manager) => insertRows(manager, chunk, userId));
          savedCount += chunk.length;
        } catch (batchErr) {
          // Something in this batch was rejected. Retry the rows one at a
          // time so one bad row only costs that row, not the whole batch.
          console.error('[import] batch failed, retrying row by row:', batchErr);
          for (const row of chunk) {
            try {
              await AppDataSource.transaction((manager) => insertRows(manager, [row], userId));
              savedCount++;
            } catch (rowErr) {
              console.error(`[import] row ${row.rowNumber} failed:`, rowErr);
              row.status = 'needs_review';
              row.errors = ['Could not be saved -- please review and try again.'];
              problems.push(row);
            }
          }
        }
      }
    }

    problems.sort((a, b) => a.rowNumber - b.rowNumber);

    console.log(
      `[import] ${dryRun ? 'dry run' : 'saved'}: ${read.rows.length} rows read, ` +
        `${dryRun ? ready.length + ' ready' : savedCount + ' saved'}, ` +
        `${skippedDuplicates} duplicates skipped, ${problems.length} need attention ` +
        `(${Date.now() - startedAt} ms)`
    );

    res.json({
      dryRun,
      totalRows: read.rows.length,
      readyCount: ready.length,
      savedCount,
      skippedDuplicates,
      needsAttentionCount: problems.length,
      rows: problems.slice(0, MAX_PROBLEM_ROWS_RETURNED).map(toDTO),
      rowsTruncated: problems.length > MAX_PROBLEM_ROWS_RETURNED,
    });
  } catch (err) {
    next(err);
  }
}