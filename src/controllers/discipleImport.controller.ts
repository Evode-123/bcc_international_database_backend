import { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { AppDataSource } from '../config/data-source';
import { Continent } from '../entities/Continent';
import { Country } from '../entities/Country';
import { Center } from '../entities/Center';
import { Site } from '../entities/Site';
import { Language } from '../entities/Language';
import { findBestMatches, similarity } from '../utils/stringSimilarity.util';

const GENDERS = ['Male', 'Female'];
const TRAINING_MODES = ['Online', 'In-person'];

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
  return items.find((i) => i.name.trim().toLowerCase() === value.trim().toLowerCase());
}

function toSuggestionDTOs<T extends NamedEntity>(
  value: string,
  items: T[]
): SuggestionDTO[] {
  return findBestMatches(value, items, (i) => i.name).map((m) => ({
    id: m.item.id,
    name: m.item.name,
    score: Math.round(m.score * 100) / 100,
  }));
}

/**
 * Reads an uploaded .xlsx/.xls file (multer memory storage puts the raw
 * bytes on req.file.buffer) and, for every row, tries to resolve the
 * plain-text continent/country/center/site chain down to a concrete
 * trainingSiteId -- exactly the single FK the disciples table needs.
 *
 * This endpoint NEVER writes to the database. It only reads the existing
 * location tree and reports, per row, whether everything resolved
 * cleanly ('ready'), needs a person to pick between suggestions
 * ('needs_review'), or is missing something a location pick alone can't
 * fix, like a blank family name ('invalid'). Actually saving disciples
 * happens afterwards, one row at a time, via the existing
 * POST /disciples endpoint -- this keeps import saves going through the
 * exact same validated path as the manual "Add disciple" form.
 */
