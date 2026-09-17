/**
 * Column Selector Component for Linelist Reports
 *
 * This component allows users to select and configure columns for their linelist report.
 * It leverages existing ETL table metadata infrastructure.
 *
 * Reuses patterns from:
 * - data-theme-fields-editor.section.tsx for field definition
 * - useETLTables and useETLTableMeta hooks for table/column discovery
 */

import React, { useState } from 'react';
import {
  Stack,
  TextInput,
  Select,
  SelectItem,
  Button,
  Toggle,
  Tag,
  ComboBox,
  DataTable,
  DataTableSkeleton,
  TableRow,
  TableCell,
  TableBody,
  ButtonSet,
} from '@carbon/react';
import { TrashCan, Add, ChevronDown, ChevronUp, Information } from '@carbon/react/icons';
import type {
  LinelistColumnDraft,
  RepeatResolutionStrategy,
  LinelistRepeatResolution,
} from '../../../../types/linelist-types';
import { useETLTables, useETLTableMeta } from '../../../../hooks/theme';
import type { TableColumn } from '../../../../resources/theme/etl-table-meta.api';
import TransformationPipeline from '../../design/panels/transformation-panel.component';
import styles from './column-selector.scss';

type ColumnDataType =
  | 'SQL'
  | 'IDENTIFIER'
  | 'PERSON_NAME'
  | 'PERSON_ATTRIBUTE'
  | 'CALCULATION'
  | 'PERSON_ADDRESS';

type Props = {
  columns: LinelistColumnDraft[];
  onChange: (columns: LinelistColumnDraft[]) => void;
  disabled?: boolean;
  error?: string;
};

/**
 * Create a new column draft with all required v2 fields
 * This ensures all columns have proper source tracking even when created manually
 */
function createNewColumnDraft(
  name: string,
  dataDefinitionType: ColumnDataType,
  dataDefinitionConfig: Record<string, any>,
  sortOrder: number
): LinelistColumnDraft {
  const now = new Date().toISOString();

  return {
    id: `col-${Date.now()}`,
    name,
    description: '',
    source: {
      dataSourceUuid: '', // Will be filled in by parent
      dataSourceName: '',
      table: '',
      field: name,
      fieldType: 'UNKNOWN',
    },
    dataDefinitionType,
    dataDefinitionConfig,
    additionInfo: {
      addedVia: 'SQL_BUILDER',
      addedAt: now,
      orderAdded: sortOrder,
    },
    display: {
      width: 150,
      align: 'left',
      sortable: true,
      filterable: true,
      format: 'text',
    },
    sortOrder,
  };
}

/**
 * Available data definition types with descriptions
 */
const DATA_DEFINITION_TYPES: Array<{
  id: ColumnDataType;
  label: string;
  description: string;
  needsConfig: boolean;
}> = [
  {
    id: 'SQL',
    label: 'Custom SQL',
    description: 'Custom SQL expression for complex column values',
    needsConfig: true,
  },
  {
    id: 'IDENTIFIER',
    label: 'Patient Identifier',
    description: 'Patient identifier (e.g., Clinic Number, EID Number)',
    needsConfig: true,
  },
  {
    id: 'PERSON_NAME',
    label: 'Person Name',
    description: 'Patient name (given, family, or full name)',
    needsConfig: false,
  },
  {
    id: 'PERSON_ATTRIBUTE',
    label: 'Person Attribute',
    description: 'Person attribute value',
    needsConfig: true,
  },
  {
    id: 'CALCULATION',
    label: 'Calculation',
    description: 'Calculated value (e.g., Age, BMI)',
    needsConfig: true,
  },
  {
    id: 'PERSON_ADDRESS',
    label: 'Person Address',
    description: 'Address field (village, district, etc.)',
    needsConfig: true,
  },
];

/**
 * Common SQL column templates
 */
const SQL_TEMPLATES: Record<string, string> = {
  'patient_id': 'patient_id',
  'given_name': 'given_name',
  'family_name': 'family_name',
  'gender': 'gender',
  'birthdate': 'birthdate',
  'age_at_visit': 'TIMESTAMPDIFF(YEAR, birthdate, :endDate)',
  'art_start_date': 'art_start_date',
  'current_regimen': 'current_regimen',
  'last_vl_date': 'last_vl_date',
  'last_vl_result': 'last_vl_result',
};

