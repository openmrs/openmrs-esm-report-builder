/**
 * Linelist Config Compiler
 *
 * Transforms the builder's intermediate configJson (LinelistReportDefinitionConfig)
 * into the backend's final report definition format.
 *
 * The builder stores a rich intermediate representation that tracks UI state
 * (data sources, column sources, indicator rules). The backend expects a
 * leaner format with proper OpenMRS data definition types.
 *
 * Compilation rules:
 *  1. Parameters: strip `required` / `config`, keep name/label/type
 *  2. SQL params: `':startDate'` → `:startDate` (unquoted bind params)
 *  3. Simple `table.column` SQL refs → proper OpenMRS data definition types
 *  4. ETL column refs → per-row SQL subqueries with :patientId
 *  5. Custom SQL (per-row queries) → kept as-is
 *  6. CALCULATION onDate: `true` → `':startDate'` (parameter reference format)
 *  7. PERSON_ADDRESS: type='ADDRESS_FIELD', field='address5' (lowercase)
 *  8. Strip builder-only metadata (dataSources, rowGrain, indicatorRules, etc.)
 *  9. Add backend fields (reportType, category, status)
 */

import type { LinelistReportDefinitionConfig } from '../linelist-types';

// ============================================================================
// TYPES — Backend report definition format
// ============================================================================

export type BackendParameter = {
  name: string;
  label: string;
  type: string;
  required: boolean;
};

export type BackendDataDefinition = {
  type: string;
  config: Record<string, any>;
};

export type BackendColumn = {
  name: string;
  key?: string;
  dataDefinition: BackendDataDefinition;
  repeatResolution?: {
    strategy: string;
    [key: string]: any;
  };
  converter?: {
    type: string;
    config: Record<string, any>;
  };
  _metadata?: {
    id?: string;
    position?: number;
  };
};

export type BackendCohortDefinition = {
  type: 'SQL';
  name: string;
  config: { sql: string; filterMap?: Record<string, string> };
};

export type BackendDataSetDefinition = {
  name: string;
  type: 'PATIENT_DATA_SET';
  rowFilter: BackendCohortDefinition;
  columns: BackendColumn[];
};

export type BackendReportConfig = {
  name: string;
  description?: string;
  uuid?: string;
  version?: string;
  status?: string;
  parameters: BackendParameter[];
  baseCohortDefinition: BackendCohortDefinition;
  dataSetDefinitions: BackendDataSetDefinition[];
  category?: string;
  reportType: string;
  limit?: number;
};

// ============================================================================
// COMPILATION RULES
// ============================================================================

/**
 * Rule 1: Compile parameters — keep name/label/type/required (matches
 * LegacyGenericReportSchema.Parameter), strip the builder-only `config` field.
 */
function compileParameters(
  params: LinelistReportDefinitionConfig['parameters']
): BackendParameter[] {
  if (!params || params.length === 0) {
    return [
      { name: 'startDate', label: 'Start Date', type: 'DATE', required: true },
      { name: 'endDate', label: 'End Date', type: 'DATE', required: true },
    ];
  }
  return params.map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    required: p.required ?? false,
  }));
}

/**
 * Convert a display name into a snake_case key (e.g. "Full Name" → "full_name")
 * LegacyGenericReportSchema.Column requires both `name` (display) and `key`.
 */
function nameToKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Rule 2: Fix SQL parameter syntax
 * Converts ':startDate' → :startDate, ':endDate' → :endDate
 * Removes quotes around bind parameters so the backend treats them as params
 */
function compileSqlParams(sql: string): string {
  return sql
    .replace(/':(\w+)'/g, ':$1') // ':param' → :param
    .replace(/":(\w+)"/g, ':$1'); // ":param" → :param
}

/**
 * Rule 3 & 4: Compile a column's data definition
 *
 * Simple `table.column` references are mapped to their proper OpenMRS types.
 * ETL table references become per-row subqueries.
 * Custom SQL queries are kept as-is.
 */
