/**
 * Cohort SQL Editor Component for Linelist Reports
 *
 * This component provides a SQL editor for writing patient selection queries.
 * It includes:
 * - SQL code editor with syntax highlighting
 * - Visual filter builder for non-SQL users
 * - Parameter validation (must include :startDate and :endDate)
 * - Quick templates for common queries
 * - SQL preview with validation
 *
 * Reuses patterns from indicator-sql-preview.section.tsx
 */

import React, { useState, useEffect } from 'react';
import {
  Stack,
  Button,
  InlineNotification,
  ComposedModal,
  ModalBody,
  ModalFooter,
  DataTable,
  TableRow,
  TableCell,
  TableBody,
} from '@carbon/react';
import { Information, Checkmark, Warning } from '@carbon/react/icons';
import VisualFilterBuilder from './visual-filter-panel.component';
import type { VisualFilterState, FilterFieldType, FilterMap } from '../../../../types/linelist-types';
import styles from './cohort-sql-editor.scss';
import FilterMapEditor from './filtermap-editor.component';

type Props = {
  sql: string;
  onChange: (sql: string) => void;
  disabled?: boolean;
  error?: string;
  visualFilter?: VisualFilterState;
  onVisualFilterChange?: (visualFilter: VisualFilterState) => void;
  availableFields?: Array<{ name: string; label: string; type: FilterFieldType }>;
  filterMap?: FilterMap;
  onFilterMapChange?: (filterMap: FilterMap | undefined) => void;
};

/**
 * Common SQL templates for linelist cohort queries
 */
const SQL_TEMPLATES: Array<{
  id: string;
  label: string;
  description: string;
  sql: string;
}> = [
  {
    id: 'all_patients',
    label: 'All Patients',
    description: 'Select all patients registered in the system',
    sql: `SELECT DISTINCT client_id
FROM mamba_fact_patients_latest_patient_demographics
WHERE 1=1
  AND :startDate <= :endDate`,
  },
  {
    id: 'art_patients',
    label: 'ART Patients',
    description: 'Patients on ART treatment',
    sql: `SELECT DISTINCT client_id
FROM mamba_fact_patients_latest_patient_demographics
WHERE art_start_date IS NOT NULL
  AND art_start_date BETWEEN :startDate AND :endDate`,
  },
  {
    id: 'new_art_patients',
    label: 'New ART Patients',
    description: 'Patients newly initiated on ART',
    sql: `SELECT DISTINCT client_id
FROM mamba_fact_patients_latest_patient_demographics
WHERE art_start_date BETWEEN :startDate AND :endDate`,
  },
  {
    id: 'encounter_patients',
    label: 'Patients with Encounters',
    description: 'Patients who had clinical encounters',
    sql: `SELECT DISTINCT client_id
FROM mamba_fact_encounter
WHERE encounter_date BETWEEN :startDate AND :endDate`,
  },
  {
    id: 'appointment_missed',
    label: 'Missed Appointments',
    description: 'Patients who missed appointments',
    sql: `SELECT DISTINCT client_id
FROM mamba_fact_appointment
WHERE appointment_date BETWEEN :startDate AND :endDate
  AND attendance_status = 'Missed'`,
  },
  {
    id: 'due_vl',
    label: 'Due for Viral Load',
    description: 'Patients due for viral load testing',
    sql: `SELECT DISTINCT client_id
FROM mamba_fact_patients_latest_viral_load
WHERE (
  last_vl_result IS NULL
  OR last_vl_date IS NULL
  OR DATEDIFF(:endDate, last_vl_date) > 365
)
AND :startDate <= :endDate`,
  },
  {
    id: 'high_vl',
    label: 'High Viral Load',
    description: 'Patients with viral load > 1000 copies',
    sql: `SELECT DISTINCT client_id
FROM mamba_fact_patients_latest_viral_load
WHERE last_vl_result > 1000
  AND last_vl_date BETWEEN :startDate AND :endDate`,
  },
];

/**
 * SQL keywords for syntax highlighting
 */
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'NOT IN',
  'BETWEEN',
  'LIKE',
  'IS NULL',
  'IS NOT NULL',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'ON',
  'AS',
  'DISTINCT',
  'ORDER BY',
  'GROUP BY',
  'HAVING',
  'UNION',
  'UNION ALL',
  'EXISTS',
  'NOT EXISTS',
];