export async function parseDiscipleImport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file was uploaded. Please attach an .xlsx file.' });
      return;
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer' });
    } catch {
      res.status(400).json({
        error: 'Could not read this file. Please upload a valid .xlsx or .xls file.',
      });
      return;
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      res.status(400).json({ error: 'The uploaded file has no sheets.' });
      return;
    }

    const sheet = workbook.Sheets[sheetName];
    const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
      defval: '',
      raw: false,
    });

    if (rawRows.length === 0) {
      res.status(400).json({ error: 'The uploaded file has no data rows.' });
      return;
    }
    if (rawRows.length > 1000) {
      res.status(400).json({
        error: 'This file has too many rows (max 1000 per import). Please split it into smaller files.',
      });
      return;
    }

    // Load the whole location tree + languages once, up front -- far
    // cheaper than querying per row for a file with hundreds of rows.
    const [continents, countries, centers, sites, languages] = await Promise.all([
      AppDataSource.getRepository(Continent).find(),
      AppDataSource.getRepository(Country).find(),
      AppDataSource.getRepository(Center).find(),
      AppDataSource.getRepository(Site).find(),
      AppDataSource.getRepository(Language).find(),
    ]);

    const results: ParsedRowResult[] = rawRows.map((raw, index) => {
      const get = (key: string) => String(raw[key] ?? '').trim();

      const familyName = get('familyName');
      const otherNames = get('otherNames');
      const genderRaw = get('gender');
      const dateOfBirth = get('dateOfBirth');
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

      const errors: string[] = [];
      const suggestions: ParsedRowResult['suggestions'] = {};

      if (!familyName) errors.push('Family name is required.');

      const graduationYear = parseInt(graduationYearRaw, 10);
      if (!graduationYearRaw || Number.isNaN(graduationYear)) {
        errors.push('Graduation year is required and must be a number.');
      }

      // ---- Location chain: continent -> country -> center -> site ----
      let resolvedContinent: Continent | undefined;
      if (!continentText) {
        errors.push('Continent is required.');
      } else {
        resolvedContinent = exactMatch(continentText, continents);
        if (!resolvedContinent) {
          suggestions.continent = toSuggestionDTOs(continentText, continents);
          errors.push(`Continent "${continentText}" was not found.`);
        }
      }

      const countriesInScope = resolvedContinent
        ? countries.filter((c) => c.continentId === resolvedContinent!.id)
        : countries;
      let resolvedCountry: Country | undefined;
      if (!countryText) {
        errors.push('Country is required.');
      } else {
        resolvedCountry = exactMatch(countryText, countriesInScope);
        if (!resolvedCountry) {
          suggestions.country = toSuggestionDTOs(countryText, countriesInScope);
          errors.push(
            `Country "${countryText}" was not found${resolvedContinent ? ` under ${resolvedContinent.name}` : ''}.`
          );
        }
      }

      const centersInScope = resolvedCountry
        ? centers.filter((c) => c.countryId === resolvedCountry!.id)
        : centers;
      let resolvedCenter: Center | undefined;
      if (!centerText) {
        errors.push('Center is required.');
      } else {
        resolvedCenter = exactMatch(centerText, centersInScope);
        if (!resolvedCenter) {
          suggestions.center = toSuggestionDTOs(centerText, centersInScope);
          errors.push(
            `Center "${centerText}" was not found${resolvedCountry ? ` under ${resolvedCountry.name}` : ''}.`
          );
        }
      }

      let resolvedSite: Site | undefined;
      if (resolvedCenter) {
        const sitesInCenter = sites.filter((s) => s.centerId === resolvedCenter!.id);
        if (!siteText && sitesInCenter.length === 1 && sitesInCenter[0].isDefault) {
          // Same rule the manual form uses: a center with only its
          // auto-created default site never requires a site name.
          resolvedSite = sitesInCenter[0];
        } else if (siteText) {
          resolvedSite = exactMatch(siteText, sitesInCenter);
          if (!resolvedSite) {
            suggestions.site = toSuggestionDTOs(siteText, sitesInCenter);
            errors.push(`Site "${siteText}" was not found under ${resolvedCenter.name}.`);
          }
        } else if (sitesInCenter.length > 1) {
          errors.push(`${resolvedCenter.name} has multiple sites -- please specify which one.`);
        } else if (sitesInCenter.length === 0) {
          errors.push(`${resolvedCenter.name} has no sites configured yet.`);
        }
      }

      // ---- Enum-style fields ----
      const genderMatch = normalizeEnum(genderRaw, GENDERS);
      if (genderRaw && !genderMatch.matched) {
        errors.push(`Gender "${genderRaw}" is not recognized (expected Male or Female).`);
      }
      const modeMatch = normalizeEnum(trainingModeRaw, TRAINING_MODES);
      if (trainingModeRaw && !modeMatch.matched) {
        errors.push(`Training mode "${trainingModeRaw}" is not recognized (expected Online or In-person).`);
      }

      let resolvedLanguage: Language | undefined;
      if (trainingLanguageRaw) {
        resolvedLanguage = exactMatch(trainingLanguageRaw, languages);
        if (!resolvedLanguage) {
          suggestions.trainingLanguage = toSuggestionDTOs(trainingLanguageRaw, languages);
          errors.push(`Training language "${trainingLanguageRaw}" was not found.`);
        }
      }

      // A blank family name or graduation year can't be fixed by picking
      // a dropdown suggestion -- those rows need actual retyping, so
      // they're flagged distinctly ('invalid') from a location typo
      // ('needs_review'), even though both show up as red/yellow in the
      // UI's pending list.
      const hasUnfixableErrors = !familyName || !graduationYearRaw || Number.isNaN(graduationYear);
      const status: ParsedRowResult['status'] = hasUnfixableErrors
        ? 'invalid'
        : errors.length > 0
        ? 'needs_review'
        : 'ready';

      return {
        rowNumber: index + 1,
        raw: {
          familyName, otherNames, gender: genderRaw,
          dateOfBirth, phoneNumber, email, city, fellowshipChurch,
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
          dateOfBirth: dateOfBirth || undefined,
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
      };
    });

    res.json({
      totalRows: results.length,
      readyCount: results.filter((r) => r.status === 'ready').length,
      needsReviewCount: results.filter((r) => r.status === 'needs_review').length,
      invalidCount: results.filter((r) => r.status === 'invalid').length,
      rows: results,
    });
  } catch (err) {
    next(err);
  }
}