/**
 * Recursive Population SQL Compiler for Indicators
 *
 * This module implements a recursive compiler that builds population SQL
 * directly from indicator configuration, avoiding the fragile approach of
 * parsing/modifying generated SQL queries.
 *
 * Key design principles:
 * 1. Every indicator (atomic or composite) compiles to population SQL whose output column
 *    is always aliased AS patient_id (see convertCountToPopulation), regardless of the
 *    source indicator's configured id column
 * 2. Scalar counts and disaggregations are wrappers around population SQL
 * 3. Nested composite indicators are handled recursively
 * 4. Circular dependencies are detected
 * 5. Missing references are validated
 */

import type { IndicatorDto } from '../../../resources/indicator/indicators.api';
import type { CompositeOperator } from '../types/composite-indicator.types';

/**
 * Result of compiling an indicator to population SQL.
 */
export type PopulationCompileResult = {
    /** The population SQL that returns the patient ID column */
    sql: string;
    /** The column name used for patient identification (e.g., 'client_id', 'patient_id', 'encounter_id') */
    patientIdColumn: string;
    /** Any warnings or information about the compilation */
    warnings?: string[];
    /** Whether this indicator was retired (for informational purposes) */
    retired?: boolean;
    /** Compilation error, if any */
    error?: PopulationSqlError;
};

/**
 * Error codes for population SQL compilation failures.
 */
export const POPULATION_ERRORS = {
    AGGREGATE_SQL: 'AGGREGATE_SQL',
    ID_NOT_EXPOSED: 'ID_NOT_EXPOSED',
    EMPTY_SQL: 'EMPTY_SQL',
    COMPILATION_FAILED: 'COMPILATION_FAILED'
} as const;

/**
 * Compiler options for population SQL generation.
 */
export type CompilerOptions = {
    /** Whether to allow using retired indicators as operands */
    allowRetired?: boolean;
    /** Maximum nesting depth to prevent infinite recursion (default: 10) */
    maxDepth?: number;
};

/**
 * Circular dependency error.
 */
export class CircularDependencyError extends Error {
    constructor(public chain: string[]) {
        super(`Circular indicator dependency detected: ${chain.join(' → ')}`);
        this.name = 'CircularDependencyError';
    }
}

/**
 * Missing reference error.
 */
export class MissingReferenceError extends Error {
    constructor(
        public parentIndicator: string,
        public missingRef: string,
        public refType: 'indicatorAId' | 'indicatorBId'
    ) {
        super(`Missing ${refType} in indicator ${parentIndicator}: ${missingRef}`);
        this.name = 'MissingReferenceError';
    }
}

/**
 * Unsupported operator error.
 */
export class UnsupportedOperatorError extends Error {
    constructor(
        public indicator: string,
        public operator: string
    ) {
        super(`Unsupported operator '${operator}' in indicator ${indicator}`);
        this.name = 'UnsupportedOperatorError';
    }
}

/**
 * Population SQL error.
 * Used when the compiler produces invalid SQL (aggregate instead of population).
 */
export class PopulationSqlError extends Error {
    constructor(
        public code: string,
        message: string,
        public indicator?: { uuid: string; name: string; code: string }
    ) {
        super(message);
        this.name = 'PopulationSqlError';
    }
}

/**
 * Atomic indicator compilation error.
 */
export class AtomicIndicatorError extends Error {
    constructor(
        public indicator: string,
        public reason: string
    ) {
        super(`Cannot compile atomic indicator ${indicator}: ${reason}`);
        this.name = 'AtomicIndicatorError';
    }
}

/**
 * Configuration for a composite indicator from config_json.
 */
type CompositeIndicatorConfig = {
    version?: number;
    unit?: 'Patients' | 'Encounters';
    operator?: CompositeOperator;
    indicatorAId?: string;
    indicatorBId?: string;
    indicatorACode?: string;
    indicatorBCode?: string;
    // Legacy fields that might be present
    sqlPreview?: string;
    sqlTemplate?: string;
    base?: {
        sqlPreview?: string;
        sqlTemplate?: string;
        themeConfig?: {
            patientIdColumn?: string;
        };
    };
    themeConfig?: {
        patientIdColumn?: string;
    };
    authoring?: {
        base?: {
            sqlPreview?: string;
            sqlTemplate?: string;
            themeConfig?: {
                patientIdColumn?: string;
            };
        };
    };
    baseIndicator?: {
        sqlPreview?: string;
        sqlTemplate?: string;
        themeConfig?: {
            patientIdColumn?: string;
        };
    };
};

