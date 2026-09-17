/**
 * Query Configuration Panel - Redesigned to match mockup
 *
 * Accordion-style panel with:
 * - Dataset
 * - Population (with visual filter builder)
 * - Columns
 * - Filters
 * - Sort
 * - Parameters
 * - Display & Export
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  Stack,
  Button,
  Select,
  SelectItem,
  TextInput,
  TextArea,
  Tag,
  Toggle,
} from '@carbon/react';
import {
  DataTable,
  Filter,
  Settings,
  SortAscending,
  List,
  Export,
  ChevronDown,
  ChevronUp,
  Add,
  TrashCan,
  Document,
  Code,
} from '@carbon/react/icons';
import type {
  LinelistReportDraft,
  FilterFieldType,
  FilterCondition,
  PopulationMode,
  LogicalOperator,
  PopulationDefinition,
} from '../../../../types/linelist-types';
import type { IndicatorDto } from '../../../../resources/indicator/indicators.api';
import type { IndicatorOption } from '../../../indicators/types/composite-indicator.types';
import IndicatorSearchSelect from '../../../indicators/indicator-search-select.component';
import JsonPreview from './json-preview.component';
import ColumnCategorySelector from './column-category-selector.component';
import ParameterEditor from '../../definition/panels/parameter-panel.component';
import FilterMapEditor from './filtermap-editor.component';
import styles from './query-config-panel.scss';

type Props = {
  draft: LinelistReportDraft;
  onDraftChange: (updates: Partial<LinelistReportDraft>) => void;
  availableFields?: Array<{ name: string; label: string; type: FilterFieldType }>; // From data source (for columns)
  populationFields?: Array<{ name: string; label: string; type: FilterFieldType }>; // From theme (for population filters)
  indicators?: IndicatorDto[]; // Available indicators
  onRemoveColumn?: (columnId: string) => void; // Handler to remove a column
  disabled?: boolean;
};

type IndicatorRule = {
  id: string;
  indicatorUuid: string;
  name: string;
  logicalOperator?: 'AND' | 'OR';
  negate?: boolean;
};

/**
 * Get operators for field type
 */
function getOperatorsForFieldType(fieldType: FilterFieldType): string[] {
  switch (fieldType) {
    case 'TEXT':
      return ['equals', 'not equals', 'contains', 'starts with', 'is blank'];
    case 'NUMBER':
      return ['equals', 'not equals', 'greater than', 'less than', 'between'];
    case 'DATE':
      return ['on', 'before', 'after', 'between'];
    case 'CODED':
      return ['is one of', 'is not one of'];
    case 'BOOLEAN':
      return ['is true', 'is false', 'not recorded'];
    case 'LOCATION':
      return ['equals', 'within hierarchy'];
    default:
      return ['equals', 'not equals'];
  }
}

/**
 * Format operator label for display
 */
