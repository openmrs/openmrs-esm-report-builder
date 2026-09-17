/**
 * Section Disaggregation SQL Builder
 *
 * This module builds age/sex disaggregation SQL for report sections.
 * It provides both synchronous (for backward compatibility) and asynchronous
 * (for nested composite indicators) versions.
 *
 * Now supports CUSTOM indicators with complex SQL via the query interpreter.
 */

import type { IndicatorDto } from '../../resources/indicator/indicators.api';
import {
    compilePopulationSql,
    generateAgeSexDisaggregationSql,
    clearCompilationCache,
    type CompilerOptions
} from '../indicators/utils/population-sql.compiler';
import {
    countSqlToPopulationSql,
    tryGetPatientIdColumnFromConfig
} from '../indicators/utils/composite-indicator-sql.utils';
import {
    resolveIndicatorSql,
    isSqlResolutionError
} from '../indicators/utils/indicator-sql-resolution.utils';
import {
    customIndicatorInterpreter,
    type CustomIndicatorConfig
} from '../indicators/utils/custom-indicator-interpreter';

type BuildSectionDisaggSqlArgs = {
    /** The indicator to disaggregate */
    indicator: IndicatorDto;
    /** The age category code (e.g., 'HTS', 'HMIS_106A') */
    ageCategoryCode: string;
    /** The genders to include */
    genders: Array<'F' | 'M'>;
    /** Function to fetch referenced indicators by UUID */
    getIndicator: (uuid: string) => Promise<IndicatorDto | null>;
    /** Compiler options */
    compilerOptions?: CompilerOptions;
};

/**
 * Result of building section disaggregation SQL (async version).
 */
export type SectionDisaggResult = {
    /** The generated SQL */
    sql: string;
    /** Any warnings from compilation */
    warnings?: string[];
};

/**
 * Builds section disaggregation SQL for any indicator type (BASE, COMPOSITE, FINAL).
 *
 * This is the synchronous version for backward compatibility. It extracts
 * population SQL from the indicator's sql_template without recursive compilation.
 *
 * For nested composite indicators, this version may fail or produce incorrect results.
 * Use `buildSectionDisaggregationSqlAsync` instead for nested composite indicators.
 *
 * @deprecated Use buildSectionDisaggregationSqlAsync for composite indicators.
 * This version cannot recursively compile composite indicators and will be removed in a future version.
 *
 * @returns The generated SQL as a string
 */