type ValidationResult = {
    valid: boolean;
    error?: { code: string; message: string };
};

/**
 * Validates that SQL is proper population SQL (not aggregate).
 *
 * Population SQL must:
 * 1. Expose the patient ID column in the SELECT clause
 * 2. Not be an aggregate query (COUNT, SUM, AVG in final projection)
 * 3. Be a SELECT statement (may start with WITH CTEs)
 *
 * @param sql - The SQL to validate
 * @param patientIdColumn - The patient ID column name that should be exposed
 * @returns Validation result
 */
function validatePopulationSql(sql: string, patientIdColumn: string): ValidationResult {
    const trimmed = sql.trim();

    // Check for empty SQL
    if (!trimmed) {
        return {
            valid: false,
            error: { code: POPULATION_ERRORS.EMPTY_SQL, message: 'Population SQL is empty' }
        };
    }

    // Check it's a SELECT statement (may have WITH CTEs first)
    const upperSql = trimmed.toUpperCase();
    if (!upperSql.startsWith('WITH') && !upperSql.startsWith('SELECT')) {
        return {
            valid: false,
            error: { code: POPULATION_ERRORS.COMPILATION_FAILED, message: 'Population SQL must be a SELECT statement' }
        };
    }

    // Check for aggregate functions in final projection
    // This pattern matches SELECT COUNT(...), SELECT SUM(...), etc. at the start (after WITH)
    // Need to skip past WITH clauses when checking
    let sqlToCheck = trimmed;
    if (upperSql.startsWith('WITH')) {
        // Find the main SELECT after the CTEs
        const selectMatch = trimmed.match(/\)\s*SELECT\s+/i);
        if (selectMatch) {
            const selectIndex = trimmed.indexOf(selectMatch[0]) + selectMatch[0].length;
            sqlToCheck = trimmed.substring(selectIndex).trim();
        }
    }

    // Check for aggregate in final projection
    const aggregatePattern = /^SELECT\s+(?:COUNT|SUM|AVG|MAX|MIN)\s*\(/i;
    if (aggregatePattern.test(sqlToCheck)) {
        return {
            valid: false,
            error: {
                code: POPULATION_ERRORS.AGGREGATE_SQL,
                message: 'Population SQL cannot use aggregate functions (COUNT, SUM, AVG) in final projection. Use SELECT DISTINCT instead.'
            }
        };
    }

    // Check that patient ID column is exposed
    // Pattern should match SELECT DISTINCT ... patient_idColumn ... or SELECT ... AS patient_idColumn
    const columnPattern = new RegExp(
        `SELECT\\s+DISTINCT\\s+[\\w\\.]+\\s+AS\\s+${patientIdColumn}\\b|` +
        `SELECT\\s+DISTINCT\\s+(?:[\\w]+\\.)?${patientIdColumn}\\b`,
        'i'
    );

    // Also check if it's in the main SELECT (after WITH)
    if (upperSql.startsWith('WITH')) {
        const mainSelectPattern = new RegExp(`\\bSELECT\\s+DISTINCT\\s+(?:[\\w]+\\.)?${patientIdColumn}\\b`, 'i');
        if (!mainSelectPattern.test(trimmed) && !columnPattern.test(trimmed)) {
            return {
                valid: false,
                error: {
                    code: POPULATION_ERRORS.ID_NOT_EXPOSED,
                    message: `Population SQL must expose '${patientIdColumn}' column in the main SELECT (e.g., SELECT DISTINCT a.${patientIdColumn} AS ${patientIdColumn})`
                }
            };
        }
    } else if (!columnPattern.test(trimmed)) {
        return {
            valid: false,
            error: {
                code: POPULATION_ERRORS.ID_NOT_EXPOSED,
                message: `Population SQL must expose '${patientIdColumn}' column (e.g., SELECT DISTINCT a.${patientIdColumn} AS ${patientIdColumn})`
            }
        };
    }

    return { valid: true };
}