function formatOperatorLabel(operator: string): string {
  return operator
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Section state type
 */
type SectionKey = 'dataset' | 'population' | 'columns' | 'filters' | 'sort' | 'parameters' | 'display' | 'json-preview';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function QueryConfigPanel({ draft, onDraftChange, availableFields = [], populationFields = [], indicators = [], onRemoveColumn, disabled = false }: Props) {
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(['population']));
  const [populationMode, setPopulationMode] = useState<PopulationMode>('SQL');

  // Sync populationMode from the draft's build method when loading a report
  useEffect(() => {
    if (draft.population?.buildMethod === 'INDICATOR_BASED') {
      setPopulationMode('INDICATOR');
    } else if (draft.population?.buildMethod === 'VISUAL_FILTER') {
      setPopulationMode('SQL');
    } else {
      setPopulationMode('SQL');
    }
  }, [draft.population?.buildMethod]);

  // Drag and drop state for columns (for future use)
  // const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  // const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  /**
   * Toggle section expansion
   */
  const toggleSection = useCallback((key: SectionKey) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  /**
   * Add a condition to population filter
   */
  const addPopulationCondition = useCallback(() => {
    const newCondition: FilterCondition = {
      id: `cond-${Date.now()}`,
      field: '',
      fieldLabel: '',
      fieldType: 'DATE',
      operator: 'BETWEEN_DATES',
      value: '',
    };

    // Ensure visualFilter and rootGroup exist - read from population.visualFilter with legacy fallback
    const currentVisualFilter = draft.population?.visualFilter || draft.visualFilter;
    const currentConditions = currentVisualFilter?.rootGroup?.conditions || [];
    const updatedFilter = {
      rootGroup: {
        id: 'root',
        logicalOperator: (currentVisualFilter?.rootGroup?.logicalOperator || 'AND') as LogicalOperator,
        conditions: [...currentConditions, newCondition],
      },
      useVisualBuilder: true,
    };

    // Update both population.visualFilter (preferred) and legacy visualFilter for backward compatibility
    onDraftChange({
      population: {
        ...draft.population,
        visualFilter: updatedFilter,
      },
      visualFilter: updatedFilter, // Legacy - keep in sync for backward compatibility
    });
  }, [draft.population, draft.visualFilter, onDraftChange]);

  /**
   * Update a condition in population filter
   */
  const updatePopulationCondition = useCallback((conditionId: string, updates: Partial<FilterCondition>) => {
    // Read from population.visualFilter with legacy fallback
    const currentVisualFilter = draft.population?.visualFilter || draft.visualFilter;
    const currentConditions = currentVisualFilter?.rootGroup?.conditions || [];
    const updatedConditions = currentConditions.map((c) =>
      c.id === conditionId ? { ...c, ...updates } : c
    );

    // If field changed, update fieldType and reset operator if needed
    const updatedCondition = updatedConditions.find((c) => c.id === conditionId);
    if (updatedCondition && updates.field) {
      const fieldInfo = populationFields.find((f) => f.name === updates.field);
      if (fieldInfo) {
        updatedCondition.fieldType = fieldInfo.type;
        updatedCondition.fieldLabel = fieldInfo.label;
        // Reset operator if not compatible
        const validOps = getOperatorsForFieldType(fieldInfo.type);
        if (!validOps.includes(updatedCondition.operator.toLowerCase())) {
          updatedCondition.operator = 'EQUALS';
        }
      }
    }

    const updatedFilter = {
      rootGroup: {
        id: currentVisualFilter?.rootGroup?.id || 'root',
        logicalOperator: (currentVisualFilter?.rootGroup?.logicalOperator || 'AND') as LogicalOperator,
        conditions: updatedConditions,
      },
      useVisualBuilder: true,
    };

    // Update both population.visualFilter (preferred) and legacy visualFilter for backward compatibility
    onDraftChange({
      population: {
        ...draft.population,
        visualFilter: updatedFilter,
      },
      visualFilter: updatedFilter, // Legacy - keep in sync
    });
  }, [draft.population, draft.visualFilter, onDraftChange, populationFields]);

  /**
   * Remove a condition from population filter
   */
  const removePopulationCondition = useCallback((conditionId: string) => {
    // Read from population.visualFilter with legacy fallback
    const currentVisualFilter = draft.population?.visualFilter || draft.visualFilter;
    const currentConditions = currentVisualFilter?.rootGroup?.conditions || [];
    const updatedConditions = currentConditions.filter(
      (c) => c.id !== conditionId
    );

    const updatedFilter = {
      rootGroup: {
        id: currentVisualFilter?.rootGroup?.id || 'root',
        logicalOperator: (currentVisualFilter?.rootGroup?.logicalOperator || 'AND') as LogicalOperator,
        conditions: updatedConditions,
      },
      useVisualBuilder: true,
    };

    // Update both population.visualFilter (preferred) and legacy visualFilter for backward compatibility
    onDraftChange({
      population: {
        ...draft.population,
        visualFilter: updatedFilter,
      },
      visualFilter: updatedFilter, // Legacy - keep in sync
    });
  }, [draft.population, draft.visualFilter, onDraftChange]);

  /**
   * Handle population mode change
   */
  const handlePopulationModeChange = useCallback((mode: PopulationMode) => {
    setPopulationMode(mode);

    // Map PopulationMode to buildMethod
    let buildMethod: PopulationDefinition['buildMethod'];
    switch (mode) {
      case 'INDICATOR':
        buildMethod = 'INDICATOR_BASED';
        break;
      case 'HYBRID':
        buildMethod = 'INDICATOR_BASED'; // HYBRID uses indicators too
        break;
      case 'SQL':
      default:
        buildMethod = 'SQL_BUILDER';
        break;
    }

    // Initialize indicatorRules array if switching to INDICATOR mode
    const currentRules = draft.population?.indicatorRules || draft.indicatorRules || [];
    const indicatorRulesToUse = mode === 'INDICATOR' || mode === 'HYBRID'
      ? (currentRules.length > 0 ? currentRules : [])
      : draft.population?.indicatorRules || draft.indicatorRules || [];

    // Update both population.buildMethod (preferred) and legacy fields
    onDraftChange({
      population: {
        ...draft.population,
        buildMethod,
        indicatorRules: indicatorRulesToUse,
      },
      populationMode: mode, // Legacy - keep in sync
      indicatorRules: indicatorRulesToUse, // Legacy - keep in sync
    });
  }, [draft.population, draft.indicatorRules, onDraftChange]);

  /**
   * Add an indicator rule
   */
  const addIndicatorRule = useCallback(() => {
    const newRule: IndicatorRule = {
      id: `rule-${Date.now()}`,
      indicatorUuid: '',
      name: '',
      logicalOperator: 'AND',
      negate: false,
    };

    const currentRules = draft.population?.indicatorRules || draft.indicatorRules || [];
    const updatedRules = [...currentRules, newRule];
    // Update both population.indicatorRules (preferred) and legacy indicatorRules
    onDraftChange({
      population: {
        ...draft.population,
        indicatorRules: updatedRules,
      },
      indicatorRules: updatedRules, // Legacy - keep in sync
    });
  }, [draft.population, draft.indicatorRules, onDraftChange]);

  /**
   * Update an indicator rule
   */
  const updateIndicatorRule = useCallback((ruleId: string, updates: Partial<IndicatorRule>) => {
    const currentRules = draft.population?.indicatorRules || draft.indicatorRules || [];
    const updatedRules = currentRules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...updates } : rule
    );
    // Update both population.indicatorRules (preferred) and legacy indicatorRules
    onDraftChange({
      population: {
        ...draft.population,
        indicatorRules: updatedRules,
      },
      indicatorRules: updatedRules, // Legacy - keep in sync
    });
  }, [draft.population, draft.indicatorRules, onDraftChange]);

  /**
   * Handle indicator selection from IndicatorSearchSelect
   */
  const handleIndicatorSelect = useCallback((ruleId: string, indicatorUuid: string, option: IndicatorOption | null) => {
    const currentRules = draft.population?.indicatorRules || draft.indicatorRules || [];
    const updatedRules = currentRules.map((rule) =>
      rule.id === ruleId
        ? { ...rule, indicatorUuid, name: option?.name || '' }
        : rule
    );
    // Update both population.indicatorRules (preferred) and legacy indicatorRules
    onDraftChange({
      population: {
        ...draft.population,
        indicatorRules: updatedRules,
      },
      indicatorRules: updatedRules, // Legacy - keep in sync
    });
  }, [draft.population, draft.indicatorRules, onDraftChange]);

  /**
   * Remove an indicator rule
   */
  const removeIndicatorRule = useCallback((ruleId: string) => {
    const currentRules = draft.population?.indicatorRules || draft.indicatorRules || [];
    const updatedRules = currentRules.filter((rule) => rule.id !== ruleId);
    // Update both population.indicatorRules (preferred) and legacy indicatorRules
    onDraftChange({
      population: {
        ...draft.population,
        indicatorRules: updatedRules,
      },
      indicatorRules: updatedRules, // Legacy - keep in sync
    });
  }, [draft.population, draft.indicatorRules, onDraftChange]);

  // Read from population.visualFilter (preferred) with fallback to legacy visualFilter
  const visualFilterRoot = draft.population?.visualFilter?.rootGroup || draft.visualFilter?.rootGroup;
  const conditions = visualFilterRoot?.conditions || [];

  /**
   * Drag and drop handlers for columns (for future use)
   */
  // const handleDragStart = useCallback((index: number) => {
  //   setDraggedIndex(index);
  // }, []);

  // const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
  //   e.preventDefault();
  //   if (draggedIndex === null || draggedIndex === index) return;
  //   setDragOverIndex(index);
  // }, [draggedIndex]);

  // const handleDragEnd = useCallback(() => {
  //   setDraggedIndex(null);
  //   setDragOverIndex(null);
  // }, []);

  // const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
  //   e.preventDefault();
  //   if (draggedIndex === null || draggedIndex === dropIndex) return;

  //   // Create new columns array with reordered items
  //   const newColumns = [...draft.columns];
  //   const [removed] = newColumns.splice(draggedIndex, 1);
  //   newColumns.splice(dropIndex, 0, removed);

  //   onDraftChange({ columns: newColumns });
  //   handleDragEnd();
  // }, [draft.columns, draggedIndex, onDraftChange, handleDragEnd]);

  return (
    <div className={styles.container}>
      {/* Dataset Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('dataset')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <DataTable size={20} />
            <span className={styles.sectionTitle}>Dataset</span>
          </div>
          <div className={styles.sectionHeaderRight}>
            {expandedSections.has('dataset') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('dataset') && (
          <div className={styles.sectionContent}>
            <div className={styles.datasetInfo}>
              <div className={styles.datasetRow}>
                <span className={styles.datasetLabel}>Population sources:</span>
                <span className={styles.datasetValue}>
                  {draft.populationSources && draft.populationSources.length > 0 ? (
                    <div className={styles.datasourceTags}>
                      {draft.populationSources
                        .filter(ps => ps.enabled)
                        .sort((a, b) => a.order - b.order)
                        .map(ps => (
                        <Tag key={ps.uuid} size="sm" type={
                          ps.joinType === 'JOIN' || ps.joinType === 'LEFT_JOIN' ? 'blue' :
                          ps.joinType === 'INTERSECT' ? 'green' :
                          ps.joinType === 'UNION' ? 'purple' : 'red'
                        }>
                          {ps.name} ({ps.joinType})
                        </Tag>
                      ))}
                    </div>
                  ) : 'Not selected'}
                </span>
              </div>
              <div className={styles.datasetRow}>
                <span className={styles.datasetLabel}>Data sources:</span>
                <span className={styles.datasetValue}>
                  {draft.dataSources && draft.dataSources.length > 0 ? (
                    <div className={styles.datasourceTags}>
                      {draft.dataSources.map(ds => (
                        <Tag key={ds.uuid} size="sm" type={
                          ds.role === 'PRIMARY' ? 'green' :
                          ds.role === 'SECONDARY' ? 'blue' : 'purple'
                        }>
                          {ds.name} ({ds.role})
                        </Tag>
                      ))}
                    </div>
                  ) : 'Not selected'}
                </span>
              </div>
              <div className={styles.datasetRow}>
                <span className={styles.datasetLabel}>Row grain:</span>
                <span className={styles.datasetValue}>{draft.rowGrain || 'Not set'}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Population Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('population')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <DataTable size={20} />
            <span className={styles.sectionTitle}>Population</span>
            <Tag size="sm" type="blue">
              {populationMode === 'HYBRID'
                ? ((draft.population?.indicatorRules || draft.indicatorRules)?.length || 0) + conditions.length
                : populationMode === 'INDICATOR'
                ? ((draft.population?.indicatorRules || draft.indicatorRules)?.length || 0)
                : populationMode === 'SQL' && (draft.population?.sqlTemplate?.trim())
                ? 'SQL'
                : conditions.length}
            </Tag>
          </div>
          <div className={styles.sectionHeaderRight}>
            {expandedSections.has('population') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('population') && (
          <div className={styles.sectionContent}>
            {/* Population Mode Selector */}
            <div className={styles.populationModeSelector}>
              <span className={styles.modeLabel}>Define population using:</span>
              <Select
                id="population-mode"
                size="sm"
                value={populationMode}
                onChange={(e: any) => handlePopulationModeChange(e.target.value as PopulationMode)}
                disabled={disabled}
                labelText=""
                inline
              >
                <SelectItem value="SQL" text="SQL Query" />
                <SelectItem value="INDICATOR" text="Indicators" />
                <SelectItem value="HYBRID" text="Hybrid (SQL + Indicators)" />
              </Select>
            </div>

            {populationMode === 'SQL' && (
              <>
                <div className={styles.populationHeader}>
                  <span className={styles.populationLabel}>All patients where (SQL):</span>
                </div>

                <Stack gap={3} className={styles.conditionsStack}>
                  {conditions.map((condition, index) => (
                    <div key={condition.id} className={styles.conditionRow}>
                      {/* Field dropdown */}
                      <Select
                        id={`field-${condition.id}`}
                        size="sm"
                        value={condition.field}
                        onChange={(e: any) => {
                          const fieldName = e.target.value;
                          const fieldInfo = populationFields.find((f) => f.name === fieldName);
                          updatePopulationCondition(condition.id, {
                            field: fieldName,
                            fieldLabel: fieldInfo?.label || fieldName,
                            fieldType: fieldInfo?.type || 'TEXT',
                          });
                        }}
                        disabled={disabled}
                        labelText=""
                      >
                        <SelectItem value="" text="Select field..." />
                        {populationFields.map((field) => (
                          <SelectItem key={field.name} value={field.name} text={field.label} />
                        ))}
                      </Select>

                      {/* Operator dropdown */}
                      <Select
                        id={`operator-${condition.id}`}
                        size="sm"
                        value={condition.operator}
                        onChange={(e: any) => updatePopulationCondition(condition.id, { operator: e.target.value })}
                        disabled={disabled || !condition.field}
                        labelText=""
                      >
                        {getOperatorsForFieldType(condition.fieldType).map((op) => (
                          <SelectItem
                            key={op.toUpperCase()}
                            value={op.toUpperCase()}
                            text={op.charAt(0).toUpperCase() + op.slice(1)}
                          />
                        ))}
                      </Select>

                      {/* Value input(s) */}
                      {condition.operator !== 'IS_BLANK' && condition.operator !== 'IS_TRUE' &&
                       condition.operator !== 'IS_FALSE' && condition.operator !== 'NOT_RECORDED' && (
                        <TextInput
                          id={`value-${condition.id}`}
                          size="sm"
                          placeholder={condition.fieldType === 'DATE' ? 'Start Date' : 'Value'}
                          value={Array.isArray(condition.value) ? condition.value[0] || '' : (condition.value || '')}
                          onChange={(e) =>
                            updatePopulationCondition(condition.id, { value: (e.target as HTMLInputElement).value })
                          }
                          disabled={disabled || !condition.field}
                          labelText=""
                        />
                      )}

                      {/* Second value for "between" operators */}
                      {(condition.operator === 'BETWEEN' || condition.operator === 'BETWEEN_DATES') && (
                        <TextInput
                          id={`value2-${condition.id}`}
                          size="sm"
                          placeholder={condition.fieldType === 'DATE' ? 'End Date' : 'To'}
                          value={condition.value2 || ''}
                          onChange={(e) =>
                            updatePopulationCondition(condition.id, { value2: (e.target as HTMLInputElement).value })
                          }
                          disabled={disabled || !condition.field}
                          labelText=""
                        />
                      )}

                      {/* "and" text between conditions */}
                      {index < conditions.length - 1 && (
                        <span className={styles.andText}>and</span>
                      )}

                      {/* Delete button */}
                      <Button
                        kind="ghost"
                        size="sm"
                        hasIconOnly
                        renderIcon={TrashCan}
                        onClick={() => removePopulationCondition(condition.id)}
                        disabled={disabled}
                        iconDescription="Remove condition"
                      />
                    </div>
                  ))}

                  {/* Add condition button */}
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={Add}
                    onClick={addPopulationCondition}
                    disabled={disabled}
                  >
                    Add condition
                  </Button>
                </Stack>

                {/* Raw SQL Editor */}
                <div className={styles.sqlEditorSection}>
                  <div className={styles.populationHeader}>
                    <span className={styles.populationLabel}>Or edit raw SQL:</span>
                    <span className={styles.populationHint}>
                      Directly edit the SQL query (use :startDate and :endDate for date parameters)
                    </span>
                  </div>
                  <TextArea
                    id="population-sql"
                    className={styles.sqlEditor}
                    placeholder="SELECT DISTINCT patient_id AS patient_id FROM your_table WHERE..."
                    value={draft.population?.sqlTemplate || ''}
                    onChange={(e: any) => {
                      onDraftChange({
                        population: {
                          ...draft.population,
                          sqlTemplate: e.target.value,
                        },
                      });
                    }}
                    disabled={disabled}
                    rows={6}
                    labelText=""
                  />
                </div>
              </>
            )}

            {populationMode === 'INDICATOR' && (
              <>
                <div className={styles.populationHeader}>
                  <span className={styles.populationLabel}>All patients matching these indicators:</span>
                  <span className={styles.populationHint}>
                    Use indicators with prebuilt query definitions for patient selection
                  </span>
                </div>

                <Stack gap={3} className={styles.conditionsStack}>
                  {((draft.population?.indicatorRules || draft.indicatorRules) || []).map((rule, index) => (
                    <div key={rule.id} className={styles.conditionRow}>
                      <Document size={16} className={styles.rowIcon} />

                      {/* Indicator search select */}
                      <div className={styles.indicatorSearch}>
                        <IndicatorSearchSelect
                          id={`indicator-${rule.id}`}
                          titleText=""
                          selectedId={rule.indicatorUuid}
                          disabled={disabled}
                          onChange={(indicatorUuid, option) => handleIndicatorSelect(rule.id, indicatorUuid, option)}
                          placeholder="Search indicators..."
                        />
                      </div>

                      {/* Logical operator */}
                      <Select
                        id={`logical-${rule.id}`}
                        size="sm"
                        value={rule.logicalOperator || 'AND'}
                        onChange={(e: any) => updateIndicatorRule(rule.id, { logicalOperator: e.target.value })}
                        disabled={disabled || !rule.indicatorUuid}
                        labelText=""
                      >
                        <SelectItem value="AND" text="AND" />
                        <SelectItem value="OR" text="OR" />
                      </Select>

                      {/* Negate toggle - only show when indicator is selected */}
                      {rule.indicatorUuid && (
                        <div className={styles.negateToggle}>
                          <Toggle
                            id={`negate-${rule.id}`}
                            labelA="Include"
                            labelB="Exclude"
                            toggled={rule.negate ?? false}
                            onToggle={(checked) => updateIndicatorRule(rule.id, { negate: checked })}
                            disabled={disabled}
                          />
                        </div>
                      )}

                      {/* "and" text between conditions */}
                      {index < ((draft.population?.indicatorRules || draft.indicatorRules)?.length || 0) - 1 && (
                        <span className={styles.andText}>and</span>
                      )}

                      {/* Delete button */}
                      <Button
                        kind="ghost"
                        size="sm"
                        hasIconOnly
                        renderIcon={TrashCan}
                        onClick={() => removeIndicatorRule(rule.id)}
                        disabled={disabled}
                        iconDescription="Remove indicator"
                      />
                    </div>
                  ))}

                  {/* Add indicator button */}
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={Add}
                    onClick={addIndicatorRule}
                    disabled={disabled}
                  >
                    Add indicator
                  </Button>
                </Stack>
              </>
            )}

            {populationMode === 'HYBRID' && (
              <>
                {/* Indicators Section in Hybrid Mode */}
                <div className={styles.populationHeader}>
                  <span className={styles.populationLabel}>Indicators:</span>
                  <span className={styles.populationHint}>
                    Add indicators to combine with SQL
                  </span>
                </div>

                <Stack gap={3} className={styles.conditionsStack}>
                  {((draft.population?.indicatorRules || draft.indicatorRules) || []).map((rule, index) => (
                    <div key={rule.id} className={styles.conditionRow}>
                      <Document size={16} className={styles.rowIcon} />

                      {/* Indicator search select */}
                      <div className={styles.indicatorSearch}>
                        <IndicatorSearchSelect
                          id={`indicator-${rule.id}`}
                          titleText=""
                          selectedId={rule.indicatorUuid}
                          disabled={disabled}
                          onChange={(indicatorUuid, option) => handleIndicatorSelect(rule.id, indicatorUuid, option)}
                          placeholder="Search indicators..."
                        />
                      </div>

                      {/* Logical operator */}
                      <Select
                        id={`logical-${rule.id}`}
                        size="sm"
                        value={rule.logicalOperator || 'AND'}
                        onChange={(e: any) => updateIndicatorRule(rule.id, { logicalOperator: e.target.value })}
                        disabled={disabled || !rule.indicatorUuid}
                        labelText=""
                      >
                        <SelectItem value="AND" text="AND" />
                        <SelectItem value="OR" text="OR" />
                      </Select>

                      {/* Negate toggle - only show when indicator is selected */}
                      {rule.indicatorUuid && (
                        <div className={styles.negateToggle}>
                          <Toggle
                            id={`negate-${rule.id}`}
                            labelA="Include"
                            labelB="Exclude"
                            toggled={rule.negate ?? false}
                            onToggle={(checked) => updateIndicatorRule(rule.id, { negate: checked })}
                            disabled={disabled}
                          />
                        </div>
                      )}

                      {/* "and" text between conditions */}
                      {index < ((draft.population?.indicatorRules || draft.indicatorRules)?.length || 0) - 1 && (
                        <span className={styles.andText}>and</span>
                      )}

                      {/* Delete button */}
                      <Button
                        kind="ghost"
                        size="sm"
                        hasIconOnly
                        renderIcon={TrashCan}
                        onClick={() => removeIndicatorRule(rule.id)}
                        disabled={disabled}
                        iconDescription="Remove indicator"
                      />
                    </div>
                  ))}

                  {/* Add indicator button */}
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={Add}
                    onClick={addIndicatorRule}
                    disabled={disabled}
                  >
                    Add indicator
                  </Button>
                </Stack>

                {/* Divider between indicators and conditions */}
                <div className={styles.hybridDivider}>
                  <span>AND</span>
                </div>

                {/* SQL Conditions Section in Hybrid Mode */}
                <div className={styles.populationHeader}>
                  <span className={styles.populationLabel}>Additional SQL conditions:</span>
                  <span className={styles.populationHint}>
                    Filter the selected patients further with custom SQL
                  </span>
                </div>

                <Stack gap={3} className={styles.conditionsStack}>
                  {conditions.map((condition, index) => (
                    <div key={condition.id} className={styles.conditionRow}>
                      <Filter size={16} className={styles.rowIcon} />

                      {/* Field selector */}
                      <Select
                        id={`field-${condition.id}`}
                        size="sm"
                        value={condition.field}
                        onChange={(e: any) => updatePopulationCondition(condition.id, { field: e.target.value })}
                        disabled={disabled}
                        labelText=""
                      >
                        <SelectItem value="" text="Select field..." />
                        {populationFields.map((field) => (
                          <SelectItem key={field.name} value={field.name} text={field.label}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </Select>

                      {/* Operator selector - shown when field is selected */}
                      {condition.field && (
                        <Select
                          id={`operator-${condition.id}`}
                          size="sm"
                          value={condition.operator}
                          onChange={(e: any) => updatePopulationCondition(condition.id, { operator: e.target.value })}
                          disabled={disabled}
                          labelText=""
                        >
                          {getOperatorsForFieldType(condition.fieldType).map((op) => (
                            <SelectItem key={op} value={op.toUpperCase()} text={formatOperatorLabel(op)}>
                              {formatOperatorLabel(op)}
                            </SelectItem>
                          ))}
                        </Select>
                      )}

                      {/* Value input - shown when operator requires a value */}
                      {condition.operator && ['IS_BLANK', 'IS_NOT_BLANK'].indexOf(condition.operator) === -1 && (
                        <TextInput
                          id={`value-${condition.id}`}
                          size="sm"
                          value={condition.value || ''}
                          onChange={(e: any) => updatePopulationCondition(condition.id, { value: e.target.value })}
                          disabled={disabled}
                          placeholder="Value"
                          labelText=""
                        />
                      )}

                      {/* Second value input for BETWEEN operators */}
                      {condition.operator === 'BETWEEN' && (
                        <TextInput
                          id={`value2-${condition.id}`}
                          size="sm"
                          value={condition.value2 || ''}
                          onChange={(e: any) => updatePopulationCondition(condition.id, { value2: e.target.value })}
                          disabled={disabled}
                          placeholder="To"
                          labelText=""
                        />
                      )}

                      {/* "and" text between conditions */}
                      {index < conditions.length - 1 && (
                        <span className={styles.andText}>and</span>
                      )}

                      {/* Delete button */}
                      <Button
                        kind="ghost"
                        size="sm"
                        hasIconOnly
                        renderIcon={TrashCan}
                        onClick={() => removePopulationCondition(condition.id)}
                        disabled={disabled}
                        iconDescription="Remove condition"
                      />
                    </div>
                  ))}

                  {/* Add condition button */}
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={Add}
                    onClick={addPopulationCondition}
                    disabled={disabled}
                  >
                    Add condition
                  </Button>
                </Stack>

                {/* Raw SQL Editor for Hybrid Mode */}
                <div className={styles.sqlEditorSection}>
                  <div className={styles.populationHeader}>
                    <span className={styles.populationLabel}>Or edit raw SQL:</span>
                    <span className={styles.populationHint}>
                      Directly edit the SQL query (use :startDate and :endDate for date parameters)
                    </span>
                  </div>
                  <TextArea
                    id="population-sql-hybrid"
                    className={styles.sqlEditor}
                    placeholder="SELECT DISTINCT patient_id AS patient_id FROM your_table WHERE..."
                    value={draft.population?.sqlTemplate || ''}
                    onChange={(e: any) => {
                      onDraftChange({
                        population: {
                          ...draft.population,
                          sqlTemplate: e.target.value,
                        },
                      });
                    }}
                    disabled={disabled}
                    rows={6}
                    labelText=""
                  />
                </div>
              </>
            )}

            {/* FilterMap Configuration */}
            <div className={styles.filterMapSection}>
              <FilterMapEditor
                filterMap={draft.population.filterMap}
                onChange={(filterMap) => onDraftChange({ population: { ...draft.population, filterMap } })}
                disabled={disabled}
                sqlQuery={draft.population.sqlTemplate}
              />
            </div>
          </div>
        )}
      </div>

      {/* Columns Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('columns')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <List size={20} />
            <span className={styles.sectionTitle}>Columns</span>
            <Tag size="sm" type="gray">{draft.columns.length}</Tag>
          </div>
          <div className={styles.sectionHeaderRight}>
            {expandedSections.has('columns') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('columns') && (
          <div className={styles.sectionContent}>
            <ColumnCategorySelector
              columns={draft.columns}
              onChange={(columns) => onDraftChange({ columns })}
              disabled={disabled}
              filterMap={draft.population.filterMap}
            />
          </div>
        )}
      </div>

      {/* Filters Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('filters')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <Filter size={20} />
            <span className={styles.sectionTitle}>Filters</span>
            <Tag size="sm" type="gray">0</Tag>
          </div>
          <div className={styles.sectionHeaderRight}>
            {expandedSections.has('filters') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('filters') && (
          <div className={styles.sectionContent}>
            <div className={styles.placeholderContent}>
              <p>Runtime filters configuration will be shown here.</p>
              <p className={styles.placeholderSubtext}>Filters shown when running the report</p>
            </div>
          </div>
        )}
      </div>

      {/* Sort Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('sort')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <SortAscending size={20} />
            <span className={styles.sectionTitle}>Sort</span>
            <Tag size="sm" type="gray">{draft.sortConfig.length}</Tag>
          </div>
                   <div className={styles.sectionHeaderRight}>
            {expandedSections.has('sort') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('sort') && (
          <div className={styles.sectionContent}>
            <div className={styles.placeholderContent}>
              <p>Sort configuration will be shown here.</p>
              <p className={styles.placeholderSubtext}>
                {draft.sortConfig.length} sort rule{draft.sortConfig.length !== 1 ? 's' : ''} defined
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Parameters Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('parameters')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <Settings size={20} />
            <span className={styles.sectionTitle}>Parameters</span>
            <Tag size="sm" type="gray">{draft.parameters.length}</Tag>
          </div>
          <div className={styles.sectionHeaderRight}>
            {expandedSections.has('parameters') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('parameters') && (
          <div className={styles.sectionContent}>
            <ParameterEditor
              parameters={draft.parameters}
              onChange={(parameters) => onDraftChange({ parameters })}
              disabled={disabled}
            />
          </div>
        )}
      </div>

      {/* Display & Export Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('display')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <Export size={20} />
            <span className={styles.sectionTitle}>Display & Export</span>
          </div>
          <div className={styles.sectionHeaderRight}>
            {expandedSections.has('display') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('display') && (
          <div className={styles.sectionContent}>
            <div className={styles.placeholderContent}>
              <p>Display and export settings will be shown here.</p>
              <p className={styles.placeholderSubtext}>Page size, export formats, etc.</p>
            </div>
          </div>
        )}
      </div>

      {/* JSON Preview Section */}
      <div className={styles.section}>
        <button
          className={styles.sectionHeader}
          onClick={() => toggleSection('json-preview')}
          type="button"
        >
          <div className={styles.sectionHeaderLeft}>
            <Code size={20} />
            <span className={styles.sectionTitle}>JSON Preview</span>
            <Tag size="sm" type="teal">Live</Tag>
          </div>
          <div className={styles.sectionHeaderRight}>
            {expandedSections.has('json-preview') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        {expandedSections.has('json-preview') && (
          <div className={styles.sectionContent}>
            <JsonPreview draft={draft} indicators={indicators} />
          </div>
        )}
      </div>
    </div>
  );
}