export function buildSectionDisaggregationSql(args: {
    indicator: IndicatorDto;
    ageCategoryCode: string;
    genders: Array<'F' | 'M'>;
}): string {
    const { indicator, ageCategoryCode, genders } = args;

    // Handle CUSTOM indicators using the query interpreter
    if (indicator.kind === 'CUSTOM') {
        // Try to parse custom indicator config
        let customConfig: CustomIndicatorConfig | null = null;
        if (indicator.configJson) {
            try {
                const parsed = JSON.parse(indicator.configJson);
                // Check if it's a custom indicator config
                if (parsed && parsed.version === 1 && parsed.patientIdColumn) {
                    customConfig = parsed;
                }
            } catch (e) {
                // Invalid JSON, continue with default handling
            }
        }

        // Use query interpreter to extract population SQL
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const analysis = customIndicatorInterpreter.analyze(indicator.sqlTemplate || '', customConfig || undefined);
        const extractionResult = customIndicatorInterpreter.extractPopulationSql(indicator.sqlTemplate || '', customConfig || undefined);

        if (extractionResult.success && extractionResult.sql) {
            // Apply section disaggregation using the query interpreter
            return customIndicatorInterpreter.applyDisaggregation(
                extractionResult.sql,
                { ageCategoryCode, genders: genders ?? [] },
                customConfig || undefined
            );
        }

        // If extraction failed, return error message
        return `-- Error: Could not process CUSTOM indicator ${indicator.name || indicator.uuid}.\n-- ${extractionResult.warnings?.join(', ') || 'Unknown error'}\n-- Ensure the indicator has a clear population query structure.`;
    }

    // Check for composite indicators and return error
    if (indicator.kind === 'COMPOSITE') {
        console.warn(`[buildSectionDisaggregationSql] DEPRECATED: Cannot use sync version for COMPOSITE indicator '${indicator.code || indicator.uuid}'. Use buildSectionDisaggregationSqlAsync instead.`);
        return `-- Error: Cannot use sync version for COMPOSITE indicator ${indicator.code || indicator.uuid}.\n-- Use buildSectionDisaggregationSqlAsync for composite indicators.\n-- This synchronous version cannot recursively compile composite indicators.`;
    }

    // genders is required - must be explicitly provided by caller
    const selectedGenders = genders ?? [];

    const escapedCode = escapeSql(ageCategoryCode);

    // Build gender list - if empty, don't add gender filter
    // Note: Don't include quotes here - quotes are added separately in VALUES and IN clauses
    const genderList = selectedGenders.length > 0
        ? selectedGenders.join(',')
        : null;

    // Build quoted gender list for IN clause
    const genderListQuoted = selectedGenders.length > 0
        ? selectedGenders.map((g) => `'${g}'`).join(',')
        : null;

    // Get patient ID column from theme config
    const pidCol = tryGetPatientIdColumnFromConfig(indicator);

    // Try to get population SQL from the indicator
    const populationSql = tryGetPopulationSql(indicator);

    if (!populationSql) {
        return `-- Unable to build section disaggregation SQL: indicator does not contain usable population SQL.\n-- Ensure the indicator has a valid sqlTemplate or configJson.\n-- Indicator: ${indicator.name} (${indicator.code})\n-- Note: For nested composite indicators, use buildSectionDisaggregationSqlAsync.`;
    }

    return `
WITH base_pop AS (
  ${indent(populationSql, 2)}
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
  WHERE ac.code = '${escapedCode}'
    AND ag.is_active = 1
),
genders AS (
  ${genderList
    ? genderList.split(',').map((g, i) => `${i === 0 ? `SELECT '${g}' AS gender` : `UNION ALL\n  SELECT '${g}' AS gender`}`).join('\n  ')
    : `SELECT DISTINCT gender\n    FROM mamba_fact_patients_latest_patient_demographics\n    WHERE gender IS NOT NULL`}
),
cnt AS (
  SELECT
    ag.age_group_id AS age_group_id,
    mdp.gender AS gender,
    COUNT(DISTINCT base_pop.${pidCol}) AS value
  FROM base_pop
  JOIN mamba_fact_patients_latest_patient_demographics mdp
    ON mdp.${pidCol} = base_pop.${pidCol}
  JOIN ag
    ON TIMESTAMPDIFF(DAY, mdp.birthdate, :endDate)
       BETWEEN ag.min_age_days AND ag.max_age_days
  WHERE mdp.birthdate IS NOT NULL
    AND mdp.gender IS NOT NULL
    ${genderListQuoted ? `AND mdp.gender IN (${genderListQuoted})` : ''}
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
 * Async version of section disaggregation SQL builder.
 *
 * This function uses the recursive population SQL compiler to properly handle
 * nested composite indicators. The compiler:
 * 1. Recursively compiles each indicator to population SQL
 * 2. Detects circular dependencies
 * 3. Handles missing references
 * 4. Fixes common typos like `:stratDate` -> `:startDate`
 *
 * Use this version for composite indicators that reference other composite indicators.
 *
 * @returns The generated SQL and any warnings
 */
export async function buildSectionDisaggregationSqlAsync({
    indicator,
    ageCategoryCode,
    genders,
    getIndicator,
    compilerOptions = {}
}: BuildSectionDisaggSqlArgs): Promise<SectionDisaggResult> {
    try {
        // Handle CUSTOM indicators using the query interpreter
        if (indicator.kind === 'CUSTOM') {
            // Use centralized SQL resolution for consistent behavior
            const resolvedSql = resolveIndicatorSql(indicator);

            if (isSqlResolutionError(resolvedSql)) {
                console.error('❌ [CUSTOM] SQL resolution failed:', resolvedSql.error);
                return {
                    sql: `-- Error: ${resolvedSql.error}\n-- Indicator: ${indicator.name} (${indicator.code || indicator.uuid})`,
                    warnings: [resolvedSql.error]
                };
            }

            const sqlTemplate = resolvedSql.sql;

            console.log('📦 [CUSTOM] Extracted SQL:', {
                source: resolvedSql.source,
                length: sqlTemplate?.length || 0,
                preview: sqlTemplate?.substring(0, 200) || 'EMPTY'
            });

            console.log('🔍 [CUSTOM] Processing custom indicator:', {
                uuid: indicator.uuid,
                name: indicator.name,
                code: indicator.code,
                hasSqlTemplate: !!indicator.sqlTemplate,
                hasConfigJson: !!indicator.configJson,
                finalSqlTemplateLength: sqlTemplate?.length || 0,
                sqlTemplatePreview: sqlTemplate?.substring(0, 300) || 'EMPTY'
            });

            // NOTE: We DON'T check for "already disaggregated" here because CUSTOM indicators
            // should ALWAYS be re-disaggregated according to the section's configuration.
            // Even if an indicator has its own disaggregation (e.g., DATIM age groups),
            // the section might want to use a different age category (e.g., MOH_105_OPD_DIAG).
            //
            // The "already disaggregated" detection has been removed to ensure all CUSTOM
            // indicators go through the population SQL extraction and re-disaggregation flow.

            // Try to parse custom indicator config
            let customConfig: CustomIndicatorConfig | null = null;
            if (indicator.configJson) {
                try {
                    const parsed = JSON.parse(indicator.configJson);
                    // Check if it's a custom indicator config
                    if (parsed && parsed.version === 1 && parsed.patientIdColumn) {
                        customConfig = parsed;
                        console.log('✅ [CUSTOM] Parsed custom config:', customConfig);
                    } else {
                        console.warn('⚠️ [CUSTOM] Config JSON not valid custom indicator config, using fallback');
                        // Check if this config has sqlPreview (theme-based config)
                        const hasSqlPreview = !!(parsed?.sqlPreview || parsed?.sqlTemplate);
                        // Create a basic config from available data
                        customConfig = {
                            version: 1,
                            patientIdColumn: parsed?.patientIdColumn || parsed?.themeConfig?.patientIdColumn || 'patient_id',
                            populationQuery: hasSqlPreview ? { extractFrom: 'configJson' as const } : { extractFrom: 'sqlTemplate' as const },
                            supportsRedisaggregation: true,
                            redisaggregationStrategy: 'population-extraction',
                            themeIndependent: parsed?.themeIndependent !== false
                        };
                        console.log('🔧 [CUSTOM] Created fallback config:', {
                            patientIdColumn: customConfig.patientIdColumn,
                            extractFrom: customConfig.populationQuery.extractFrom,
                            hasSqlPreview
                        });
                    }
                } catch (e) {
                    console.error('❌ [CUSTOM] Failed to parse configJson:', e);
                    // Invalid JSON, continue with default handling
                }
            }

            // Use query interpreter to extract population SQL
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const analysis = customIndicatorInterpreter.analyze(sqlTemplate || '', customConfig || undefined);
            const extractionResult = customIndicatorInterpreter.extractPopulationSql(sqlTemplate || '', customConfig || undefined);

            console.log('📊 [CUSTOM] Extraction result:', {
                success: extractionResult.success,
                hasSql: !!extractionResult.sql,
                sqlLength: extractionResult.sql?.length || 0,
                warnings: extractionResult.warnings,
                patientIdColumn: extractionResult.patientIdColumn
            });

            if (extractionResult.success && extractionResult.sql) {
                // Apply section disaggregation using the query interpreter
                const sql = customIndicatorInterpreter.applyDisaggregation(
                    extractionResult.sql,
                    { ageCategoryCode, genders: genders ?? [] },
                    customConfig || undefined
                );
                console.log('✅ [CUSTOM] Successfully generated disaggregation SQL, length:', sql.length);
                return { sql, warnings: extractionResult.warnings };
            }

            // FALLBACK: If extraction failed, check if the indicator already has valid disaggregation
            // If so, use it as-is (even though it won't match the section's age category exactly)
            if (sqlTemplate && /SELECT\s+.*?AS\s+(?:age_group|gender|sex)/i.test(sqlTemplate)) {
                console.log('⚠️ [CUSTOM] Could not extract population SQL; using indicator SQL as-is with warning');
                return {
                    sql: sqlTemplate,
                    warnings: [
                        'Could not extract population SQL; using indicator SQL as-is',
                        `Indicator uses its own age groups, not section age category (${ageCategoryCode})`,
                        'Results may not match section configuration',
                        ...extractionResult.warnings
                    ]
                };
            }

            // If extraction failed and no valid SQL, return error
            console.error('❌ [CUSTOM] Extraction failed:', extractionResult.warnings);
            return {
                sql: `-- Error: Could not process CUSTOM indicator ${indicator.name || indicator.uuid}.\n-- ${extractionResult.warnings?.join(', ') || 'Unknown error'}`,
                warnings: extractionResult.warnings || ['Failed to extract population SQL']
            };
        }

        // Clear cache to ensure fresh compilation
        clearCompilationCache();

        // Recursively compile the indicator to population SQL
        const result = await compilePopulationSql(indicator, getIndicator, new Set(), compilerOptions);

        // Check for compilation errors
        if (result.error) {
            return {
                sql: `-- Error: ${result.error.message}\n-- Indicator: ${indicator.name} (${indicator.code || indicator.uuid})\n-- Error Code: ${result.error.code}`,
                warnings: result.warnings || [result.error.message]
            };
        }

        // Generate the disaggregation SQL
        const sql = generateAgeSexDisaggregationSql({
            populationSql: result.sql,
            ageCategoryCode,
            genders
        });

        return {
            sql,
            warnings: result.warnings
        };
    } catch (error) {
        // Re-throw PopulationSqlError to be handled by caller
        if (error instanceof Error && error.name === 'PopulationSqlError') {
            throw error;
        }

        // Return an error comment in the SQL for other errors
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            sql: `-- Error building disaggregation SQL: ${errorMsg}\n-- Indicator: ${indicator.name} (${indicator.code || indicator.uuid})`,
            warnings: [`Compilation error: ${errorMsg}`]
        };
    }
}

/**
 * Match a balanced parenthesis group in SQL
 * Handles nested subqueries by counting opening/closing parens
 *
 * @param sql - SQL string to match
 * @param startIndex - Index to start matching from (after opening paren)
 * @returns Object with matched text and end index, or null if no match
 */
function matchBalancedParens(sql: string, startIndex: number): { text: string; endIndex: number } | null {
    let depth = 1;
    let i = startIndex;
    const len = sql.length;

    while (i < len && depth > 0) {
        const char = sql[i];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        }
        i++;
    }

    if (depth !== 0) {
        // Unbalanced parentheses
        return null;
    }

    return {
        text: sql.substring(startIndex, i - 1),
        endIndex: i
    };
}

/**
 * Extract the inner population SQL from a complex indicator.
 * Complex indicators have the structure:
 * SELECT COUNT(DISTINCT id) FROM (population_query_with_joins) alias
 *
 * We need to extract just the population_query part to use with section disaggregation.
 */
function extractPopulationSqlFromComplexIndicator(sql: string): string | null {
    if (!sql) return null;

    // Pattern 1: COUNT DISTINCT with FROM subquery that has JOINs and WHERE
    // SELECT COUNT(DISTINCT a.patient_id) FROM (SELECT ...) a LEFT JOIN ... WHERE ...
    // Use balanced parenthesis matching to handle nested subqueries
    const countDistinctFromPattern = /SELECT\s+COUNT\s*\(\s*DISTINCT\s+\w+\.?\w*\s*\)\s*FROM\s*\(\s*SELECT/i;
    const countDistinctMatch = sql.match(countDistinctFromPattern);

    if (countDistinctMatch) {
        // Find the position after "FROM (SELECT"
        const afterFromIndex = countDistinctMatch.index + countDistinctMatch[0].length;

        // Use balanced parenthesis matching to get the complete inner query
        const balancedMatch = matchBalancedParens(sql, afterFromIndex);

        if (balancedMatch) {
            const populationSql = `SELECT${balancedMatch.text}`.trim();
            const afterInnerQuery = balancedMatch.endIndex;

            // Extract the outer alias (should be right after the closing paren)
            const aliasPattern = /\s*(\w+)\s*([\s\S]*)/;
            const aliasMatch = sql.substring(afterInnerQuery).match(aliasPattern);

            if (aliasMatch) {
                const alias = aliasMatch[1];
                const restOfQuery = aliasMatch[2] || '';

                // Check if the inner query has GROUP BY patient_id or similar
                if (/GROUP\s+BY\s+(patient_id|patient_id|person_id)/i.test(populationSql)) {
                    // Build the full population query including JOINs and WHERE
                    // Replace the alias references in JOINs and WHERE with the actual table
                    let fullPopulationSql = `SELECT DISTINCT ${alias}.patient_id AS patient_id\nFROM (\n  ${indent(populationSql, 2)}\n) ${alias}\n${restOfQuery.trim()}`;

                    // Fix column references in rest of query
                    fullPopulationSql = fullPopulationSql.replace(new RegExp(`${alias}\\.patient_id`, 'g'), 'patient_id');

                    return fullPopulationSql;
                }
            }
        }
    }

    // Pattern 2: Simple FROM subquery (for backward compatibility)
    // FROM (SELECT ... GROUP BY patient_id) alias
    const fromSubqueryPattern = /FROM\s*\(\s*SELECT/i;
    const fromMatch = sql.match(fromSubqueryPattern);

    if (fromMatch) {
        // Find the position after "FROM (SELECT"
        const afterFromIndex = fromMatch.index + fromMatch[0].length;

        // Use balanced parenthesis matching to get the complete inner query
        const balancedMatch = matchBalancedParens(sql, afterFromIndex);

        if (balancedMatch) {
            const populationSql = `SELECT${balancedMatch.text}`.trim();
            const afterInnerQuery = balancedMatch.endIndex;

            // Extract the outer alias (should be right after the closing paren)
            const aliasPattern = /\s*(\w+)\s*(?:WHERE|GROUP BY|ORDER BY|HAVING|$)/i;
            const aliasMatch = sql.substring(afterInnerQuery).match(aliasPattern);

            if (aliasMatch) {
                // Check if it has GROUP BY patient_id or similar
                if (/GROUP\s+BY\s+(patient_id|patient_id|person_id)/i.test(populationSql)) {
                    // This looks like a valid population query
                    return populationSql;
                }
            }
        }
    }

    // Pattern 3: Find first WITH clause that looks like population data
    // WITH base_pop AS (SELECT disaggregation, COUNT(*) FROM (population_query) ...)
    const withPattern = /WITH\s+\w+\s+AS\s*\(\s*SELECT[\s\S]*?FROM\s*\(\s*SELECT/i;
    const withMatch = sql.match(withPattern);

    if (withMatch) {
        // Find the position after the second "FROM (SELECT"
        const nestedFromIndex = withMatch.index + withMatch[0].length;

        // Use balanced parenthesis matching to get the complete inner query
        const balancedMatch = matchBalancedParens(sql, nestedFromIndex);

        if (balancedMatch) {
            const populationSql = `SELECT${balancedMatch.text}`.trim();

            // Check if it has GROUP BY patient_id or similar
            if (/GROUP\s+BY\s+(patient_id|patient_id|person_id)/i.test(populationSql)) {
                return populationSql;
            }
        }
    }

    // Pattern 4: Look for the core population query pattern
    // SELECT patient_id, ... FROM table WHERE ... GROUP BY patient_id
    const corePattern = /SELECT\s+(patient_id|patient_id|person_id)[\s\S]*?FROM\s+[\w_]+[\s\S]*?GROUP\s+BY\s+(patient_id|patient_id|person_id)/i;
    const coreMatch = sql.match(corePattern);

    if (coreMatch) {
        return coreMatch[0];
    }

    return null;
}

/**
 * Check if an indicator is complex (has built-in disaggregation logic).
 * Complex indicators should not be processed through COUNT-to-population conversion
 * because they already have their own disaggregation structure.
 */
function isComplexIndicator(sql: string): boolean {
    if (!sql) return false;

    // Signs of complex indicators with built-in disaggregation:
    // 1. Multiple GROUP BY clauses
    const groupByCount = (sql.match(/GROUP BY/gi) || []).length;
    if (groupByCount > 1) return true;

    // 2. Has age_group/gender columns in SELECT with aggregation
    if (/age_group.*AS.*aggregat|gender.*AS.*sex|disaggregat/i.test(sql)) return true;

    // 3. Has complex WITH clauses (multiple CTEs with aggregation)
    const withCount = (sql.match(/WITH.*AS\s*\(/gi) || []).length;
    if (withCount > 1 && /GROUP BY/i.test(sql)) return true;

    return false;
}

/**
 * Try to extract population SQL from an indicator's sql_template or configJson.
 *
 * This attempts to convert COUNT SQL to population SQL for simple cases.
 * For complex nested composite indicators, use the async version instead.
 */
function tryGetPopulationSql(indicator: IndicatorDto): string | null {
    // First, try sqlTemplate directly
    let sql = indicator.sqlTemplate || '';

    // If not found, try config_json fields (like tryGetCountSqlFromIndicator does)
    if (!sql && indicator.configJson) {
        try {
            const parsed = JSON.parse(indicator.configJson);
            // Try various config paths
            sql = parsed?.sqlPreview ||
                  parsed?.sqlTemplate ||
                  parsed?.base?.sqlPreview ||
                  parsed?.base?.sqlTemplate ||
                  parsed?.authoring?.base?.sqlPreview ||
                  parsed?.authoring?.base?.sqlTemplate ||
                  parsed?.baseIndicator?.sqlPreview ||
                  parsed?.baseIndicator?.sqlTemplate ||
                  '';
        } catch (e) {
            // Invalid JSON, continue
        }
    }

    const trimmed = sql.trim();

    if (!trimmed) {
        return null;
    }

    // Check if this is a complex indicator with built-in disaggregation
    // If so, try to extract the population SQL from it
    if (isComplexIndicator(trimmed)) {
        const extractedPopulationSql = extractPopulationSqlFromComplexIndicator(trimmed);
        if (extractedPopulationSql) {
            // Use the extracted population SQL for section disaggregation
            return extractedPopulationSql;
        }
        // If extraction fails, return an error message
        return `-- Error: Could not extract population SQL from this complex indicator.\n-- Indicator: ${indicator.name} (${indicator.code})\n-- Complex indicators with multiple GROUP BY clauses or age_group/gender aggregation need to have a clear population query structure.\n-- Ensure the indicator has a subquery with: SELECT patient_id FROM ... GROUP BY patient_id`;
    }

    // Remove trailing semicolons - they cause "Multiple statements" errors when used in CTEs
    const withoutSemicolon = trimmed.replace(/;+\s*$/, '');

    // Handle escaped newlines - convert literal \n to actual newlines
    // This can happen when SQL is serialized through JSON in the backend
    let fixed = withoutSemicolon.replace(/\\n/g, '\n');

    // Fix common typos
    fixed = fixed.replace(/:stratDate\b/g, ':startDate');

    // Check if it's already a population query
    if (/SELECT\s+DISTINCT\s+(?:\w+\.?patient_id|patient_id)/i.test(fixed)) {
        return fixed;
    }

    // Try to convert COUNT SQL to population SQL using the existing utility
    const pidCol = tryGetPatientIdColumnFromConfig(indicator);

    try {
        const populationSql = countSqlToPopulationSql(fixed, pidCol, 'Patients');
        if (populationSql) {
            return populationSql;
        }
    } catch (e) {
        // Conversion failed, continue to fallback
    }

    // As a last resort, if it looks like a population query, return it
    if (/^SELECT\s+.*?\s+FROM\s+/i.test(fixed)) {
        return fixed;
    }

    return null;
}

function escapeSql(s: string): string {
    return String(s).replace(/'/g, "''");
}

function indent(sql: string, spaces: number): string {
    const pad = ' '.repeat(spaces);
    return sql
        .split('\n')
        .map((line) => (line.trim() ? pad + line : line))
        .join('\n');
}