/**
 * Validate SQL for required parameters
 */
function validateSql(sql: string): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const trimmed = sql.trim();

  if (!trimmed) {
    errors.push('SQL query is required');
    return { valid: false, errors, warnings };
  }

  // Check for required parameters
  if (!trimmed.includes(':startDate')) {
    errors.push('SQL must include :startDate parameter');
  }

  if (!trimmed.includes(':endDate')) {
    errors.push('SQL must include :endDate parameter');
  }

  // Check for SELECT statement
  const upperSql = trimmed.toUpperCase();
  if (!upperSql.includes('SELECT')) {
    errors.push('SQL must include a SELECT statement');
  }

  // Check for patient_id column
  if (!upperSql.includes('PATIENT_ID') && !upperSql.includes('CLIENT_ID')) {
    warnings.push('SQL should select patient_id or client_id column');
  }

  // Check for DISTINCT (recommended for patient lists)
  if (!upperSql.includes('DISTINCT')) {
    warnings.push('Consider using SELECT DISTINCT to avoid duplicate patients');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Basic SQL syntax highlighting
 */
function highlightSql(sql: string): string {
  let highlighted = sql;

  // Highlight parameters
  highlighted = highlighted.replace(/:(startDate|endDate)/g, '<span class="sql-parameter">:$1</span>');

  // Highlight strings
  highlighted = highlighted.replace(/'([^']*)'/g, '<span class="sql-string">\'$1\'</span>');

  // Highlight numbers
  highlighted = highlighted.replace(/\b(\d+)\b/g, '<span class="sql-number">$1</span>');

  // Highlight comments
  highlighted = highlighted.replace(/--(.*)$/gm, '<span class="sql-comment">--$1</span>');

  // Highlight keywords
  SQL_KEYWORDS.forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    highlighted = highlighted.replace(regex, `<span class="sql-keyword">${keyword}</span>`);
  });

  return highlighted;
}