function compileColumn(
  col: any,
  dataSourceColumns?: Record<string, { name: string; type: string; sourceTable: string }>
): BackendColumn {
  const def = col.dataDefinition || {};
  const defType = def.type;
  const defConfig = def.config || {};
  const sql: string = defConfig.sql || '';

  // Extract metadata (if present) to preserve column position
  const colMetadata = col._metadata || col._meta || null;

  // --- Detect column type ---
  const isCustomSql = /^\s*SELECT\s/i.test(sql) || /:patientId\b/i.test(sql);
  const simpleRefMatch = sql.match(/`?(\w+)`?\.\s*`?(\w+)`?/);

  // --- CUSTOM SQL: keep as-is ---
  if (isCustomSql) {
    const compiled: BackendColumn = {
      name: col.name,
      dataDefinition: { type: 'SQL', config: { sql } },
      ...(col.repeatResolution ? { repeatResolution: col.repeatResolution } : {}),
      ...(colMetadata ? { _metadata: colMetadata } : {}),
    };
    return compiled;
  }

  // --- CALCULATION: fix onDate ---
  if (defType === 'CALCULATION') {
    // Use :startDate parameter format for backend
    // If onDate is true or not set, default to :startDate
    // Otherwise keep the existing value if it's already a parameter reference
    const onDateValue = defConfig.onDate;
    let finalOnDate: string;
    if (onDateValue === true || onDateValue === undefined || onDateValue === '') {
      finalOnDate = ':startDate';
    } else if (typeof onDateValue === 'string') {
      // If it's already a parameter reference (starts with :), use it as-is
      // Otherwise if it contains ${startDate}, replace with :startDate
      finalOnDate = onDateValue.startsWith(':') ? onDateValue : onDateValue.replace('${startDate}', ':startDate').replace(/\$\{endDate\}/g, ':endDate');
    } else {
      finalOnDate = ':startDate';
    }

    return {
      name: col.name,
      dataDefinition: {
        type: 'CALCULATION',
        config: {
          ...defConfig,
          onDate: finalOnDate,
        },
      },
      ...(colMetadata ? { _metadata: colMetadata } : {}),
    };
  }

  // --- IDENTIFIER: set preferred true ---
  if (defType === 'IDENTIFIER') {
    return {
      name: col.name,
      dataDefinition: {
        type: 'IDENTIFIER',
        config: { ...defConfig, preferred: true },
      },
      ...(col.repeatResolution ? { repeatResolution: col.repeatResolution } : {}),
      ...(colMetadata ? { _metadata: colMetadata } : {}),
    };
  }

  // --- PERSON_ATTRIBUTE / PERSON_NAME: keep as-is ---
  if (defType === 'PERSON_ATTRIBUTE' || defType === 'PERSON_NAME') {
    return {
      name: col.name,
      dataDefinition: { type: defType, config: defConfig },
      ...(col.repeatResolution ? { repeatResolution: col.repeatResolution } : {}),
      ...(colMetadata ? { _metadata: colMetadata } : {}),
    };
  }

  // --- SQL with simple table.column reference: compile ---
  if (defType === 'SQL' && simpleRefMatch) {
    const [, table, field] = simpleRefMatch;
    const compiled = compileSimpleReference(col.name, table, field, dataSourceColumns);
    if (compiled) {
      return {
        ...compiled,
        ...(col.repeatResolution ? { repeatResolution: col.repeatResolution } : {}),
        ...(colMetadata ? { _metadata: colMetadata } : {}),
      };
    }
  }

  // --- Fallback: keep as-is ---
  return {
    name: col.name,
    dataDefinition: { type: defType || 'SQL', config: defConfig },
    ...(col.repeatResolution ? { repeatResolution: col.repeatResolution } : {}),
    ...(colMetadata ? { _metadata: colMetadata } : {}),
  };
}

/**
 * Compile a simple `table.column` reference into the proper OpenMRS type.
 *
 * Mapping rules:
 *   person.*           → PERSON_NAME / PERSON_ATTRIBUTE
 *   person_address.*   → PERSON_ADDRESS
 *   mamba_* (ETL)      → per-row SQL subquery with :patientId
 */