/**
 * Simple hash function for strings.
 * Used to create cache keys from SQL content.
 */
function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * Generates a cache key for an indicator.
 * Includes UUID, SQL content hash, and config hash to prevent stale results.
 */
function getCacheKey(indicator: IndicatorDto, options: CompilerOptions): string {
    const sqlHash = hashString(indicator.sqlTemplate || '');
    const configHash = hashString(indicator.configJson || '');
    const allowRetired = options.allowRetired ? 'allowRetired' : '';
    return `${indicator.uuid}|${sqlHash}|${configHash}|${allowRetired}`;
}

/**
 * Cache to avoid re-compiling the same indicator multiple times.
 * Map<cacheKey, PopulationCompileResult>
 */
const compilationCache = new Map<string, PopulationCompileResult>();

/**
 * Clear the compilation cache. Useful for testing or when indicators change.
 */
export function clearCompilationCache(): void {
    compilationCache.clear();
}

/**
 * Recursively compile an indicator to population SQL.
 *
 * This function follows these rules:
 * 1. Check cache first
 * 2. Detect circular dependencies
 * 3. Parse config_json to get configuration
 * 4. For COMPOSITE: recursively compile A and B, then combine
 * 5. For BASE: extract population SQL from sql_template
 * 6. Fix common typos like `:stratDate` -> `:startDate`
 *
 * @param indicator - The indicator to compile
 * @param getIndicator - Function to fetch referenced indicators by UUID
 * @param visited - Set of already-visited indicator UUIDs (for cycle detection)
 * @param options - Compiler options
 * @returns Population SQL that returns client_id
 */
export async function compilePopulationSql(
    indicator: IndicatorDto,
    getIndicator: (uuid: string) => Promise<IndicatorDto | null>,
    visited: Set<string> = new Set(),
    options: CompilerOptions = {}
): Promise<PopulationCompileResult> {
    const { allowRetired = false, maxDepth = 10 } = options;

    // Check cache using improved key (includes SQL content hash)
    const cacheKey = getCacheKey(indicator, options);
    if (compilationCache.has(cacheKey)) {
        return compilationCache.get(cacheKey)!;
    }

    // Check depth limit
    if (visited.size >= maxDepth) {
        throw new Error(`Maximum compilation depth ${maxDepth} exceeded. Possible circular dependency.`);
    }

    // Check for circular dependency
    if (visited.has(indicator.uuid)) {
        throw new CircularDependencyError([...visited, indicator.uuid]);
    }

    // Add to visited set
    const newVisited = new Set(visited);
    newVisited.add(indicator.uuid);

    // Check if retired
    if (indicator.retired && !allowRetired) {
        throw new Error(`Cannot use retired indicator ${indicator.code || indicator.uuid} as operand`);
    }

    const warnings: string[] = [];
    if (indicator.retired) {
        warnings.push(`Using retired indicator: ${indicator.code || indicator.name}`);
    }

    // Parse config_json
    let config: CompositeIndicatorConfig | null = null;
    try {
        config = indicator.configJson ? JSON.parse(indicator.configJson) : null;
    } catch (e) {
        warnings.push(`Failed to parse config_json: ${e}`);
    }

    // Handle different indicator types
    if (indicator.kind === 'COMPOSITE' && config) {
        // Composite indicator - compile recursively
        const result = await compileCompositePopulation(indicator, config, getIndicator, newVisited, options);
        result.warnings = [...warnings, ...(result.warnings || [])];
        compilationCache.set(cacheKey, result);
        return result;
    } else if (indicator.kind === 'BASE') {
        // Base indicator - extract population SQL
        const result = compileBasePopulation(indicator, config);
        result.warnings = warnings;
        compilationCache.set(cacheKey, result);
        return result;
    } else {
        // FINAL indicator or unsupported type
        // For FINAL indicators, we might need different handling
        // For now, try to extract population SQL like a base indicator
        try {
            const result = compileBasePopulation(indicator, config);
            result.warnings = [...warnings, 'FINAL indicator treated as BASE'];
            compilationCache.set(cacheKey, result);
            return result;
        } catch (e) {
            throw new AtomicIndicatorError(
                indicator.code || indicator.uuid,
                `Unsupported indicator kind: ${indicator.kind}`
            );
        }
    }
}