/**
 * Common OpenMRS person attribute columns
 * Uses standard OpenMRS attribute type UUIDs
 */
const PERSON_ATTRIBUTE_TEMPLATES: Record<string, { uuid: string; label: string }> = {
  'Gender': {
    uuid: '',
    label: 'Gender (built-in)',
  },
  'Birth Date': {
    uuid: '',
    label: 'Birth Date (built-in)',
  },
  'Telephone': {
    uuid: '14d4f066-15f5-102d-96e4-000c29c2a5d7',
    label: 'Telephone Number',
  },
  'Civil Status': {
    uuid: '8d872362-c2cc-11e0-8d4b-48f3e89c1fc1',
    label: 'Civil Status',
  },
  'Education': {
    uuid: '8d8718c8-c2cc-11e0-8d4b-48f3e89c1fc1',
    label: 'Education Level',
  },
  'Occupation': {
    uuid: '8d8728c4-c2cc-11e0-8d4b-48f3e89c1fc1',
    label: 'Occupation',
  },
  'Religion': {
    uuid: '8d871d66-c2cc-11e0-8d4b-48f3e89c1fc1',
    label: 'Religion',
  },
};

/**
 * Common patient identifier columns
 * Uses standard OpenMRS identifier type UUIDs
 */
const IDENTIFIER_TEMPLATES: Record<string, { uuid: string; label: string }> = {
  'Clinic Number': {
    uuid: 'e1731641-30ab-102d-86b0-7a5022ba4115',
    label: 'Clinic Number',
  },
  'EID Number': {
    uuid: 'e1731642-30ab-102d-86b0-7a5022ba4115',
    label: 'EID Number',
  },
  'National ID': {
    uuid: 'e1731643-30ab-102d-86b0-7a5022ba4115',
    label: 'National ID',
  },
  'Old Clinician Number': {
    uuid: 'e1731644-30ab-102d-86b0-7a5022ba4115',
    label: 'Old Clinician Number',
  },
};

/**
 * Map SQL data types to Carbon icon colors for visual indication
 */
const TYPE_COLORS: Record<ColumnDataType, string> = {
  SQL: 'gray',
  IDENTIFIER: 'blue',
  PERSON_NAME: 'green',
  PERSON_ATTRIBUTE: 'purple',
  CALCULATION: 'orange',
  PERSON_ADDRESS: 'teal',
};

/**
 * Repeat resolution strategies with descriptions
 */
const REPEAT_RESOLUTION_STRATEGIES: Array<{
  value: RepeatResolutionStrategy;
  label: string;
  description: string;
  needsOrderBy: boolean;
}> = [
  {
    value: 'LATEST',
    label: 'Latest Value',
    description: 'Most recent value based on order by field',
    needsOrderBy: true,
  },
  {
    value: 'EARLIEST',
    label: 'Earliest Value',
    description: 'Oldest value based on order by field',
    needsOrderBy: true,
  },
  {
    value: 'HIGHEST',
    label: 'Highest Value',
    description: 'Maximum value',
    needsOrderBy: false,
  },
  {
    value: 'LOWEST',
    label: 'Lowest Value',
    description: 'Minimum value',
    needsOrderBy: false,
  },
  {
    value: 'CLOSEST_TO_START',
    label: 'Closest to Start Date',
    description: 'Value closest to report start date',
    needsOrderBy: false,
  },
  {
    value: 'CLOSEST_TO_END',
    label: 'Closest to End Date',
    description: 'Value closest to report end date',
    needsOrderBy: false,
  },
  {
    value: 'FIRST_WITHIN_PERIOD',
    label: 'First Within Period',
    description: 'First value within reporting period',
    needsOrderBy: true,
  },
  {
    value: 'LAST_WITHIN_PERIOD',
    label: 'Last Within Period',
    description: 'Last value within reporting period',
    needsOrderBy: true,
  },
  {
    value: 'CONCATENATE',
    label: 'Concatenate Values',
    description: 'Combine all values into a single string',
    needsOrderBy: false,
  },
  {
    value: 'ALL_VALUES',
    label: 'Return All Values',
    description: 'Generate one row per value (changes row grain)',
    needsOrderBy: false,
  },
  {
    value: 'NONE',
    label: 'No Resolution',
    description: 'Leave unresolved (advanced users only)',
    needsOrderBy: false,
  },
];

