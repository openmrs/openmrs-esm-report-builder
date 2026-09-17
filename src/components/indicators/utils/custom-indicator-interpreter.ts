/**
 * Custom Indicator Query Interpreter
 *
 * Analyzes and processes custom indicator SQL to enable:
 * 1. Population SQL extraction for section disaggregation
 * 2. Filter logic preservation
 * 3. Query structure analysis
 * 4. Configuration validation
 */

import type {
    CustomIndicatorConfig,
    PatientIdColumn,
    QueryStructureAnalysis,
    FilterPreservationRule
} from '../types/custom-indicator.types';

// Re-export types for convenience
export type { CustomIndicatorConfig, PatientIdColumn, QueryStructureAnalysis, FilterPreservationRule };

/**
 * Result of population SQL extraction
 */
export type PopulationExtractionResult = {
    /** The extracted population SQL */
    sql: string;
    /** Whether extraction was successful */
    success: boolean;
    /** Any warnings or issues */
    warnings?: string[];
    /** The detected patient ID column */
    patientIdColumn?: PatientIdColumn;
};

/**
 * Query validation result
 */
export type ValidationResult = {
    /** Whether the configuration is valid */
    valid: boolean;
    /** Validation errors */
    errors: string[];
    /** Validation warnings */
    warnings: string[];
    /** Information messages */
    info: string[];
};

/**
 * Custom Indicator Query Interpreter
 *
 * Analyzes complex custom indicator SQL and enables section-level re-disaggregation
 * while preserving business logic and filters.
 */