/**
 * Compile a composite indicator's population SQL.
 */
async function compileCompositePopulation(
    indicator: IndicatorDto,
    config: CompositeIndicatorConfig,
    getIndicator: (uuid: string) => Promise<IndicatorDto | null>,
    visited: Set<string>,
    options: CompilerOptions
): Promise<PopulationCompileResult> {
    const warnings: string[] = [];

    // Validate required fields
    if (!config.indicatorAId) {
        throw new MissingReferenceError(
            indicator.code || indicator.uuid,
            'missing',
            'indicatorAId'
        );
    }

    if (!config.indicatorBId) {
        throw new MissingReferenceError(
            indicator.code || indicator.uuid,
            'missing',
            'indicatorBId'
        );
    }

    if (!config.operator) {
        throw new UnsupportedOperatorError(indicator.code || indicator.uuid, 'missing');
    }

    // Get referenced indicators
    const indicatorA = await getIndicator(config.indicatorAId);
    const indicatorB = await getIndicator(config.indicatorBId);

    if (!indicatorA) {
        throw new MissingReferenceError(
            indicator.code || indicator.uuid,
            config.indicatorAId,
            'indicatorAId'
        );
    }

    if (!indicatorB) {
        throw new MissingReferenceError(
            indicator.code || indicator.uuid,
            config.indicatorBId,
            'indicatorBId'
        );
    }

    // Recursively compile operand A
    const resultA = await compilePopulationSql(indicatorA, getIndicator, visited, options);

    // Recursively compile operand B
    const resultB = await compilePopulationSql(indicatorB, getIndicator, visited, options);

    // Combine with the appropriate operator
    const sql = combineWithOperator(
        config.operator!,
        resultA.sql,
        resultB.sql
    );

    // Validate the combined SQL
    const validation = validatePopulationSql(sql, resultA.patientIdColumn);
    if (!validation.valid) {
        return {
            sql,
            patientIdColumn: resultA.patientIdColumn,
            warnings: [...warnings, ...(resultA.warnings || []), ...(resultB.warnings || [])],
            retired: indicator.retired,
            error: new PopulationSqlError(
                validation.error.code,
                validation.error.message,
                { uuid: indicator.uuid, name: indicator.name, code: indicator.code || indicator.uuid }
            )
        };
    }

    return {
        sql,
        patientIdColumn: resultA.patientIdColumn, // Use the patientIdColumn from operand A
        warnings: [...warnings, ...(resultA.warnings || []), ...(resultB.warnings || [])],
        retired: indicator.retired
    };
}

/**
 * Combine two population SQL queries with the given operator.
 *
 * Handles the case where population SQL may already contain WITH clauses
 * by using unique CTE names that won't conflict with inner CTEs.
 */
function combineWithOperator(
    operator: CompositeOperator,
    populationSqlA: string,
    populationSqlB: string
): string {
    // Contract: convertCountToPopulation normalizes ALL population SQL to expose a single
    // output column aliased AS patient_id, so the combine step must reference patient_id
    // regardless of the source indicators' configured id column or unit.
    const idField = 'patient_id';

    // Clean the SQL - remove trailing semicolons
    const cleanA = populationSqlA.trim().replace(/;+\s*$/, '');
    const cleanB = populationSqlB.trim().replace(/;+\s*$/, '');

    // Check if the population SQL contains WITH clauses (nested CTEs)
    const aHasWith = /^\s*WITH\s+/i.test(cleanA);
    const bHasWith = /^\s*WITH\s+/i.test(cleanB);

    // Use unique CTE names to avoid conflicts with inner CTEs
    // If the population SQL has WITH clauses, use more specific names
    const aName = aHasWith ? 'operand_a_base' : 'A';
    const bName = bHasWith ? 'operand_b_base' : 'B';

    if (operator === 'AND') {
        // Intersection: A INNER JOIN B on client_id
        return `
WITH ${aName} AS (
${indent(cleanA, 0)}
),
${bName} AS (
${indent(cleanB, 0)}
)
SELECT DISTINCT
    ${aName}.${idField}
FROM ${aName}
INNER JOIN ${bName}
    ON ${bName}.${idField} = ${aName}.${idField}
`.trim();
    } else if (operator === 'OR') {
        // Union: A UNION B
        return `
WITH ${aName} AS (
${indent(cleanA, 0)}
),
${bName} AS (
${indent(cleanB, 0)}
)
SELECT ${idField} FROM ${aName}
UNION
SELECT ${idField} FROM ${bName}
`.trim();
    } else if (operator === 'A_AND_NOT_B') {
        // Set difference: A LEFT JOIN B WHERE B IS NULL
        return `
WITH ${aName} AS (
${indent(cleanA, 0)}
),
${bName} AS (
${indent(cleanB, 0)}
)
SELECT DISTINCT
    ${aName}.${idField}
FROM ${aName}
LEFT JOIN ${bName}
    ON ${bName}.${idField} = ${aName}.${idField}
WHERE ${bName}.${idField} IS NULL
`.trim();
    }

    throw new Error(`Unsupported operator: ${operator}`);
}