export default function ColumnSelector({ columns, onChange, disabled = false, error }: Props) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Fetch available ETL tables
  const { tables, loading: tablesLoading, error: tablesError } = useETLTables(true);

  // Fetch column metadata for selected table
  const { columns: tableColumns, loading: columnsLoading } = useETLTableMeta(selectedTable ?? undefined, true);

  /**
   * Add a new column based on selected table column
   */
  const addColumnFromTable = (tableColumn: TableColumn) => {
    const newColumn = createNewColumnDraft(
      tableColumn.name,
      'SQL',
      { sql: tableColumn.name },
      columns.length
    );
    onChange([...columns, newColumn]);
  };

  /**
   * Add a custom column
   */
  const addCustomColumn = () => {
    const newColumn = createNewColumnDraft(
      '',
      'SQL',
      { sql: '' },
      columns.length
    );
    onChange([...columns, newColumn]);
  };

  /**
   * Remove a column
   */
  const removeColumn = (columnId: string) => {
    onChange(columns.filter((col) => col.id !== columnId));
  };

  /**
   * Update a column
   */
  const updateColumn = (columnId: string, updates: Partial<LinelistColumnDraft>) => {
    onChange(
      columns.map((col) =>
        col.id === columnId
          ? {
              ...col,
              ...updates,
            }
          : col
      )
    );
  };

  /**
   * Move column up or down in the list
   */
  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newColumns = [...columns];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newColumns.length) return;

    [newColumns[index], newColumns[targetIndex]] = [newColumns[targetIndex], newColumns[index]];

    // Update sort orders
    newColumns.forEach((col, idx) => {
      col.sortOrder = idx;
    });

    onChange(newColumns);
  };

  /**
   * Toggle row expansion for column details
   */
  const toggleRowExpansion = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  /**
   * Get config fields based on data definition type
   */
  const renderConfigFields = (column: LinelistColumnDraft) => {
    switch (column.dataDefinitionType) {
      case 'SQL':
        return (
          <TextInput
            id={`sql-${column.id}`}
            labelText="SQL Expression"
            placeholder="e.g., patient_id, given_name, TIMESTAMPDIFF(YEAR, birthdate, :endDate)"
            value={column.dataDefinitionConfig.sql || ''}
            onChange={(e) =>
              updateColumn(column.id, {
                dataDefinitionConfig: { ...column.dataDefinitionConfig, sql: (e.target as HTMLInputElement).value },
              })
            }
            disabled={disabled}
          />
        );

      case 'IDENTIFIER':
        return (
          <>
            <TextInput
              id={`identifier-uuid-${column.id}`}
              labelText="Identifier Type UUID"
              placeholder="e.g., 05a0e144-1f5d-11e8-b646-0e37ffca28c8"
              value={column.dataDefinitionConfig.identifierTypeUuid || ''}
              onChange={(e) =>
                updateColumn(column.id, {
                  dataDefinitionConfig: { ...column.dataDefinitionConfig, identifierTypeUuid: (e.target as HTMLInputElement).value },
                })
              }
              disabled={disabled}
            />
            <Toggle
              id={`preferred-${column.id}`}
              labelText="Preferred identifier"
              toggled={column.dataDefinitionConfig.preferred || false}
              onToggle={(checked) =>
                updateColumn(column.id, {
                  dataDefinitionConfig: { ...column.dataDefinitionConfig, preferred: checked },
                })
              }
              disabled={disabled}
            />
          </>
        );

      case 'PERSON_NAME':
        return (
          <Select
            id={`name-type-${column.id}`}
            labelText="Name Type"
            value={column.dataDefinitionConfig.type || 'FULL_NAME'}
            onChange={(e) =>
              updateColumn(column.id, {
                dataDefinitionConfig: { ...column.dataDefinitionConfig, type: (e.target as HTMLSelectElement).value },
              })
            }
            disabled={disabled}
          >
            <SelectItem value="FULL_NAME" text="Full Name" />
            <SelectItem value="GIVEN_NAME" text="Given Name" />
            <SelectItem value="MIDDLE_NAME" text="Middle Name" />
            <SelectItem value="FAMILY_NAME" text="Family Name" />
          </Select>
        );

      case 'PERSON_ATTRIBUTE':
        return (
          <TextInput
            id={`attribute-uuid-${column.id}`}
            labelText="Attribute Type UUID"
            placeholder="e.g., 8c860e40-1f5d-11e8-b646-0e37ffca28c8"
            value={column.dataDefinitionConfig.attributeTypeUuid || ''}
            onChange={(e) =>
              updateColumn(column.id, {
                dataDefinitionConfig: { ...column.dataDefinitionConfig, attributeTypeUuid: (e.target as HTMLInputElement).value },
              })
            }
            disabled={disabled}
          />
        );

      case 'CALCULATION':
        return (
          <>
            <Select
              id={`calculation-type-${column.id}`}
              labelText="Calculation Type"
              value={column.dataDefinitionConfig.calculation || 'AGE'}
              onChange={(e) =>
                updateColumn(column.id, {
                  dataDefinitionConfig: { ...column.dataDefinitionConfig, calculation: (e.target as HTMLSelectElement).value },
                })
              }
              disabled={disabled}
            >
              <SelectItem value="AGE" text="Age" />
              <SelectItem value="AGE_IN_MONTHS" text="Age in Months" />
              <SelectItem value="AGE_IN_YEARS" text="Age in Years" />
              <SelectItem value="BMI" text="BMI" />
            </Select>
            <Toggle
              id={`on-date-${column.id}`}
              labelText="Calculate as of end date"
              toggled={column.dataDefinitionConfig.onDate || false}
              onToggle={(checked) =>
                updateColumn(column.id, {
                  dataDefinitionConfig: { ...column.dataDefinitionConfig, onDate: checked },
                })
              }
              disabled={disabled}
            />
          </>
        );

      case 'PERSON_ADDRESS':
        return (
          <>
            <TextInput
              id={`address-field-${column.id}`}
              labelText="Address Field"
              placeholder="e.g., city_village, state_province"
              value={column.dataDefinitionConfig.field || ''}
              onChange={(e) =>
                updateColumn(column.id, {
                  dataDefinitionConfig: { ...column.dataDefinitionConfig, field: (e.target as HTMLInputElement).value },
                })
              }
              disabled={disabled}
            />
            <Select
              id={`address-type-${column.id}`}
              labelText="Address Type"
              value={column.dataDefinitionConfig.type || 'PERSON_ADDRESS'}
              onChange={(e) =>
                updateColumn(column.id, {
                  dataDefinitionConfig: { ...column.dataDefinitionConfig, type: (e.target as HTMLSelectElement).value },
                })
              }
              disabled={disabled}
            >
              <SelectItem value="PERSON_ADDRESS" text="Person Address" />
              <SelectItem value="BIRTHPLACE" text="Birthplace" />
            </Select>
          </>
        );

      default:
        return null;
    }
  };

  /**
   * Render repeat resolution configuration for columns that may have multiple values
   */
  const renderRepeatResolutionConfig = (column: LinelistColumnDraft) => {
    const resolution = column.repeatResolution;

    return (
      <Stack gap={3}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Information size={16} />
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
            Repeat Value Resolution
          </span>
        </div>
        <p style={{ fontSize: '0.875rem', color: '#525252' }}>
          This column may return multiple values per patient. Configure how to handle this.
        </p>

        <Select
          id={`repeat-strategy-${column.id}`}
          labelText="Resolution Strategy"
          value={resolution?.strategy || 'NONE'}
          onChange={(e) => {
            const strategy = (e.target as HTMLSelectElement).value as RepeatResolutionStrategy;
            updateColumn(column.id, {
              repeatResolution: {
                ...resolution,
                strategy,
              } as LinelistRepeatResolution,
            });
          }}
          disabled={disabled}
        >
          {REPEAT_RESOLUTION_STRATEGIES.map((strategy) => (
            <SelectItem
              key={strategy.value}
              value={strategy.value}
              text={strategy.label}
              title={strategy.description}
            />
          ))}
        </Select>

        {resolution?.strategy && resolution.strategy !== 'NONE' && (
          <>
            {REPEAT_RESOLUTION_STRATEGIES.find((s) => s.value === resolution.strategy)
              ?.needsOrderBy && (
              <TextInput
                id={`repeat-orderby-${column.id}`}
                labelText="Order By Field (required)"
                placeholder="e.g., return_visit_date, encounter_datetime"
                value={resolution?.orderBy || ''}
                onChange={(e) =>
                  updateColumn(column.id, {
                    repeatResolution: {
                      ...resolution,
                      orderBy: (e.target as HTMLInputElement).value,
                    } as LinelistRepeatResolution,
                  })
                }
                disabled={disabled}
                helperText="Field to use for ordering values"
              />
            )}

            <Toggle
              id={`repeat-restrict-period-${column.id}`}
              labelText="Restrict to Reporting Period"
              toggled={resolution?.restrictToPeriod || false}
              onToggle={(checked) =>
                updateColumn(column.id, {
                  repeatResolution: {
                    ...resolution,
                    restrictToPeriod: checked,
                  } as LinelistRepeatResolution,
                })
              }
              disabled={disabled}
            />

            <Toggle
              id={`repeat-ignore-voided-${column.id}`}
              labelText="Ignore Voided Records"
              toggled={resolution?.ignoreVoided !== false}
              onToggle={(checked) =>
                updateColumn(column.id, {
                  repeatResolution: {
                    ...resolution,
                    ignoreVoided: checked,
                  } as LinelistRepeatResolution,
                })
              }
              disabled={disabled}
            />

            <TextInput
              id={`repeat-tiebreak-${column.id}`}
              labelText="Tie-break Field (optional)"
              placeholder="e.g., date_created"
              value={resolution?.tieBreakField || ''}
              onChange={(e) =>
                updateColumn(column.id, {
                  repeatResolution: {
                    ...resolution,
                    tieBreakField: (e.target as HTMLInputElement).value || undefined,
                  } as LinelistRepeatResolution,
                })
              }
              disabled={disabled}
              helperText="Field to use when values are equal"
            />
          </>
        )}
      </Stack>
    );
  };

  /**
   * Render SQL template quick-add buttons
   */
  const renderSqlTemplates = () => {
    return (
      <div className={styles['sqlTemplates']}>
        <p className={styles['templateLabel']}>Quick add common columns:</p>
        <div className={styles['templateButtons']}>
          {Object.entries(SQL_TEMPLATES).map(([key, sql]) => (
            <Button
              key={key}
              kind="ghost"
              size="sm"
              onClick={() => {
                const newColumn = createNewColumnDraft(
                  key,
                  'SQL',
                  { sql },
                  columns.length
                );
                onChange([...columns, newColumn]);
              }}
              disabled={disabled}
            >
              {key.replace(/_/g, ' ')}
            </Button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={styles['container']}>
      <Stack gap={4}>
        {/* Error message */}
        {error && <div className={styles['error']}>{error}</div>}

        {/* Table and Column Selection */}
        <div className={styles['tableSelector']}>
          <h4 className={styles['sectionTitle']}>Add from ETL Tables</h4>

          {tablesLoading ? (
            <DataTableSkeleton rowCount={5} />
          ) : tablesError ? (
            <div className={styles['error']}>Failed to load tables: {tablesError}</div>
          ) : (
            <Stack gap={2}>
              {/* Table selector */}
              <ComboBox
                id="etl-table-selector"
                titleText="Select ETL Table"
                items={tables.map((t) => t)}
                selectedItem={selectedTable}
                onChange={({ selectedItem }) => {
                  setSelectedTable(selectedItem || null);
                }}
                placeholder="Select a table to view columns"
                disabled={disabled}
              />

              {/* Column list from selected table */}
              {selectedTable && columnsLoading && <DataTableSkeleton rowCount={3} />}

              {selectedTable &&
                !columnsLoading &&
                tableColumns.length > 0 && (
                  <div className={styles['columnList']}>
                    <p className={styles['helperText']}>
                      Click a column to add it to your linelist report:
                    </p>
                    <div className={styles['columnChips']}>
                      {tableColumns.map((col) => (
                        <Button
                          key={col.name}
                          kind="ghost"
                          size="sm"
                          renderIcon={Add}
                          onClick={() => addColumnFromTable(col)}
                          disabled={disabled}
                        >
                          {col.name}
                          {col.type && <span className={styles['columnType']}> ({col.type})</span>}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

              {selectedTable && !columnsLoading && tableColumns.length === 0 && (
                <div className={styles['emptyState']}>No columns found for this table</div>
              )}
            </Stack>
          )}
        </div>

        {/* SQL Templates */}
        <div className={styles['sqlTemplateSection']}>
          <h4 className={styles['sectionTitle']}>Common Columns (SQL)</h4>
          {renderSqlTemplates()}
        </div>

        {/* Person Attributes */}
        <div className={styles['sqlTemplateSection']}>
          <h4 className={styles['sectionTitle']}>Person Attributes</h4>
          <div className={styles['templateButtons']}>
            {Object.entries(PERSON_ATTRIBUTE_TEMPLATES).map(([key, template]) => (
              <Button
                key={key}
                kind="ghost"
                size="sm"
                onClick={() => {
                  const newColumn = createNewColumnDraft(
                    key,
                    'PERSON_ATTRIBUTE',
                    { attributeTypeUuid: template.uuid },
                    columns.length
                  );
                  onChange([...columns, newColumn]);
                }}
                disabled={disabled}
              >
                {template.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Patient Identifiers */}
        <div className={styles['sqlTemplateSection']}>
          <h4 className={styles['sectionTitle']}>Patient Identifiers</h4>
          <div className={styles['templateButtons']}>
            {Object.entries(IDENTIFIER_TEMPLATES).map(([key, template]) => (
              <Button
                key={key}
                kind="ghost"
                size="sm"
                onClick={() => {
                  const newColumn = createNewColumnDraft(
                    template.label,
                    'IDENTIFIER',
                    { identifierTypeUuid: template.uuid, preferred: false },
                    columns.length
                  );
                  onChange([...columns, newColumn]);
                }}
                disabled={disabled}
              >
                {template.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Person Name */}
        <div className={styles['sqlTemplateSection']}>
          <h4 className={styles['sectionTitle']}>Person Name</h4>
          <div className={styles['templateButtons']}>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => {
                const newColumn = createNewColumnDraft(
                  'Patient Name',
                  'PERSON_NAME',
                  { type: 'FULL_NAME' },
                  columns.length
                );
                onChange([...columns, newColumn]);
              }}
              disabled={disabled}
            >
              Full Name
            </Button>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => {
                const newColumn = createNewColumnDraft(
                  'Given Name',
                  'PERSON_NAME',
                  { type: 'GIVEN_NAME' },
                  columns.length
                );
                onChange([...columns, newColumn]);
              }}
              disabled={disabled}
            >
              Given Name
            </Button>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => {
                const newColumn = createNewColumnDraft(
                  'Family Name',
                  'PERSON_NAME',
                  { type: 'FAMILY_NAME' },
                  columns.length
                );
                onChange([...columns, newColumn]);
              }}
              disabled={disabled}
            >
              Family Name
            </Button>
          </div>
        </div>

        {/* Calculations */}
        <div className={styles['sqlTemplateSection']}>
          <h4 className={styles['sectionTitle']}>Calculations</h4>
          <div className={styles['templateButtons']}>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => {
                const newColumn = createNewColumnDraft(
                  'Age',
                  'CALCULATION',
                  { calculation: 'AGE', onDate: true },
                  columns.length
                );
                onChange([...columns, newColumn]);
              }}
              disabled={disabled}
            >
              Age
            </Button>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => {
                const newColumn = createNewColumnDraft(
                  'Age (Months)',
                  'CALCULATION',
                  { calculation: 'AGE_IN_MONTHS', onDate: true },
                  columns.length
                );
                onChange([...columns, newColumn]);
              }}
              disabled={disabled}
            >
              Age (Months)
            </Button>
          </div>
        </div>

        {/* Custom Column Button */}
        <Button kind="secondary" renderIcon={Add} onClick={addCustomColumn} disabled={disabled}>
          Add Custom Column
        </Button>

        {/* Selected Columns Table */}
        {columns.length > 0 && (
          <div className={styles['columnsTable']}>
            <h4 className={styles['sectionTitle']}>Selected Columns ({columns.length})</h4>

            <DataTable rows={columns.map((col, idx) => ({ id: idx, ...col }))} headers={[]}>
              {({ rows }) => (
                <TableBody>
                  {rows.map((row, idx) => {
                    const col = columns[idx];
                    const isExpanded = expandedRows.has(idx);
                    const typeInfo = DATA_DEFINITION_TYPES.find((t) => t.id === col.dataDefinitionType);

                    return (
                      <React.Fragment key={col.id}>
                        <TableRow>
                          {/* Order number */}
                          <TableCell className={styles['orderCell']}>
                            {idx + 1}
                          </TableCell>

                          {/* Column name */}
                          <TableCell>
                            <TextInput
                              id={`column-name-${col.id}`}
                              labelText=""
                              hideLabel
                              value={col.name}
                              onChange={(e) =>
                                updateColumn(col.id, {
                                  name: (e.target as HTMLInputElement).value,
                                })
                              }
                              disabled={disabled}
                            />
                          </TableCell>

                          {/* Data definition type */}
                          <TableCell>
                            <Tag type={TYPE_COLORS[col.dataDefinitionType]}>
                              {typeInfo?.label || col.dataDefinitionType}
                            </Tag>
                          </TableCell>

                          {/* Actions */}
                          <TableCell className={styles['actionsCell']}>
                            <ButtonSet>
                              <Button
                                hasIconOnly
                                kind="ghost"
                                size="sm"
                                renderIcon={ChevronUp}
                                onClick={() => moveColumn(idx, 'up')}
                                disabled={disabled || idx === 0}
                                iconDescription="Move up"
                              />
                              <Button
                                hasIconOnly
                                kind="ghost"
                                size="sm"
                                renderIcon={ChevronDown}
                                onClick={() => moveColumn(idx, 'down')}
                                disabled={disabled || idx === columns.length - 1}
                                iconDescription="Move down"
                              />
                              <Button
                                hasIconOnly
                                kind="ghost"
                                size="sm"
                                renderIcon={TrashCan}
                                onClick={() => removeColumn(col.id)}
                                disabled={disabled}
                                iconDescription="Remove column"
                              />
                              <Button
                                kind="ghost"
                                size="sm"
                                onClick={() => toggleRowExpansion(idx)}
                                disabled={disabled}
                              >
                                {isExpanded ? 'Less' : 'More'}
                              </Button>
                            </ButtonSet>
                          </TableCell>
                        </TableRow>

                        {/* Expanded config row */}
                        {isExpanded && (
                          <TableRow className={styles['expandedRow']}>
                            <TableCell colSpan={4}>
                              <div className={styles['expandedContent']}>
                                <Stack gap={3}>
                                  {/* Data definition type selector */}
                                  <Select
                                    id={`data-definition-type-${col.id}`}
                                    labelText="Data Definition Type"
                                    value={col.dataDefinitionType}
                                    onChange={(e) =>
                                      updateColumn(col.id, {
                                        dataDefinitionType: (e.target as HTMLSelectElement).value as ColumnDataType,
                                        dataDefinitionConfig: {},
                                      })
                                    }
                                    disabled={disabled}
                                  >
                                    {DATA_DEFINITION_TYPES.map((type) => (
                                      <SelectItem
                                        key={type.id}
                                        value={type.id}
                                        text={type.label}
                                        title={type.description}
                                      />
                                    ))}
                                  </Select>

                                  {/* Type-specific config fields */}
                                  {renderConfigFields(col)}

                                  {/* Helper text */}
                                  {typeInfo?.description && (
                                    <p className={styles['helperText']}>{typeInfo.description}</p>
                                  )}

                                  {/* Repeat resolution configuration */}
                                  {renderRepeatResolutionConfig(col)}

                                  {/* Transformation pipeline */}
                                  <div className={styles['transformationSection']}>
                                    <TransformationPipeline
                                      transformations={col.transformations || []}
                                      onChange={(transformations) =>
                                        updateColumn(col.id, { transformations })
                                      }
                                      disabled={disabled}
                                    />
                                  </div>
                                </Stack>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              )}
            </DataTable>
          </div>
        )}

        {/* Empty state */}
        {columns.length === 0 && (
          <div className={styles['emptyState']}>
            <p>No columns selected. Add columns from an ETL table or add custom columns above.</p>
          </div>
        )}
      </Stack>
    </div>
  );
}