export class CustomIndicatorInterpreter {
    /**
     * Analyze custom indicator SQL and extract metadata
     *
     * @param sql - The SQL template to analyze
     * @param config - Optional custom indicator configuration
     * @returns Query structure analysis
     */
    analyze(sql: string, config?: CustomIndicatorConfig): QueryStructureAnalysis {
        const result: QueryStructureAnalysis = {
            patientIdColumn: config?.patientIdColumn || this.detectPatientIdColumn(sql),
            hasPopulationQuery: false,
            filters: [],
            joinStructure: [],
            redisaggregatable: false,
            confidence: 0
        };

        // Detect population query structure
        const populationPatterns = [
            // Pattern 1: COUNT DISTINCT with FROM subquery
            /SELECT\s+COUNT\s*\(\s*DISTINCT\s+(\w+)\.?(\w+)\s*\)\s*FROM\s*\(\s*SELECT/i,
            // Pattern 2: Simple subquery with GROUP BY
            /FROM\s*\(\s*SELECT\s+.*?GROUP\s+BY\s+(patient_id|patient_id|person_id)/i,
            // Pattern 3: Direct population query
            /SELECT\s+DISTINCT\s+(patient_id|patient_id|person_id)/i
        ];

        for (const pattern of populationPatterns) {
            if (pattern.test(sql)) {
                result.hasPopulationQuery = true;
                result.confidence += 0.3;
                break;
            }
        }

        // Extract JOINs
        const joinPatterns = [
            { type: 'INNER JOIN', pattern: /INNER\s+JOIN\s+(\w+(?:\s+\w+)?)\s+(?:AS\s+)?(\w+)\s+ON\s+([^\n]+)/gi },
            { type: 'LEFT JOIN', pattern: /LEFT\s+(?:OUTER\s+)?JOIN\s+(\w+(?:\s+\w+)?)\s+(?:AS\s+)?(\w+)\s+ON\s+([^\n]+)/gi },
            { type: 'CROSS JOIN', pattern: /CROSS\s+JOIN\s+(\w+(?:\s+\w+)?)\s+(?:AS\s+)?(\w+)/gi }
        ];

        for (const { type, pattern } of joinPatterns) {
            let match;
            while ((match = pattern.exec(sql)) !== null) {
                result.joinStructure.push({
                    type: type as any,
                    table: match[1]?.trim() || '',
                    alias: match[2]?.trim() || '',
                    condition: match[3]?.trim() || ''
                });
                result.confidence += 0.1;
            }
        }

        // Detect filters
        const filterPatterns = [
            // Death filter
            { name: 'death_filter', pattern: /p\.dead\s*=\s*1/i, type: 'WHERE' },
            // Transfer out filter
            { name: 'transfer_out_filter', pattern: /mfto\.patient_id\s+IS\s+NULL/i, type: 'WHERE' },
            // Lost to follow-up filter
            { name: 'lost_filter', pattern: /ltfp_days\s*>\s*(?:\d+)/i, type: 'WHERE' },
            // Prison filter
            { name: 'prison_filter', pattern: /special_category\s*=\s*'In prison'/i, type: 'INNER JOIN' }
        ];

        for (const { name, pattern, type } of filterPatterns) {
            if (pattern.test(sql)) {
                result.filters.push({ name, type: type as any, pattern: pattern.source });
                result.confidence += 0.05;
            }
        }

        // Determine re-disaggregatability
        result.redisaggregatable =
            result.hasPopulationQuery &&
            result.confidence >= 0.5 &&
            result.patientIdColumn !== undefined;

        return result;
    }

    /**
     * Extract population SQL for section disaggregation
     *
     * @param sql - The SQL template to process
     * @param config - Custom indicator configuration
     * @returns Extracted population SQL or error message
     */
    extractPopulationSql(sql: string, config?: CustomIndicatorConfig): PopulationExtractionResult {
        const result: PopulationExtractionResult = {
            sql: '',
            success: false,
            warnings: []
        };

        console.log('🔍 [Interpreter] Extracting population SQL:', {
            sqlLength: sql?.length || 0,
            sqlPreview: sql?.substring(0, 200) || 'EMPTY',
            config: config,
            fullSql: sql?.substring(0, 500) || 'EMPTY'
        });

        if (!sql || !sql.trim()) {
            result.warnings?.push('CUSTOM_POPULATION_MISSING: Indicator has supportsRedisaggregation=true but no population SQL source');
            result.warnings?.push('Expected one of: populationSql, sqlTemplate, or sqlPreview in configJson');
            console.error('❌ [Interpreter] CUSTOM_POPULATION_MISSING: Empty SQL provided');
            return result;
        }

        // Decode HTML entities (common in database-stored SQL)
        let processedSql = sql
            .replace(/&amp;lt;/g, '<')
            .replace(/&amp;gt;/g, '>')
            .replace(/&amp;amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/\\n/g, '\n')
            .trim();

        // Fix quoted parameters - convert ':parameter' to :parameter
        // Some legacy SQL uses quotes around named parameters
        processedSql = processedSql.replace(/':(\w+)'/g, ':$1');

        // Pattern 0: TX-RTT style with age_group/sex in SELECT, followed by COUNT(DISTINCT)
        // SELECT ... AS age_group, ... AS sex, COUNT(DISTINCT a.patient_id) AS value FROM (...) alias ...
        // This handles indicators like PWIDS that have additional SELECT columns before the COUNT
        // Require GROUP BY patient_id to avoid stopping at nested function calls like TIMESTAMPDIFF(...)
        //
        // We use balanced parenthesis matching to handle nested subqueries correctly
        const txRttDisaggregatedPattern =
            /SELECT\s+[\s\S]*?,\s*COUNT\s*\(\s*DISTINCT\s+(\w+)\.(\w+)\s*\)\s*(?:AS\s+\w+)?\s+FROM\s*\(\s*SELECT\s+patient_id/i;
        const txRttDisaggregatedMatch = processedSql.match(txRttDisaggregatedPattern);

        if (txRttDisaggregatedMatch) {
            console.log('✅ [Pattern 0] Detected TX-RTT disaggregated query with age_group/sex');
            const columnName = txRttDisaggregatedMatch[2];

            // Find the position after "FROM ("
            const afterFromIndex = txRttDisaggregatedMatch.index + txRttDisaggregatedMatch[0].length;

            // Use balanced parenthesis matching to get the complete inner query
            const balancedMatch = this.matchBalancedParens(processedSql, afterFromIndex);

            if (balancedMatch) {
                const innerQuery = `SELECT patient_id${balancedMatch.text}`.trim();
                const afterInnerQuery = balancedMatch.endIndex;

                // Extract the outer alias (should be right after the closing paren)
                const aliasPattern = /\s*(\w+)([\s\S]*)/i;
                const aliasMatch = processedSql.substring(afterInnerQuery).match(aliasPattern);

                if (aliasMatch) {
                    const outerAlias = aliasMatch[1];
                    const restOfQuery = aliasMatch[2] || '';

                    result.patientIdColumn = (columnName === 'patient_id' || columnName === 'patient_id' || columnName === 'person_id')
                        ? columnName as PatientIdColumn
                        : 'patient_id';

                    // Build population SQL by converting COUNT DISTINCT to SELECT DISTINCT
                    const cleanedRest = restOfQuery.replace(/GROUP\s+BY\s+[\s\S]*?;?\s*$/i, '').trim();

                    const populationQuery = `SELECT DISTINCT ${outerAlias}.${columnName} AS patient_id
FROM (
  ${this.indent(innerQuery, 2)}
) ${outerAlias}
${cleanedRest}`.trim();

                    result.sql = populationQuery;
                    result.success = true;
                    result.warnings?.push('Extracted population SQL from TX-RTT disaggregated query');
                    console.log('📊 [Pattern 0] Generated population SQL, length:', populationQuery.length);
                    return result;
                }
            }
        }


        // Pattern 1: COUNT DISTINCT with FROM subquery that has JOINs
        // Handles both:
        // - SELECT COUNT(DISTINCT a.patient_id) FROM (SELECT ...) a
        // - SELECT 'PWIDS', COUNT(DISTINCT a.patient_id) FROM (SELECT ...) a
        // This is the most common pattern for CUSTOM indicators like TX_RTT, TX_ML
        //
        // We use balanced parenthesis matching to handle nested subqueries correctly
        const countDistinctPattern =
            /SELECT\s+(?:'[^']+'(?:\s*,\s*)?)?COUNT\s*\(\s*DISTINCT\s+(\w+)\.(\w+)\s*\)\s*(?:AS\s+\w+)?\s*FROM\s*\(\s*/i;
        const countDistinctMatch = processedSql.match(countDistinctPattern);

        if (countDistinctMatch) {
            const tableAlias = countDistinctMatch[1];
            const columnName = countDistinctMatch[2];

            // Find the position after "FROM ("
            const afterFromIndex = countDistinctMatch.index + countDistinctMatch[0].length;

            // Use balanced parenthesis matching to get the complete inner query
            const balancedMatch = this.matchBalancedParens(processedSql, afterFromIndex);

            if (balancedMatch) {
                const innerQuery = balancedMatch.text.trim();
                const afterInnerQuery = balancedMatch.endIndex;

                // Extract the outer alias (should be right after the closing paren)
                const aliasPattern = /\s*(\w+)([\s\S]*)/i;
                const aliasMatch = processedSql.substring(afterInnerQuery).match(aliasPattern);

                if (aliasMatch) {
                    const outerAlias = aliasMatch[1];
                    const restOfQuery = aliasMatch[2] || '';

                    console.log('🔍 [Pattern 1] COUNT DISTINCT matched:', {
                        tableAlias,
                        columnName,
                        outerAlias,
                        hasInnerQuery: !!innerQuery,
                        innerQueryLength: innerQuery.length,
                        restLength: restOfQuery.length
                    });

                    // Determine the patient ID column from the COUNT expression
                    // This normalizes patient_id/patient_id/person_id to a standard patient_id
                    result.patientIdColumn = (columnName === 'patient_id' || columnName === 'patient_id' || columnName === 'person_id')
                        ? columnName as PatientIdColumn
                        : 'patient_id';

                    // Build population SQL by converting COUNT DISTINCT to SELECT DISTINCT
                    // We preserve ALL the business logic:
                    // 1. The inner query (derived table) with all its logic
                    // 2. All JOINs from the outer query
                    // 3. All WHERE conditions from the outer query
                    //
                    // The only thing we change is the outer projection:
                    // FROM: SELECT COUNT(DISTINCT a.patient_id)
                    // TO:   SELECT DISTINCT a.patient_id AS patient_id
                    //
                    // This ensures we get patient-level rows, not a scalar count

                    // Remove trailing GROUP BY if present (legacy artifacts)
                    const cleanedRest = restOfQuery.replace(/GROUP\s+BY\s+[\s\S]*?;?\s*$/i, '').trim();

                    const populationQuery = `SELECT DISTINCT ${outerAlias}.${columnName} AS patient_id
FROM (
  ${this.indent(innerQuery, 2)}
) ${outerAlias}
${cleanedRest}`.trim();

                    result.sql = populationQuery;
                    result.success = true;
                    result.warnings?.push('Extracted population SQL from COUNT DISTINCT query');
                    console.log('✅ [Pattern 1] Generated population SQL, length:', populationQuery.length);
                    return result;
                }
            }
        }

        // Pattern 2: Simple population query (already in correct format)
        // Handles both:
        // - SELECT DISTINCT a.patient_id AS patient_id FROM ...
        // - SELECT DISTINCT a.patient_id FROM (...) a ...
        // This is for indicators like PIPS and sqlPreview that already have population SQL structure
        const populationQueryPatterns = [
            // Pattern 2a: With AS alias (SELECT DISTINCT a.patient_id AS patient_id FROM ...)
            /SELECT\s+DISTINCT\s+(\w+\.\w+)\s+AS\s+(?:patient_id|patient_id)(?:\s+FROM\s+[\s\S]+)?/i,
            // Pattern 2b: Without AS alias, followed by FROM (SELECT DISTINCT a.patient_id FROM ...)
            /SELECT\s+DISTINCT\s+(\w+\.\w+)\s+FROM\s+/i,
        ];

        for (const pattern of populationQueryPatterns) {
            const match = processedSql.match(pattern);
            if (match && match[1]) {
                console.log('✅ [Interpreter] Detected simple population query, using as-is');
                // Extract patient ID column from the match
                const columnRef = match[1]; // e.g., 'a.patient_id'
                const idColumn = columnRef.includes('.') ? columnRef.split('.')[1] : columnRef;
                result.patientIdColumn = (idColumn === 'patient_id' || idColumn === 'patient_id' || idColumn === 'person_id')
                    ? idColumn as PatientIdColumn
                    : 'patient_id';

                // If the SQL doesn't have an AS alias for the patient_id, add one for consistency
                // This ensures the column name matches what applyDisaggregation expects
                if (!/\s+AS\s+(?:patient_id|patient_id)\s*FROM/i.test(processedSql)) {
                    // Add AS alias
                    result.sql = processedSql.replace(
                        new RegExp(`SELECT\\s+DISTINCT\\s+${columnRef.replace('.', '\\.')}\\s+FROM`, 'i'),
                        `SELECT DISTINCT ${columnRef} AS ${result.patientIdColumn} FROM`
                    );
                } else {
                    result.sql = processedSql;
                }

                result.success = true;
                result.warnings?.push('Using simple population query as-is');
                return result;
            }
        }

        // Pattern 3: Already-disaggregated query with age_group/sex and COUNT
        // SELECT ... AS age_group, ... AS sex, COUNT(...) AS value FROM (subquery) a ... GROUP BY age_group, sex
        // Use balanced parenthesis matching to handle nested subqueries
        const alreadyDisaggPattern =
            /SELECT\s+[\s\S]*?AS\s+age_group[\s\S]*?AS\s+(?:sex|gender)[\s\S]*?COUNT\s*\([\s\S]*?\)\s*(?:AS\s+\w+)?\s+FROM\s*\(\s*/i;
        const alreadyDisaggMatch = processedSql.match(alreadyDisaggPattern);

        if (alreadyDisaggMatch) {
            console.log('✅ [Interpreter] Detected already-disaggregated query, extracting population SQL');

            // Find the position after "FROM ("
            const afterFromIndex = alreadyDisaggMatch.index + alreadyDisaggMatch[0].length;

            // Use balanced parenthesis matching to get the complete inner query
            const balancedMatch = this.matchBalancedParens(processedSql, afterFromIndex);

            if (balancedMatch) {
                const innerQuery = balancedMatch.text.trim();
                const afterInnerQuery = balancedMatch.endIndex;

                // Extract the outer alias (should be right after the closing paren)
                const aliasPattern = /\s*(\w+)([\s\S]*?)GROUP\s+BY\s+(?:age_group|months|lost)[\s\S]*?,\s*(?:sex|gender)/i;
                const aliasMatch = processedSql.substring(afterInnerQuery).match(aliasPattern);

                if (aliasMatch) {
                    const outerAlias = aliasMatch[1];
                    const restOfQuery = aliasMatch[2] || '';

                    // Try to find patient_id column in the inner query
                    const patientIdMatch = innerQuery.match(/(?:FROM|JOIN)\s+(\w+)\.(?:\w+)?\s+(?:\w+)\s+ON|(?:\w+\.)?(patient_id|patient_id|person_id)/i);
                    const patientIdColumn = patientIdMatch ? (patientIdMatch[1] || patientIdMatch[2]) as PatientIdColumn : 'patient_id';

                    result.patientIdColumn = patientIdColumn;
                    // Reconstruct the population query including the JOINs and WHERE conditions
                    result.sql = `SELECT DISTINCT ${outerAlias}.${patientIdColumn} AS patient_id\nFROM (\n  ${this.indent(innerQuery, 2)}\n) ${outerAlias}${restOfQuery.trim()}`.replace(/GROUP\s+BY\s+[\s\S]*?;/i, ';');
                    result.success = true;
                    result.warnings?.push('Extracted population SQL from already-disaggregated query');
                    return result;
                }
            }
        }

        // Pattern 4: Complex WITH clause with built-in disaggregation
        // WITH base_pop AS (SELECT age_group, sex, COUNT(*) FROM (population_query) ...)
        // Use balanced parenthesis matching to handle nested subqueries
        const complexWithPattern =
            /WITH\s+\w+\s+AS\s*\(\s*SELECT\s+[\s\S]*?FROM\s*\(\s*/i;
        const withMatch = processedSql.match(complexWithPattern);

        if (withMatch) {
            // Find the position after "FROM ("
            const afterFromIndex = withMatch.index + withMatch[0].length;

            // Use balanced parenthesis matching to get the complete inner query
            const balancedMatch = this.matchBalancedParens(processedSql, afterFromIndex);

            if (balancedMatch) {
                const populationSql = balancedMatch.text.trim();

                if (/GROUP\s+BY\s+(patient_id|patient_id|person_id)/i.test(populationSql)) {
                    const patientIdMatch = populationSql.match(/GROUP\s+BY\s+(patient_id|patient_id|person_id)/i);
                    if (patientIdMatch) {
                        result.patientIdColumn = patientIdMatch[1] as PatientIdColumn;
                    }

                    result.sql = populationSql;
                    result.success = true;
                    result.warnings?.push('Extracted population SQL from complex WITH clause');
                    return result;
                }
            }
        }

        // Pattern 5: Simple COUNT query without recognizable structure
        if (/SELECT\s+COUNT\s*\(/i.test(processedSql)) {
            result.warnings?.push('CUSTOM_POPULATION_AGGREGATED: SQL returns COUNT(...) instead of patient-level rows');
            result.warnings?.push('The indicator SQL is a metric query, not a population query.');
            result.warnings?.push('Expected: SELECT DISTINCT patient_id FROM ...');
            result.warnings?.push('Got: SELECT COUNT(...) FROM ...');
            result.warnings?.push('To fix: Add explicit populationSql to the indicator configuration, or modify the SQL to return patient-level rows.');
            return result;
        }

        // No pattern matched - return structured error
        result.warnings?.push('CUSTOM_SQL_EXTRACTION_FAILED: Unable to safely derive population SQL from CUSTOM indicator SQL');
        result.warnings?.push('The SQL structure is not recognized as a valid population query.');
        result.warnings?.push('Expected patterns:');
        result.warnings?.push('  - SELECT COUNT(DISTINCT table.column) FROM (...) alias ...');
        result.warnings?.push('  - SELECT DISTINCT table.column AS patient_id FROM ...');
        result.warnings?.push('  - Already-disaggregated query with age_group/sex');
        result.warnings?.push('');
        result.warnings?.push('To fix this issue:');
        result.warnings?.push('  1. Add explicit populationSql to the indicator configJson:');
        result.warnings?.push('     {"populationSql": "SELECT DISTINCT a.patient_id AS patient_id FROM ..."}');
        result.warnings?.push('  2. Ensure the SQL follows one of the recognized patterns above');
        result.warnings?.push('  3. Contact administrator if the SQL structure is correct but not recognized');

        console.error('❌ [Interpreter] No matching pattern for SQL extraction');
        return result;
    }

    /**
     * Apply section disaggregation while preserving filters
     *
     * @param sql - The population SQL
     * @param sectionConfig - Section configuration for disaggregation
     * @param config - Custom indicator configuration
     * @returns SQL with section disaggregation applied
     */
    applyDisaggregation(
        sql: string,
        sectionConfig: { ageCategoryCode: string; genders: Array<'F' | 'M'> },
        config?: CustomIndicatorConfig
    ): string {
        if (!sql || !sql.trim()) {
            return `-- Error: CUSTOM_POPULATION_EMPTY
-- Empty population SQL provided for disaggregation.
-- Ensure the indicator has a valid population query.`;
        }

        // Validation: Check if SQL is already a scalar metric (not a population query)
        if (/SELECT\s+COUNT\s*\(/i.test(sql) && !/SELECT\s+DISTINCT/i.test(sql)) {
            return `-- Error: CUSTOM_POPULATION_AGGREGATED
-- The provided SQL is a metric query (COUNT), not a population query.
-- Section disaggregation requires patient-level rows.
-- Expected: SELECT DISTINCT patient_id FROM ...
-- Got: ${sql.substring(0, 100)}...`;
        }

        // Validation: Check if SQL is already disaggregated (contains age_group in projection)
        // This must come before the patient_id check to properly reject queries like:
        // SELECT age_group, gender, COUNT(*) FROM ... GROUP BY age_group, gender
        if (/SELECT\s+.*?AS\s+age_group.*?FROM/i.test(sql)) {
            return `-- Error: CUSTOM_ALREADY_DISAGGREGATED
-- Population SQL contains age_group disaggregation.
-- Section disaggregation requires raw patient-level population without age/gender.
-- Remove age_group, sex, or gender columns from the population query projection.`;
        }

        // Validation: Check if SQL exposes patient_id column
        const hasPatientId = /patient_id\s*(?:AS|FROM|$)/i.test(sql) ||
                             /(?:patient_id|person_id)\s+AS\s+patient_id/i.test(sql);

        if (!hasPatientId) {
            return `-- Error: CUSTOM_PATIENT_ID_MISSING
-- Population SQL does not expose the required patient_id column.
-- Expected: SELECT DISTINCT ... AS patient_id FROM ...
-- Got: ${sql.substring(0, 100)}...`;
        }

        // Remove trailing semicolons - they cause "Multiple statements" errors when used in CTEs
        const cleanedSql = sql.trim().replace(/;+\s*$/, '');

        const patientIdCol = config?.patientIdColumn || 'patient_id';
        const selectedGenders = sectionConfig.genders.length ? sectionConfig.genders : ['F', 'M'];
        const genderList = selectedGenders.map((g) => `'${g}'`).join(',');

        return `
WITH base_pop AS (
  ${this.indent(cleanedSql, 2)}
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
  WHERE ac.code = '${sectionConfig.ageCategoryCode}'
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
    COUNT(DISTINCT base_pop.${patientIdCol}) AS value
  FROM base_pop
  JOIN mamba_fact_patients_latest_patient_demographics mdp
    ON mdp.${patientIdCol} = base_pop.${patientIdCol}
  JOIN ag
    ON TIMESTAMPDIFF(DAY, mdp.birthdate, :endDate)
       BETWEEN ag.min_age_days AND ag.max_age_days
  WHERE mdp.birthdate IS NOT NULL
    AND mdp.gender IS NOT NULL
    AND mdp.gender IN (${genderList})
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
ORDER BY ag.sort_order, g.gender;`.trim();
    }

    /**
     * Validate custom indicator configuration
     *
     * @param config - Custom indicator configuration to validate
     * @param sql - Optional SQL template for validation
     * @returns Validation result
     */
    validate(config: CustomIndicatorConfig, sql?: string): ValidationResult {
        const result: ValidationResult = {
            valid: true,
            errors: [],
            warnings: [],
            info: []
        };

        // Validate required fields
        if (!config.patientIdColumn) {
            result.errors.push('patientIdColumn is required');
            result.valid = false;
        }

        if (!config.populationQuery) {
            result.errors.push('populationQuery configuration is required');
            result.valid = false;
        }

        if (!config.supportsRedisaggregation && config.redisaggregationStrategy !== 'none') {
            result.warnings.push('Redisaggregation strategy set but supportsRedisaggregation is false');
        }

        // Validate SQL if provided
        if (sql && sql.trim()) {
            const analysis = this.analyze(sql, config);

            if (!analysis.hasPopulationQuery && config.supportsRedisaggregation) {
                result.warnings.push('SQL does not appear to have a clear population query structure');
            }

            if (analysis.patientIdColumn !== config.patientIdColumn) {
                result.warnings.push(`Configured patientIdColumn (${config.patientIdColumn}) differs from detected (${analysis.patientIdColumn})`);
            }

            if (config.supportsRedisaggregation && !analysis.redisaggregatable) {
                result.errors.push('SQL structure does not support re-disaggregation');
                result.valid = false;
            }

            result.info.push(`Query analysis confidence: ${Math.round(analysis.confidence * 100)}%`);
        }

        // Validate filter preservation rules
        if (config.preserveFilters && config.preserveFilters.length > 0) {
            for (const filter of config.preserveFilters) {
                if (!filter.name || !filter.joinPattern || !filter.wherePattern) {
                    result.errors.push(`Filter "${filter.name}" is missing required patterns`);
                    result.valid = false;
                }
            }
        }

        return result;
    }

    /**
     * Detect patient ID column from SQL
     *
     * @param sql - SQL to analyze
     * @returns Detected patient ID column
     */
    private detectPatientIdColumn(sql: string): PatientIdColumn {
        const patterns = [
            { column: 'patient_id' as PatientIdColumn, pattern: /\bpatient_id\b/i },
            { column: 'patient_id' as PatientIdColumn, pattern: /\bpatient_id\b/i },
            { column: 'person_id' as PatientIdColumn, pattern: /\bperson_id\b/i }
        ];

        // Count occurrences of each patient ID column
        const counts = patterns.map(({ column, pattern }) => ({
            column,
            count: (sql.match(pattern) || []).length
        }));

        // Return the most common patient ID column
        const mostCommon = counts.sort((a, b) => b.count - a.count)[0];
        return mostCommon.count > 0 ? mostCommon.column : 'patient_id';
    }

    /**
     * Match a balanced parenthesis group in SQL
     * Handles nested subqueries by counting opening/closing parens
     *
     * @param sql - SQL string to match
     * @param startIndex - Index to start matching from (after opening paren)
     * @returns Object with matched text and end index, or null if no match
     */
    private matchBalancedParens(sql: string, startIndex: number): { text: string; endIndex: number } | null {
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
     * Indent SQL by a number of spaces
     *
     * @param sql - SQL to indent
     * @param spaces - Number of spaces to indent
     * @returns Indented SQL
     */
    private indent(sql: string, spaces: number): string {
        const pad = ' '.repeat(spaces);
        return sql
            .split('\n')
            .map((line) => (line.trim() ? pad + line : line))
            .join('\n');
    }
}

/**
 * Singleton instance of the query interpreter
 */
export const customIndicatorInterpreter = new CustomIndicatorInterpreter();