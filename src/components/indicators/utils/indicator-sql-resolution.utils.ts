/**
 * Centralized Indicator SQL Resolution
 *
 * This module provides a single canonical way to resolve SQL from indicators
 * across all compilation paths (Indicator Preview, Section Preview, etc.).
 *
 * Instead of duplicating the fallback chain in multiple components,
 * use these functions to reliably locate and extract SQL from indicator configurations.
 */

import type { IndicatorDto } from '../../../resources/indicator/indicators.api';

/**
 * SQL extraction source for debugging and error reporting
 */
export type SqlSource =
    | 'indicator.sqlTemplate'
    | 'configJson.sqlPreview'
    | 'configJson.sqlTemplate'
    | 'configJson.base.sqlPreview'
    | 'configJson.base.sqlTemplate'
    | 'configJson.authoring.base.sqlPreview'
    | 'configJson.authoring.base.sqlTemplate'
    | 'configJson.baseIndicator.sqlPreview'
    | 'configJson.baseIndicator.sqlTemplate'
    | 'none'
    | 'none(parse-error)'
    | 'none(empty-config)';

/**
 * Result of resolving indicator SQL with source tracking for debugging
 */
export type ResolvedIndicatorSql = {
    /** The extracted SQL */
    sql: string;
    /** Where the SQL was found (for debugging) */
    source: SqlSource;
    /** The config JSON that was parsed (for reference) */
    parsedConfig?: any;
};

/**
 * Structured error when SQL cannot be resolved
 */
export type SqlResolutionError = {
    success: false;
    error: string;
    indicator: {
        uuid: string;
        code?: string;
        name?: string;
        kind?: string;
    };
    attemptedSources: SqlSource[];
};

/**
 * Resolve SQL from an indicator with comprehensive fallback chain.
 *
 * This is the canonical way to extract SQL from indicators across all compilation paths.
 *
 * Priority order (as per the current config structure):
 * 1. indicator.sqlTemplate (direct field)
 * 2. configJson.sqlPreview (flat config)
 * 3. configJson.sqlTemplate (flat config)
 * 4. configJson.base.sqlPreview (nested base config)
 * 5. configJson.base.sqlTemplate (nested base config)
 * 6. configJson.authoring.base.sqlPreview (authoring structure)
 * 7. configJson.authoring.base.sqlTemplate (authoring structure)
 * 8. configJson.baseIndicator.sqlPreview (wrapped indicator config)
 * 9. configJson.baseIndicator.sqlTemplate (wrapped indicator config)
 *
 * @param indicator - The indicator to extract SQL from
 * @returns Resolved SQL with source tracking, or structured error
 */
export function resolveIndicatorSql(indicator: IndicatorDto): ResolvedIndicatorSql | SqlResolutionError {
    const attemptedSources: SqlSource[] = [];
    const direct = (indicator?.sqlTemplate ?? '').trim();

    if (direct) {
        return {
            sql: normalizeEscapedNewlines(direct),
            source: 'indicator.sqlTemplate'
        };
    }
    attemptedSources.push('indicator.sqlTemplate');

    // Try to parse config JSON
    let parsed: any = null;
    try {
        parsed = indicator?.configJson ? JSON.parse(indicator.configJson) : null;
    } catch (e) {
        // Invalid JSON - will return error at end
        parsed = null;
    }

    if (!parsed) {
        return createSqlResolutionError(indicator, attemptedSources, 'configJson is null or invalid JSON');
    }

    // Helper to try a path and return early if found
    const tryPath = (source: SqlSource, getValue: (p: any) => string): ResolvedIndicatorSql | null => {
        attemptedSources.push(source);
        const value = (getValue(parsed) ?? '').trim();
        if (value) {
            return {
                sql: normalizeEscapedNewlines(value),
                source,
                parsedConfig: parsed
            };
        }
        return null;
    };

    // Try all known paths in priority order
    const result =
        tryPath('configJson.sqlPreview', (p) => p.sqlPreview) ||
        tryPath('configJson.sqlTemplate', (p) => p.sqlTemplate) ||
        tryPath('configJson.base.sqlPreview', (p) => p.base?.sqlPreview) ||
        tryPath('configJson.base.sqlTemplate', (p) => p.base?.sqlTemplate) ||
        tryPath('configJson.authoring.base.sqlPreview', (p) => p.authoring?.base?.sqlPreview) ||
        tryPath('configJson.authoring.base.sqlTemplate', (p) => p.authoring?.base?.sqlTemplate) ||
        tryPath('configJson.baseIndicator.sqlPreview', (p) => p.baseIndicator?.sqlPreview) ||
        tryPath('configJson.baseIndicator.sqlTemplate', (p) => p.baseIndicator?.sqlTemplate);

    if (result) {
        return result;
    }

    attemptedSources.push('none');
    return createSqlResolutionError(indicator, attemptedSources, 'No SQL found in any known config location');
}

/**
 * Create a structured SQL resolution error
 */
function createSqlResolutionError(
    indicator: IndicatorDto,
    attemptedSources: SqlSource[],
    reason: string
): SqlResolutionError {
    return {
        success: false,
        error: `SQL_RESOLUTION_FAILED: ${reason}`,
        indicator: {
            uuid: indicator.uuid,
            code: indicator.code,
            name: indicator.name,
            kind: indicator.kind
        },
        attemptedSources
    };
}

/**
 * Check if a resolved SQL result is an error
 */
export function isSqlResolutionError(result: ResolvedIndicatorSql | SqlResolutionError): result is SqlResolutionError {
    return (result as any).success === false;
}

/**
 * Resolve patient ID column from indicator config.
 *
 * Centralized way to extract the patient ID column across all compilation paths.
 *
 * Priority order:
 * 1. parsed.themeConfig.patientIdColumn
 * 2. parsed.base.themeConfig.patientIdColumn
 * 3. parsed.authoring.base.themeConfig.patientIdColumn
 * 4. parsed.baseIndicator.themeConfig.patientIdColumn
 * 5. Default: 'patient_id'
 *
 * @param indicator - The indicator to extract patient ID column from
 * @returns The patient ID column name (defaults to 'patient_id')
 */
export function resolvePatientIdColumn(indicator: IndicatorDto): string {
    try {
        const parsed: any = indicator?.configJson ? JSON.parse(indicator.configJson) : null;

        const cfg =
            parsed?.themeConfig ? { ...parsed.themeConfig, _source: 'themeConfig' } :
            parsed?.base?.themeConfig ? { ...parsed.base.themeConfig, _source: 'base.themeConfig' } :
            parsed?.authoring?.base?.themeConfig ? { ...parsed.authoring.base.themeConfig, _source: 'authoring.base.themeConfig' } :
            parsed?.baseIndicator?.themeConfig ? { ...parsed.baseIndicator.themeConfig, _source: 'baseIndicator.themeConfig' } :
            null;

        const pid = cfg?.patientIdColumn;
        return pid ? String(pid) : 'patient_id';
    } catch {
        return 'patient_id';
    }
}

/**
 * Normalize escaped newlines in SQL.
 *
 * SQL stored in JSON may have literal \n instead of actual newlines.
 * This converts them back.
 */
export function normalizeEscapedNewlines(sql: string): string {
    if (!sql) return sql;
    return sql.replace(/\\n/g, '\n');
}