export default function CohortSQLEditor({
  sql,
  onChange,
  disabled = false,
  error,
  visualFilter,
  onVisualFilterChange,
  availableFields = [],
  filterMap,
  onFilterMapChange,
}: Props) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validation, setValidation] = useState(validateSql(sql));

  // Update validation when SQL changes
  useEffect(() => {
    setValidation(validateSql(sql));
  }, [sql]);

  /**
   * Apply a template to the SQL editor
   */
  const applyTemplate = (template: typeof SQL_TEMPLATES[number]) => {
    onChange(template.sql);
    setShowTemplates(false);
  };

  /**
   * Format SQL (basic formatting)
   */
  const formatSql = () => {
    let formatted = sql.trim();

    // Basic formatting: add newlines after major keywords
    SQL_KEYWORDS.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      formatted = formatted.replace(regex, `${keyword}\n`);
    });

    // Clean up extra newlines
    formatted = formatted.replace(/\n\s*\n/g, '\n');

    onChange(formatted);
  };

  const hasErrors = validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;

  return (
    <div className={styles.container}>
      <Stack gap={4}>
        {/* Header with actions */}
        <div className={styles.header}>
          <h4 className={styles.title}>Patient Selection SQL</h4>
          <div className={styles.actions}>
            <Button kind="ghost" size="sm" onClick={() => setShowTemplates(true)} disabled={disabled}>
              Load Template
            </Button>
            <Button kind="ghost" size="sm" onClick={formatSql} disabled={disabled || !sql.trim()}>
              Format SQL
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setShowValidation(!showValidation)} disabled={disabled}>
              {showValidation ? 'Hide' : 'Show'} Validation
            </Button>
          </div>
        </div>

        {/* Helper text */}
        <p className={styles.helperText}>
          Write a SQL query that returns patient IDs. Use <code>:startDate</code> and <code>:endDate</code> parameters
          for date filtering. The query should use <code>SELECT DISTINCT patient_id</code> to ensure unique
          patients.
        </p>

        {/* Visual Filter Builder */}
        {onVisualFilterChange && visualFilter && (
          <VisualFilterBuilder
            visualFilter={visualFilter}
            onChange={onVisualFilterChange}
            onSqlChange={onChange}
            availableFields={availableFields}
            disabled={disabled}
          />
        )}

        {/* FilterMap Editor */}
        {onFilterMapChange && (
          <FilterMapEditor
            filterMap={filterMap}
            onChange={onFilterMapChange}
            disabled={disabled}
            sqlQuery={sql}
          />
        )}

        {/* Validation summary */}
        {(hasErrors || hasWarnings) && (
          <div className={styles.validationSummary}>
            {hasErrors && (
              <InlineNotification
                kind="error"
                title="SQL Validation Errors"
                subtitle={validation.errors.join(', ')}
                hideCloseButton
                lowContrast
              />
            )}
            {!hasErrors && hasWarnings && (
              <InlineNotification
                kind="warning"
                title="SQL Warnings"
                subtitle={validation.warnings.join(', ')}
                hideCloseButton
                lowContrast
              />
            )}
            {!hasErrors && !hasWarnings && (
              <InlineNotification
                kind="success"
                title="SQL Valid"
                subtitle="Your SQL query looks good!"
                hideCloseButton
                lowContrast
              />
            )}
          </div>
        )}

        {/* SQL Editor */}
        <div className={styles.editorWrapper}>
          <textarea
            value={sql}
            onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
            disabled={disabled}
            className={styles.sqlEditor}
            placeholder="Enter your SQL query here..."
            spellCheck={false}
          />

          {/* Syntax highlighted preview (read-only) */}
          <div className={styles.sqlPreview} dangerouslySetInnerHTML={{ __html: highlightSql(sql) }} />
        </div>

        {/* Error from parent */}
        {error && <div className={styles.error}>{error}</div>}

        {/* Validation details panel */}
        {showValidation && (
          <div className={styles.validationDetails}>
            <h5>Validation Results</h5>

            {validation.errors.length > 0 && (
              <div className={styles.validationSection}>
                <h6>Errors</h6>
                <ul>
                  {validation.errors.map((err, idx) => (
                    <li key={idx} className={styles.errorItem}>
                      <Warning className={styles.errorIcon} />
                      {err}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className={styles.validationSection}>
                <h6>Warnings</h6>
                <ul>
                  {validation.warnings.map((warn, idx) => (
                    <li key={idx} className={styles.warningItem}>
                      <Information className={styles.warningIcon} />
                      {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {validation.errors.length === 0 && validation.warnings.length === 0 && (
              <div className={styles.validationSection}>
                <p className={styles.successItem}>
                  <Checkmark className={styles.successIcon} />
                  All checks passed! Your SQL query includes the required parameters.
                </p>
              </div>
            )}
          </div>
        )}
      </Stack>

      {/* Template selection modal */}
      {showTemplates && (
        <ComposedModal
          open={showTemplates}
          onClose={() => setShowTemplates(false)}
          size="lg"
        >
          <ModalBody title="Select SQL Template">
            <p className={styles.templateHelp}>
              Choose a template to get started. Templates provide common SQL patterns that you can
              customize for your needs.
            </p>

            <DataTable
              rows={SQL_TEMPLATES.map((t, idx) => ({ id: idx, ...t }))}
              headers={[
                { key: 'label', header: 'Template Name' },
                { key: 'description', header: 'Description' },
                { key: 'action', header: '' },
              ]}
            >
              {({ rows }) => (
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <strong>{SQL_TEMPLATES[row.id].label}</strong>
                      </TableCell>
                      <TableCell>{SQL_TEMPLATES[row.id].description}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          kind="ghost"
                          onClick={() => applyTemplate(SQL_TEMPLATES[row.id])}
                        >
                          Use Template
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              )}
            </DataTable>

            <div className={styles.templatePreview}>
              <h6>SQL Preview</h6>
              <pre className={styles.previewCode}>
                {SQL_TEMPLATES.find((t) => t.id)?.sql || '-- Select a template to preview SQL'}
              </pre>
            </div>
          </ModalBody>
          <ModalFooter secondaryButtonText="Cancel" onRequestClose={() => setShowTemplates(false)}>
            {null}
          </ModalFooter>
        </ComposedModal>
      )}
    </div>
  );
}