function compileSimpleReference(
  columnName: string,
  table: string,
  field: string,
  dataSourceColumns?: Record<string, { name: string; type: string; sourceTable: string }>
): BackendColumn | null {
  const lowerField = field.toLowerCase();

  // --- PERSON table ---
  if (table === 'person') {
    // Name fields
    if (lowerField.includes('name') || lowerField.includes('full_name')) {
      return {
        name: columnName,
        dataDefinition: {
          type: 'PERSON_NAME',
          config: { type: 'FULL_NAME', preferred: true },
        },
      };
    }
    // Gender
    if (lowerField === 'gender' || lowerField === 'sex') {
      return {
        name: columnName,
        dataDefinition: {
          type: 'PERSON_ATTRIBUTE',
          config: { type: 'GENDER' },
        },
      };
    }
    // Birthdate
    if (lowerField.includes('birthdate') || lowerField.includes('birth_date')) {
      return {
        name: columnName,
        dataDefinition: {
          type: 'PERSON_ATTRIBUTE',
          config: { type: 'BIRTHDATE' },
        },
        converter: {
          type: 'BIRTHDATE_AGE',
          config: { format: 'MMM dd,yyyy' },
        },
      };
    }
    // Death date
    if (lowerField.includes('death')) {
      return {
        name: columnName,
        dataDefinition: {
          type: 'PERSON_ATTRIBUTE',
          config: { type: 'DEATH_DATE' },
        },
      };
    }
  }

  // --- PERSON_ADDRESS table ---
  if (table === 'person_address') {
    // Map common address fields to OpenMRS address field names (UgandaEMR template)
    // Use lowercase field names to match backend expectation
    const addressFieldMap: Record<string, string> = {
      address1: 'address1',
      address2: 'address2',
      address3: 'address3',  // Subcounty in UgandaEMR
      address4: 'address4',  // Parish in UgandaEMR
      address5: 'address5',  // Village in UgandaEMR
      city_village: 'address5',  // Legacy mapping - village is now address5
      state_province: 'stateProvince',  // County in UgandaEMR
      country: 'country',
      postal_code: 'postalCode',
      county_district: 'countyDistrict',  // District in UgandaEMR
      latitude: 'latitude',
      longitude: 'longitude',
    };
    return {
      name: columnName,
      dataDefinition: {
        type: 'PERSON_ADDRESS',
        config: {
          type: 'ADDRESS_FIELD',
          field: addressFieldMap[lowerField] || field,
        },
      },
    };
  }

  // --- ETL table (mamba_*) → per-row subquery ---
  if (table.startsWith('mamba_') || table.startsWith('etl_')) {
    // Look up column metadata to determine if it's a date column
    const colMeta = dataSourceColumns?.[columnName];
    const isDateColumn = colMeta?.type === 'DATE' || lowerField.includes('date');

    // Build per-row subquery
    let subquery = `SELECT e.${field} FROM ${table} e WHERE e.patient_id = :patientId`;

    // Add voided filter for encounter/observation tables
    if (/encounter|obs|visit|appointment/i.test(table)) {
      subquery += ` AND e.voided = 0`;
    }

    // Add date range filter for date columns
    if (isDateColumn) {
      const dateColumn = lowerField.includes('return_visit') ? 'return_visit_date' : field;
      subquery += ` AND e.${dateColumn} BETWEEN :startDate AND :endDate`;
      subquery += ` ORDER BY e.${dateColumn} DESC LIMIT 1`;
    } else {
      subquery += ` LIMIT 1`;
    }

    return {
      name: columnName,
      dataDefinition: {
        type: 'SQL',
        config: { sql: subquery },
      },
    };
  }

  // --- Unknown table: keep as simple SQL reference ---
  return {
    name: columnName,
    dataDefinition: {
      type: 'SQL',
      config: { sql: `\`${table}\`.\`${field}\`` },
    },
  };
}

/**
 * Compile cohort definition — fix SQL parameter syntax and preserve filterMap
 */
function compileCohortDefinition(
  cohort: LinelistReportDefinitionConfig['baseCohortDefinition']
): BackendCohortDefinition {
  return {
    type: 'SQL',
    name: cohort.name,
    config: {
      sql: compileSqlParams(cohort.config.sql),
      ...(cohort.config.filterMap && { filterMap: cohort.config.filterMap }),
    },
  };
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Compile the builder's intermediate config into the backend's final format.
 *
 * @param config - The builder configJson (LinelistReportDefinitionConfig)
 * @param reportMeta - Report name, description, category
 * @returns Backend-ready report configuration
 */
export function compileToBackendConfig(
  config: LinelistReportDefinitionConfig,
  reportMeta: {
    name: string;
    description?: string;
    code?: string;
    categoryUuid?: string;
  }
): BackendReportConfig {
  // Build a column metadata lookup from the dataSources for ETL compilation
  const columnMetaLookup: Record<string, { name: string; type: string; sourceTable: string }> = {};
  (config.dataSources || []).forEach((ds: any) => {
    if (ds.columns) {
      Object.entries(ds.columns).forEach(([key, colInfo]: [string, any]) => {
        columnMetaLookup[key] = {
          name: colInfo.name,
          type: colInfo.type,
          sourceTable: colInfo.sourceTable,
        };
      });
    }
  });

  // Compile dataset definitions
  const dataSetDefinitions: BackendDataSetDefinition[] = (config.dataSetDefinitions || []).map(
    (ds) => {
      const compiledCohort = compileCohortDefinition(config.baseCohortDefinition);
      return {
        name: ds.name,
        type: 'PATIENT_DATA_SET',
        rowFilter: compiledCohort,
        columns: (ds.columns || []).map((col) => {
          const compiled = compileColumn(col, columnMetaLookup);
          // Ensure every column has a `key` (LegacyGenericReportSchema requires it)
          return { ...compiled, key: compiled.key || nameToKey(compiled.name) };
        }),
      };
    }
  );

  return {
    name: reportMeta.name,
    description: reportMeta.description,
    parameters: compileParameters(config.parameters),
    baseCohortDefinition: compileCohortDefinition(config.baseCohortDefinition),
    dataSetDefinitions,
    category: reportMeta.categoryUuid || 'FACILITY_REPORTS',
    reportType: 'LINELIST',
    ...(config.limit ? { limit: config.limit } : {}),
  };
}