/**
 * Compile a base indicator's population SQL.
 *
 * For base indicators, we extract the population SQL from the sql_template
 * or from config_json fields. The population SQL should return the patient ID column.
 */
function compileBasePopulation(
    indicator: IndicatorDto,
    config: CompositeIndicatorConfig | null
): PopulationCompileResult {
    // Try to get SQL from various sources
    let sql = indicator.sqlTemplate || '';

    if (!sql && config) {
        // Try config_json fields
        sql = config.sqlPreview || config.sqlTemplate || config.base?.sqlPreview || config.base?.sqlTemplate || '';
    }

    if (!sql) {
        throw new AtomicIndicatorError(
            indicator.code || indicator.uuid,
            'No SQL template found'
        );
    }

    // Fix common typos
    sql = fixCommonTypos(sql);

    // Get the patient ID column from config (e.g., 'client_id' for HIV indicators)
    const patientIdColumn = getPatientIdColumnFromConfig(config);

    // Convert COUNT SQL to population SQL if needed
    const populationSql = convertCountToPopulation(sql, patientIdColumn);

    // Validate the output is proper population SQL
    const validation = validatePopulationSql(populationSql, patientIdColumn);
    if (!validation.valid) {
        return {
            sql: populationSql,
            patientIdColumn,
            retired: indicator.retired,
            error: new PopulationSqlError(
                validation.error.code,
                validation.error.message,
                { uuid: indicator.uuid, name: indicator.name, code: indicator.code || indicator.uuid }
            )
        };
    }

    return {
        sql: populationSql,
        patientIdColumn,
        retired: indicator.retired
    };
}

/**
 * Get the patient ID column from indicator config.
 * Defaults to 'client_id' if not specified.
 */
function getPatientIdColumnFromConfig(config: CompositeIndicatorConfig | null): string {
    try {
        const cfg =
            config?.themeConfig ||
            config?.base?.themeConfig ||
            config?.authoring?.base?.themeConfig ||
            config?.baseIndicator?.themeConfig ||
            null;
        const pid = cfg?.patientIdColumn;
        return pid ? String(pid) : 'client_id';
    } catch {
        return 'client_id';
    }
}

/**
 * Convert COUNT SQL to population SQL.
 *
 * This handles the case where a base indicator has COUNT(*) SQL
 * or COUNT(DISTINCT column) SQL and needs to be converted to return
 * patient_id or client_id instead.
 *
 * IMPORTANT: The output column is ALWAYS aliased as the patientIdColumn value
 * (e.g., 'client_id' or 'patient_id') for consistency with downstream queries.
 */
function convertCountToPopulation(sql: string, patientIdColumn: string = 'client_id'): string {
    let trimmed = sql.trim();

    // Handle escaped newlines BEFORE pattern matching
    // This ensures multi-line SQL with GROUP BY, HAVING, etc. on separate lines is preserved
    trimmed = trimmed.replace(/\\n/g, '\n');

    // Remove any trailing semicolons first (they cause issues when used as CTE)
    const withoutSemicolon = trimmed.replace(/;+\s*$/, '');

    // Check if it's already a population query (SELECT DISTINCT with patient_id, client_id, or encounter_id)
    const populationCheck = new RegExp(
        `SELECT\\s+DISTINCT\\s+(?:\\w+\\.)?(?:${patientIdColumn}|client_id|patient_id|encounter_id)`,
        'i'
    );
    if (populationCheck.test(withoutSemicolon)) {
        // Ensure the output is normalized to patient_id for disaggregation compatibility
        const fixed = fixCommonTypos(withoutSemicolon);
        // If it's already aliasing as patient_id, return as-is
        const aliasCheck = new RegExp(`AS\\s+patient_id\\b`, 'im');
        if (aliasCheck.test(fixed)) {
            return fixed;
        }
        // Fix the alias to normalize to patient_id (handles client_id, encounter_id, etc.)
        // Handles both qualified (a.client_id) and unqualified (client_id) column references,
        // with or without an existing alias. The contract requires EVERY population SQL to
        // expose patient_id, otherwise combineWithOperator/disaggregation reference a column
        // the CTE does not expose.
        const replacePattern = /SELECT\s+DISTINCT\s+(?:(\w+)\.)?(client_id|patient_id|encounter_id)(?:\s+AS\s+\w+)?/i;
        return fixed.replace(
            replacePattern,
            (_match, tableAlias: string | undefined, column: string) =>
                `SELECT DISTINCT ${tableAlias ? `${tableAlias}.` : ''}${column} AS patient_id`
        );
    }

    // Check for COUNT(DISTINCT column) pattern - e.g., SELECT COUNT(DISTINCT a.client_id) AS total FROM ...
    // Also handles patterns without AS or with subqueries: SELECT COUNT(DISTINCT a.client_id) FROM (...)
    const countDistinctPattern = /SELECT\s+COUNT\s*\(\s*DISTINCT\s+(\w+\.(?:client_id|patient_id|encounter_id))\s*\)(?:\s+AS\s+\w+)?\s+FROM/i;
    const countDistinctMatch = withoutSemicolon.match(countDistinctPattern);
    if (countDistinctMatch) {
        const columnReference = countDistinctMatch[1]; // e.g., "a.client_id"
        // Extract just the column name without the alias
        const columnName = columnReference.split('.').pop()!;
        const alias = columnReference.split('.')[0];

        // Replace with SELECT DISTINCT alias.columnName AS patient_id FROM
        // Keep the rest of the SQL after FROM (including subqueries)
        const result = withoutSemicolon.replace(
            /SELECT\s+COUNT\s*\(\s*DISTINCT\s+\w+\.(?:client_id|patient_id|encounter_id)\s*\)(?:\s+AS\s+\w+)?\s+FROM/i,
            `SELECT DISTINCT ${alias}.${columnName} AS patient_id FROM`
        );

        return fixCommonTypos(result);
    }

    // Check for COUNT(*) pattern - e.g., SELECT COUNT(*) AS total FROM ...
    const countPattern = /SELECT\s+.*?COUNT\s*\(\s*\*\s*\)\s+AS\s+total/i;
    if (countPattern.test(withoutSemicolon)) {
        // Try to extract the table and alias from the FROM clause
        const fromMatch = withoutSemicolon.match(/FROM\s+(\S+)\s+(\S+)/i);
        if (fromMatch) {
            const alias = fromMatch[2];

            // Build population SQL - normalize to patient_id
            const result = withoutSemicolon
                .replace(/SELECT\s+.*?COUNT\s*\(\s*\*\s*\)\s+AS\s+total\s*/i, '')
                .replace(/FROM\s+/i, `SELECT DISTINCT ${alias}.${patientIdColumn} AS patient_id FROM `);

            return fixCommonTypos(result);
        }

        // If we can't parse it, try a simple replacement - normalize to patient_id
        const result = withoutSemicolon.replace(
            /SELECT\s+.*?COUNT\s*\(\s*\*\s*\)\s+AS\s+total\s+FROM\s+/i,
            `SELECT DISTINCT patient_id FROM `
        );

        return fixCommonTypos(result);
    }

    // Not a COUNT query we recognize - assume it's already correct but fix typos
    return fixCommonTypos(withoutSemicolon);
}

/**
 * Fix common typos in generated SQL.
 */
function fixCommonTypos(sql: string): string {
    let fixed = sql;
    // Handle escaped newlines - convert literal \n to actual newlines
    // This can happen when SQL is serialized through JSON in the backend
    fixed = fixed.replace(/\\n/g, '\n');
    // Fix :stratDate -> :startDate
    fixed = fixed.replace(/:stratDate\b/g, ':startDate');
    // Remove trailing semicolons - population SQL used as CTE shouldn't have semicolons
    fixed = fixed.replace(/;+\s*$/, '');
    return fixed;
}

/**
 * Indent SQL by a number of spaces.
 */
function indent(sql: string, spaces: number): string {
    const pad = ' '.repeat(spaces);
    return sql
        .split('\n')
        .map((line) => (line.trim() ? pad + line : line))
        .join('\n');
}

/**
 * Generate scalar COUNT SQL from population SQL.
 *
 * This wraps the population SQL in a COUNT query.
 * Population SQL must expose the patient_id column per the compiler contract.
 */
export function generateScalarCountSql(populationSql: string): string {
    const clean = populationSql.trim().replace(/;+\s*$/, '');

    return `
WITH base_population AS (
${indent(clean, 0)}
)
SELECT
    COUNT(DISTINCT patient_id) AS total
FROM base_population;
`.trim();
}

/**
 * Generate age/sex disaggregation SQL from population SQL.
 *
 * This wraps the population SQL in the disaggregation CTE structure.
 *
 * @deprecated The gender defaulting behavior (defaulting to both F and M when none selected)
 * will be removed in a future version. Always specify genders explicitly.
 */
export function generateAgeSexDisaggregationSql(args: {
    populationSql: string;
    ageCategoryCode: string;
    genders: Array<'F' | 'M'>;
}): string {
    const { populationSql, ageCategoryCode, genders } = args;

    // Default to both genders if none selected (for backward compatibility)
    // TODO: Remove this default in a future version and require explicit gender selection
    const selectedGenders = (genders || []).length ? genders : (['F', 'M'] as Array<'F' | 'M'>);

    // Log deprecation warning when defaulting
    if (!genders || genders.length === 0) {
        console.warn('[generateAgeSexDisaggregationSql] No genders specified, defaulting to both F and M. This default will be removed in a future version.');
    }

    const clean = populationSql.trim().replace(/;+\s*$/, '');

    // All population SQL is normalized to patient_id, so hardcode patient_id here
    const patientIdColumn = 'patient_id';

    return `
WITH base_pop AS (
${indent(clean, 2)}
),
ag AS (
  SELECT
    ag.age_group_id,
    ag.label,
    ag.min_age_days,
    ag.max_age_days,
    ag.sort_order
  FROM report_builder_dim_age_group ag
  JOIN report_builder_dim_age_category ac
    ON ac.age_category_id = ag.age_category_id
  WHERE ac.code = '${escapeSql(ageCategoryCode)}'
  AND ag.is_active = 1
),
genders AS (
  SELECT 'F' AS gender
  UNION ALL SELECT 'M' AS gender
),
cnt AS (
  SELECT
    ag.age_group_id AS age_group_id,
    mdp.gender AS gender,
    COUNT(DISTINCT base_pop.${patientIdColumn}) AS value
  FROM base_pop
  JOIN mamba_fact_patients_latest_patient_demographics mdp
    ON mdp.${patientIdColumn} = base_pop.${patientIdColumn}
  JOIN ag
    ON TIMESTAMPDIFF(DAY, mdp.birthdate, :endDate)
       BETWEEN ag.min_age_days AND ag.max_age_days
  WHERE mdp.birthdate IS NOT NULL
  AND mdp.gender IS NOT NULL
  AND mdp.gender IN (${selectedGenders.map((g) => `'${g}'`).join(',')})
  GROUP BY ag.age_group_id, mdp.gender
)
SELECT
  ag.label AS age_group,
  g.gender AS gender,
  COALESCE(cnt.value, 0) AS value
FROM ag
CROSS JOIN genders g
LEFT JOIN cnt
    ON cnt.age_group_id = ag.age_group_id
   AND cnt.gender = g.gender
ORDER BY ag.sort_order, g.gender;
`.trim();
}

/**
 * Escape SQL literal values.
 */
function escapeSql(s: string): string {
    return String(s).replace(/'/g, "''");
}
