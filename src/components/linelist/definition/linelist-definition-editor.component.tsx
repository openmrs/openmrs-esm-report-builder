/**
 * Linelist Builder Workspace - Three-Panel Layout
 *
 * Full-width, three-panel workspace for creating and editing linelist reports.
 * Follows design spec section 6: Screen 3 — Builder workspace.
 *
 * Layout (Desktop 1440px+):
 * - Left: Data Catalogue (280px, resizable)
 * - Middle: Query Configuration (400px, resizable)
 * - Right: Preview (remaining width, minimum 560px)
 *
 * Panels can collapse at smaller desktop widths.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Button,
  ButtonSet,
  InlineNotification,
  Tag,
  TextInput,
  OverflowMenu,
  OverflowMenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import {
  Save,
  Send,
  Document,
  OverflowMenuHorizontal,
  ChevronLeft,
  ChevronRight,
} from '@carbon/react/icons';
import { useNavigate, useParams } from 'react-router-dom';

import type {
  LinelistReportDraft,
  LinelistColumnDraft,
  FilterFieldType,
  FilterOperator,
  DataSourceInfo,
  ColumnSource,
  LinelistSortConfig,
  LinelistDataDefinitionMap,
  PopulationDefinition,
  PopulationSource,
  LinelistParameterConfig,
} from '../../../types/linelist-types';
import type { EtlStructure } from '../../../types/etl/etl-types';
import {
  draftToConfig,
  // isLinelistDraftReadyToCompile,
  // isLinelistDraftReadyToPublish,
  createEmptyDraft,
  // isLinelistDraftValid,
  validateLinelistDraft,
} from '../../../types/linelist-types';

import {
  createLinelistReport,
  updateLinelistReport,
  configToSavePayload,
  compileLinelistReport,
  previewLinelistReport,
} from '../../../resources/linelist/linelist-reports.api';
import type { LinelistBuilderMeta } from '../../../resources/linelist/linelist-reports.api';
import type { LinelistReportDto } from '../../../types/linelist-types';
import { listReportCategories, type ReportCategoryDto } from '../../../resources/report-category/report-category.api';
import { useIndicatorsByTheme } from '../../../hooks/indicator';

import DataCatalogue from '../design/panels/data-catalogue.component';
import QueryConfigPanel from '../design/panels/query-config-panel.component';
import MultiDatasourceSelector from './panels/multi-datasource-selector.component';
import PopulationSourceSelector from './panels/population-source-selector.component';
import type { CatalogueField } from '../design/panels/data-catalogue.component';
import type { CustomSqlColumnConfig } from './panels/custom-sql-column-modal.component';
import PreviewParameterModal from '../modals/preview-parameter-modal.component';
import styles from './linelist-definition-editor.scss';
import type { LinelistReportDefinitionConfig } from '../../../types/linelist-types';
import CompileSetupModal, { type CompileSetupResult } from '../../shared/compile-setup-modal.component';
import { RB } from '../../../constants/privileges';
import { useReportBuilderPrivileges } from '../../../hooks/use-report-builder-privileges';

type Props = {};

/**
 * Convert LinelistReportDto to LinelistReportDraft for editing (v2)
 * This function populates the draft with all builder details from the saved report
 */
function reportToDraft(report: LinelistReportDto): LinelistReportDraft {
  let config: LinelistReportDefinitionConfig | null = null;

  try {
    config = report.configJson ? JSON.parse(report.configJson) : null;
  } catch (e) {
    console.error('Failed to parse report config:', e);
  }

  // Check for valid LINE_LIST config (handle both type and reportType formats)
  const isValidLinelist = config && (
    config.type === 'LINE_LIST' ||
    (config as any).reportType === 'LINE_LIST' ||
    (config as any).reportType === 'LINELIST'
  );

  if (!config || !isValidLinelist) {
    console.warn('Invalid config or type, returning empty draft');
    return createEmptyDraft();
  }

  const now = new Date().toISOString();
  const dataSet = config.dataSetDefinitions?.[0];

  // The compiled backend format stores builder state under a `_builder` key.
  // Fall back to top-level config fields for older/intermediate formats.
  const builderState = (config as any)._builder;

  // === BUILD DATA SOURCES ARRAY ===
  const dataSources: DataSourceInfo[] = [];
  const configDataSources = builderState?.dataSources || config.dataSources;

  if (configDataSources && configDataSources.length > 0) {
    // V2 format (or compiled _builder) - use dataSources array directly
    configDataSources.forEach((ds: any) => {
      dataSources.push({
        uuid: ds.uuid,
        name: ds.name,
        type: ds.type as any,
        role: ds.role as any,
        tables: ds.columns ? Object.keys(ds.columns) : [],
      });
    });
  } else if (config.version === 1 || !config.dataSources) {
    // V1 format - migrate from dataSourceUuid
    const primaryDataSourceUuid = config.dataSourceUuid || '';
    if (primaryDataSourceUuid) {
      dataSources.push({
        uuid: primaryDataSourceUuid,
        name: primaryDataSourceUuid, // Will be resolved by data catalogue
        type: 'ETL',
        role: 'PRIMARY',
        tables: [],
      });
    }

    // Add CORE datasources if columns use them
    if (dataSet?.columns) {
      const hasPersonAttributes = dataSet.columns.some(col =>
        (col.dataDefinition as any)?.type === 'PERSON_ATTRIBUTE'
      );
      const hasIdentifiers = dataSet.columns.some(col =>
        (col.dataDefinition as any)?.type === 'IDENTIFIER'
      );

      if (hasPersonAttributes) {
        dataSources.push({
          uuid: 'person_attributes',
          name: 'Person Attributes',
          type: 'CORE',
          role: 'REFERENCE',
        });
      }

      if (hasIdentifiers) {
        dataSources.push({
          uuid: 'patient_identifiers',
          name: 'Patient Identifiers',
          type: 'CORE',
          role: 'REFERENCE',
        });
      }
    }
  } else {
    // V2 format - use dataSources array directly
    if (config.dataSources && config.dataSources.length > 0) {
      config.dataSources.forEach(ds => {
        dataSources.push({
          uuid: ds.uuid,
          name: ds.name,
          type: ds.type as any,
          role: ds.role as any,
          tables: ds.columns ? Object.keys(ds.columns) : [],
        });
      });
    }
  }

  // Get primary datasource UUID from the migrated dataSources
  const primaryDataSourceUuid = dataSources.find(ds => ds.role === 'PRIMARY')?.uuid || '';

  // === BUILD COLUMN → SOURCE LOOKUP FROM dataSources METADATA ===
  // The V2 contract stores per-column source info inside dataSources[].columns.
  // Build a map: columnName (lowercase) → { dataSource, table, fieldType }
  type SourceLookup = {
    dataSourceUuid: string;
    dataSourceName: string;
    table: string;
    fieldType: string;
  };
  const columnSourceLookup = new Map<string, SourceLookup>();
  (configDataSources as any[]).forEach((ds) => {
    const dsColumns = ds.columns || {};
    Object.values(dsColumns).forEach((colInfo: any) => {
      const lookupKey = (colInfo?.name || '').toLowerCase();
      if (lookupKey) {
        columnSourceLookup.set(lookupKey, {
          dataSourceUuid: ds.uuid,
          dataSourceName: ds.name,
          table: colInfo?.sourceTable || ds.uuid,
          fieldType: colInfo?.type || 'UNKNOWN',
        });
      }
    });
  });

  // Track unique tables used
  const tablesUsed = new Set<string>();

  // === EXTRACT COLUMNS WITH SOURCE INFO ===
  const columns: LinelistColumnDraft[] = [];

  if (dataSet?.columns) {
    dataSet.columns.forEach((col, idx) => {
      const defType = (col.dataDefinition as any)?.type;
      const defConfig = (col.dataDefinition as any)?.config;
      const colNameLower = col.name.toLowerCase();
      const sqlStr = defConfig?.sql || '';
      // Detect custom SQL (a full query, not a simple table.column reference)
      const isCustomSql = /^\s*SELECT\s/i.test(sqlStr) || /:(patientId|patient_id)\b/i.test(sqlStr);

      // Determine source based on data definition type
      let source: ColumnSource;

      if (defType === 'PERSON_ATTRIBUTE') {
        source = {
          dataSourceUuid: 'person_attributes',
          dataSourceName: 'Person Attributes',
          table: 'person_attribute',
          field: col.name,
          fieldType: 'PERSON_ATTRIBUTE',
          attributeTypeUuid: defConfig?.attributeTypeUuid,
        };
      } else if (defType === 'IDENTIFIER') {
        source = {
          dataSourceUuid: 'patient_identifiers',
          dataSourceName: 'Patient Identifiers',
          table: 'patient_identifier',
          field: col.name,
          fieldType: 'IDENTIFIER',
          identifierTypeUuid: defConfig?.identifierTypeUuid,
        };
      } else if (defType === 'CALCULATION') {
        // Calculated field (e.g., Age)
        source = {
          dataSourceUuid: primaryDataSourceUuid,
          dataSourceName: primaryDataSourceUuid,
          table: 'calculated',
          field: col.name,
          fieldType: 'CALCULATED',
        };
      } else {
        // SQL column - use the dataSources metadata lookup first, then fall back
        const lookup = columnSourceLookup.get(colNameLower);

        if (lookup && !isCustomSql) {
          // Found in the dataSources metadata
          source = {
            dataSourceUuid: lookup.dataSourceUuid,
            dataSourceName: lookup.dataSourceName,
            table: lookup.table,
            field: col.name,
            fieldType: lookup.fieldType,
          };
          tablesUsed.add(lookup.table);
        } else if (isCustomSql) {
          // Custom SQL column - per-row query with :patientId / :patient_id
          source = {
            dataSourceUuid: lookup?.dataSourceUuid || primaryDataSourceUuid || 'custom_sql',
            dataSourceName: lookup?.dataSourceName || 'Custom SQL',
            table: 'custom_sql',
            field: col.name,
            fieldType: 'SQL',
          };
        } else {
          // Simple SQL reference like `table`.`column` - parse it
          const sqlMatch = sqlStr.match(/`?(\w+)`?\.\s*`?(\w+)`?/);
          if (sqlMatch) {
            source = {
              dataSourceUuid: primaryDataSourceUuid,
              dataSourceName: primaryDataSourceUuid,
              table: sqlMatch[1],
              field: sqlMatch[2],
              fieldType: 'DERIVED',
            };
            tablesUsed.add(sqlMatch[1]);
          } else {
            // Fallback
            source = {
              dataSourceUuid: primaryDataSourceUuid,
              dataSourceName: primaryDataSourceUuid,
              table: 'unknown',
              field: col.name,
              fieldType: 'UNKNOWN',
            };
          }
        }
      }

      const columnDraft: LinelistColumnDraft = {
        id: `col-${idx}`,
        name: col.name,
        description: '',
        source,
        dataDefinitionType: (defType || 'SQL') as keyof LinelistDataDefinitionMap,
        dataDefinitionConfig: defConfig || {},
        additionInfo: {
          addedVia: isCustomSql ? 'SQL_BUILDER' : 'IMPORT',
          addedAt: now,
          orderAdded: idx,
        },
        display: {
          width: 150,
          align: defType === 'CALCULATION' ? 'center' : 'left',
          sortable: true,
          filterable: defType !== 'CALCULATION',
          format: defType === 'CALCULATION' ? 'number' : 'text',
        },
        sortOrder: idx,
        repeatResolution: (col as any).repeatResolution,
        transformations: (col as any).transformations || [],
      };

      columns.push(columnDraft);
    });
  }

  // Update data sources with tables used
  dataSources.forEach(ds => {
    if (ds.uuid === primaryDataSourceUuid) {
      ds.tables = Array.from(tablesUsed);
    }
  });

  // === EXTRACT PARAMETERS ===
  let parameters = config.parameters?.map((param, idx) => ({
    id: `param-${idx}`,
    name: param.name,
    label: param.label,
    type: param.type,
    required: param.required || false,
    defaultValue: param.defaultValue || '',
    displayOrder: param.displayOrder || idx,
    config: (param.config || { type: param.type }) as LinelistParameterConfig,
  })) || [];

  // === EXTRACT BUILDER METADATA (build method, indicators, visualFilter, filterMap) ===
  // Builder state lives under `_builder` (compiled format) or at the top level
  // (intermediate format). Read from _builder first, then fall back.
  let buildMethod: PopulationDefinition['buildMethod'] = builderState?.buildMethod || (config as any).buildMethod || 'SQL_BUILDER';
  let indicatorRules: PopulationDefinition['indicatorRules'] = undefined;
  let loadedVisualFilter: any = undefined;
  let loadedFilterMap: any = undefined;

  // Try to load visualFilter from config._builder or top-level config
  const configVisualFilter = builderState?.visualFilter || (config as any).visualFilter;
  if (configVisualFilter) {
    loadedVisualFilter = configVisualFilter;
  }

  // Try to load filterMap from config._builder or config.baseCohortDefinition.config
  const configFilterMap = builderState?.filterMap || config.baseCohortDefinition?.config?.filterMap;
  if (configFilterMap) {
    loadedFilterMap = configFilterMap;
  }

  const configIndicatorRules = builderState?.indicatorRules || (config as any).indicatorRules;
  if (Array.isArray(configIndicatorRules) && configIndicatorRules.length > 0) {
    indicatorRules = configIndicatorRules.map((rule: any, idx: number) => ({
      id: rule.id || `rule-${idx}`,
      indicatorUuid: rule.indicatorUuid,
      name: rule.name || '',
      conditions: rule.conditions,
      logicalOperator: rule.logicalOperator || 'AND',
      negate: rule.negate || false,
    }));
  }

  // Fall back to metaJson for buildMethod, indicator rules, parameters if not in config
  // Load parameters from metaJson if available (for dynamic parameter options like LIST options)
  if (report.metaJson) {
    try {
      const meta = JSON.parse(report.metaJson);
      // Try to get buildMethod from metaJson as fallback
      if (meta.buildMethod && (meta.buildMethod === 'INDICATOR_BASED' || meta.buildMethod === 'VISUAL_FILTER' || meta.buildMethod === 'SQL_BUILDER')) {
        buildMethod = meta.buildMethod;
      }
      // Also try to get indicator rules from metaJson as fallback
      if (!indicatorRules && Array.isArray(meta.indicatorRules) && meta.indicatorRules.length > 0) {
        indicatorRules = meta.indicatorRules.map((rule: any, idx: number) => ({
          id: rule.id || `rule-${idx}`,
          indicatorUuid: rule.indicatorUuid,
          name: rule.name || '',
          conditions: rule.conditions,
          logicalOperator: rule.logicalOperator || 'AND',
          negate: rule.negate || false,
        }));
      }
      // Load parameters from metaJson if available (for dynamic parameter options)
      // This takes precedence over config parameters since metaJson may have updated options
      if (meta.parameters && Array.isArray(meta.parameters) && meta.parameters.length > 0) {
        parameters = meta.parameters.map((param: any, idx: number) => ({
          id: param.id || `param-${idx}`,
          name: param.name,
          label: param.label,
          type: param.type,
          required: param.required || false,
          defaultValue: param.defaultValue || '',
          displayOrder: param.displayOrder !== undefined ? param.displayOrder : idx,
          config: (param.config || { type: param.type }) as LinelistParameterConfig,
        }));
      }
    } catch (e) {
      console.warn('Failed to parse metaJson:', e);
    }
  }

  // === BUILD SORT CONFIG ===
  const sortConfig: LinelistSortConfig[] = [];
  if (config.orderBy) {
    sortConfig.push({
      id: `sort-0`,
      columnId: config.orderBy,
      columnName: config.orderBy,
      direction: config.orderDirection || 'ASC',
      nulls: 'LAST',
      sortOrder: 0,
    });
  }

  // === BUILD POPULATION DEFINITION ===
  const cohortSql = config.baseCohortDefinition?.config?.sql || '';
  const baseDsUuid = dataSources.find(ds => ds.role === 'PRIMARY')?.uuid || primaryDataSourceUuid;

  const population: PopulationDefinition = {
    baseDataSourceUuid: baseDsUuid,
    buildMethod,
    sqlTemplate: cohortSql,
    parameterReferences: extractParameterReferences(cohortSql),
    // Restore visual filter from metaJson if available, otherwise use empty default
    visualFilter: loadedVisualFilter || {
      rootGroup: {
        id: 'root',
        logicalOperator: 'AND',
        conditions: [],
        nestedGroups: [],
      },
      useVisualBuilder: false,
    },
    // Restore filter map from metaJson or config, otherwise undefined
    filterMap: loadedFilterMap || undefined,
    // Reconstruct indicator rules so they show as selected on edit
    indicatorRules,
    buildHistory: [
      {
        timestamp: now,
        action: 'IMPORTED_FROM_EXISTING',
        description: config.version === 1 ? 'Migrated from V1 format (single datasource)' : 'Imported from existing report definition',
      },
    ],
  };

  // === CREATE THE DRAFT ===
  // Build population sources from primary datasource
  const populationSources: PopulationSource[] = [];
  const primaryDs = dataSources.find(ds => ds.role === 'PRIMARY');
  if (primaryDs) {
    populationSources.push({
      uuid: primaryDs.uuid,
      name: primaryDs.name,
      type: primaryDs.type,
      joinType: 'JOIN',
      enabled: true,
      order: 0,
    });
  }

  const draft: LinelistReportDraft = {
    version: 3,
    name: report.name || '',
    description: report.description || '',
    code: report.code || '',
    currentPanel: 'basics',
    categoryUuid: config.categoryUuid || '',
    rowGrain: config.rowGrain || 'PATIENT',
    templateId: config.templateId || '',
    populationSources,
    dataSources,
    population,
    columns,
    parameters,
    sortConfig,
    limit: config.limit,
    // Legacy top-level fields used by the indicator UI and getCohortSql().
    // Keep them in sync with population.* so the existing code paths work.
    populationMode: buildMethod === 'INDICATOR_BASED' ? 'INDICATOR' : 'SQL',
    indicatorRules,
    displaySettings: {
      defaultPageSize: 25,
      freezeFirstColumn: true,
      freezeHeader: true,
      dateDisplayFormat: 'dd MMM yyyy',
      nullDisplayValue: '—',
      maxInteractiveRows: 500,
      maxExportRows: 100000,
      allowedExports: ['CSV', 'XLSX', 'PDF'],
      includeParametersInExportHeader: true,
      includeGeneratedTimestamp: true,
    },
    validation: {
      errors: {},
      warnings: {},
      lastValidated: now,
    },
    metadata: {
      createdAt: now,
      lastModified: now,
      buildMethod: 'EDIT',
      sourceReportUuid: report.uuid,
      version: 3,
      status: 'DRAFT',
    },
  };

  return draft;
}

/**
 * Extract parameter references from SQL
 * Finds patterns like :paramName
 */
function extractParameterReferences(sql: string): string[] {
  const paramRegex = /:(\w+)/g;
  const params = new Set<string>();
  let match;
  while ((match = paramRegex.exec(sql)) !== null) {
    params.add(match[1]);
  }
  return Array.from(params);
}

const LinelistBuilderWorkspace: React.FC<Props> = () => {
  const navigate = useNavigate();
  const { reportId } = useParams();
  const { has: hasPrivilege } = useReportBuilderPrivileges();

  // Report state
  const [draft, setDraft] = useState<LinelistReportDraft>(createEmptyDraft());
  const [initialReport, setInitialReport] = useState<LinelistReportDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compileSuccess, setCompileSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');

  // Reference data
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [categories, setCategories] = useState<ReportCategoryDto[]>([]);

  // Panel state
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [middlePanelCollapsed, setMiddlePanelCollapsed] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(500);
  const [middlePanelWidth, setMiddlePanelWidth] = useState(500);

  // Resizable state
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingMiddle, setIsResizingMiddle] = useState(false);

  // Preview state
  const [previewRunning, setPreviewRunning] = useState(false);
  const [cachedReportDefinitionUuid, setCachedReportDefinitionUuid] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    columns: string[];
    rows: Record<string, any>[];
    rowCount: number;
    html?: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewParamModalOpen, setPreviewParamModalOpen] = useState(false);

  // Available fields from data catalogue (for visual filter builder)
  const [availableFields, setAvailableFields] = useState<Array<{ name: string; label: string; type: FilterFieldType }>>([]);

  // ETL structure for selected data source (for future use)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [etlStructure, setEtlStructure] = useState<EtlStructure | null>(null);

  // Indicators for population (load all available indicators)
  const { indicators } = useIndicatorsByTheme(''); // Empty string to load all indicators

  // Compile setup modal state
  const [showCompileSetupModal, setShowCompileSetupModal] = useState(false);


  /**
   * Load report for editing
   */
  useEffect(() => {
    if (reportId && reportId !== 'new') {
      setLoading(true);
      setError(null);

      import('../../../resources/linelist/linelist-reports.api')
        .then(({ getLinelistReport }) => getLinelistReport(reportId))
        .then((report: LinelistReportDto) => {
          setInitialReport(report);
          setMode('edit');
          // Convert report to draft
          const draft = reportToDraft(report);
          setDraft(draft);
          // Cache the compiledReportDefinitionUuid from the loaded report for preview
          if (report.compiledReportDefinitionUuid) {
            setCachedReportDefinitionUuid(report.compiledReportDefinitionUuid);
          }
        })
        .catch((err) => {
          console.error('Failed to load report:', err);
          setError(err instanceof Error ? err.message : 'Failed to load report');
        })
        .finally(() => setLoading(false));
    } else {
      setMode('create');
      setDraft(createEmptyDraft());
      setLoading(false);
    }
  }, [reportId]);

  /**
   * Load reference data
   */
  useEffect(() => {
    const loadData = async () => {
      try {
        const cats = await listReportCategories();
        setCategories(cats);
      } catch (err) {
        console.error('Failed to load reference data:', err);
      }
    };
    loadData();
  }, []);

  /**
   * Invalidate compiled cache when draft structure changes
   * This ensures we recompile when columns, data sources, or SQL changes
   */
  useEffect(() => {
    // Clear cache when draft structure changes
    setCachedReportDefinitionUuid(null);
  }, [draft.columns.length, draft.dataSources.length, draft.population.sqlTemplate, draft.rowGrain]);

  /**
   * Handle save draft
   */
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);

    try {
      // Convert indicators array to Map for draftToConfig
      const indicatorsMap = new Map(
        indicators.map(ind => [ind.uuid, ind])
      );
      // Pass indicators map so draftToConfig can generate SQL from indicator rules
      const config = draftToConfig(draft, indicatorsMap);
      // Preserve builder state (indicators, build method, population sources, visual filter, filter map) in metaJson so the
      // editor can reconstruct the draft when re-opening for edit.
      const builderMeta: LinelistBuilderMeta = {
        buildMethod: draft.population.buildMethod,
        indicatorRules: draft.population.indicatorRules,
        populationSources: draft.populationSources,
        // Preserve visual filter state for reconstructing the filter UI
        visualFilter: draft.population.visualFilter,
        // Preserve filter map for parameter-to-column mapping
        filterMap: draft.population.filterMap,
      };
      const payload = configToSavePayload(config, draft, builderMeta);

      let result;
      if (mode === 'create') {
        result = await createLinelistReport(payload);
        // Navigate to edit mode after creating a new report
        navigate(`/linelist/edit/${result.uuid}`, { replace: true });
      } else {
        result = await updateLinelistReport(initialReport?.uuid || '', payload);
      }

      setInitialReport(result);
      setDraft(prev => ({ ...prev, unsavedChanges: false }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save report');
    } finally {
      setSaving(false);
    }
  }, [draft, mode, initialReport, indicators, navigate]);

  /**
   * Handle compile
   * Always shows the compile setup modal for category confirmation/selection
   */
  const handleCompile = useCallback(async () => {
    setCompileError(null);
    setSaveError(null);

    // Always show the modal to allow category confirmation/selection
    setShowCompileSetupModal(true);
  }, []);

  /**
   * Handle navigate back
   */
  const handleBack = useCallback(() => {
    navigate('/linelist');
  }, [navigate]);

  /**
   * Update draft field
   */
  const updateDraft = useCallback((updates: Partial<LinelistReportDraft>) => {
    setDraft(prev => ({ ...prev, ...updates, unsavedChanges: true }));
  }, []);

  /**
   * Handle compile setup modal cancel
   */
  const handleCompileSetupCancel = useCallback(() => {
    setShowCompileSetupModal(false);
  }, []);

  /**
   * Handle compile setup modal confirm
   * This is called after the user selects category in the modal
   */
  const handleCompileSetupConfirm = useCallback(async (result: CompileSetupResult) => {
    setShowCompileSetupModal(false);

    // Create updated draft with new category for validation
    const updatedDraft = { ...draft, categoryUuid: result.categoryUuid };

    // Check validation before saving/compiling
    const errors = validateLinelistDraft(updatedDraft);
    if (Object.keys(errors).length > 0) {
      // Show specific validation errors
      const errorMessages = Object.values(errors).join(', ');
      setSaveError(`Cannot compile: ${errorMessages}`);
      return;
    }

    // Update the draft with selected category
    updateDraft({
      categoryUuid: result.categoryUuid,
    });

    // Save if there are unsaved changes or no initial report
    if (draft.unsavedChanges || !initialReport?.uuid) {
      await handleSave();
    }

    if (!initialReport?.uuid) {
      setCompileError('Cannot compile: Report must be saved first');
      return;
    }

    setCompiling(true);
    setCompileError(null);
    setCompileSuccess(null);

    try {
      const compiledResult = await compileLinelistReport(initialReport.uuid, draft.categoryUuid);

      // Cache the reportDefinitionUuid for subsequent previews
      if (compiledResult?.reportDefinitionUuid) {
        setCachedReportDefinitionUuid(compiledResult.reportDefinitionUuid);
      }

      setCompileSuccess(
        compiledResult?.reportDefinitionUuid
          ? `Compiled successfully. Runtime report UUID: ${compiledResult.reportDefinitionUuid}`
          : 'Compiled successfully.'
      );
    } catch (err) {
      setCompileError(err instanceof Error ? err.message : 'Failed to compile report');
    } finally {
      setCompiling(false);
    }
  }, [draft, initialReport?.uuid, handleSave, updateDraft]);

  /**
   * Handle datasources change
   * Updates the dataSources array in the draft
   */
  const handleDataSourcesChange = useCallback((dataSources: DataSourceInfo[]) => {
    updateDraft({ dataSources });
  }, [updateDraft]);

  /**
   * Handle data source table change
   * Updates the primary data source in the dataSources array
   */
  const handleTableChange = useCallback((table: string) => {
    // For now, update the first data source or create a new primary one
    const newDataSources = [...draft.dataSources];
    if (newDataSources.length > 0) {
      newDataSources[0].uuid = table;
      newDataSources[0].name = table;
    } else {
      newDataSources.push({
        uuid: table,
        name: table,
        type: 'ETL',
        role: 'PRIMARY',
      });
    }
    updateDraft({ dataSources: newDataSources });
  }, [updateDraft, draft.dataSources]);

  /**
   * Get list of selected field IDs for highlighting in catalogue
   * Constructs field IDs based on column type to match catalogue formats:
   * - Person attributes: person-attribute-${uuid}
   * - Patient identifiers: patient-identifier-${uuid}
   * - Calculated fields: openmrs.calc.${name}
   * - CORE/Demographic: openmrs.${table}.${name}
   * - ETL columns: ${table}.${name}
   */
  const selectedFieldIds = useMemo(() => {
    return draft.columns.map((col) => {
      // Person attributes
      if (col.dataDefinitionType === 'PERSON_ATTRIBUTE') {
        return `person-attribute-${col.source.attributeTypeUuid || col.name}`;
      }
      // Patient identifiers
      if (col.dataDefinitionType === 'IDENTIFIER') {
        return `patient-identifier-${col.source.identifierTypeUuid || col.name}`;
      }
      // Calculated fields
      if (col.dataDefinitionType === 'CALCULATION') {
        const calcName = (col.dataDefinitionConfig.calculation || col.name).toLowerCase();
        return `openmrs.calc.${calcName}`;
      }
      // CORE/Demographic fields (person, person_address tables)
      if (col.source.table === 'person' || col.source.table === 'person_address') {
        return `openmrs.${col.source.table}.${col.source.field || col.name}`;
      }
      // Person name fields
      if (col.dataDefinitionType === 'PERSON_NAME') {
        return `openmrs.person.${col.source.field || col.name}`;
      }
      // ETL columns - use data source UUID or table name
      const table = col.source.table || col.source.dataSourceUuid || 'unknown';
      return `${table}.${col.source.field || col.name}`;
    });
  }, [draft.columns]);

  /**
   * Handle removing a column
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleRemoveColumn = useCallback((columnId: string) => {
    // Clear any error message
    setSaveError(null);
  }, []);

  /**
   * Open preview parameter modal
   */
  const handleRunPreview = useCallback(() => {
    // Check if draft has required fields
    if (!draft.population?.sqlTemplate || draft.columns.length === 0) {
      setPreviewError('Please add a base cohort definition and at least one column before running preview.');
      return;
    }

    // Check if report needs to be saved first (for new reports)
    if (!initialReport?.uuid) {
      setPreviewError('Please save the report first before running preview.');
      return;
    }

    // Open the parameter modal
    setPreviewParamModalOpen(true);
    setPreviewError(null);
  }, [draft.population?.sqlTemplate, draft.columns.length, initialReport?.uuid]);

  /**
   * Run preview with parameters
   */
  const handleRunPreviewWithParams = useCallback(async (parameterValues: Record<string, any>) => {
    // Close the modal
    setPreviewParamModalOpen(false);
    setPreviewRunning(true);
    setPreviewError(null);

    try {
      // Convert indicators array to Map for draftToConfig
      const indicatorRules = draft.indicatorRules || draft.population?.indicatorRules || [];
      const indicatorsMap = new Map(
        indicatorRules.map(rule => [
          rule.indicatorUuid,
          { sqlTemplate: rule.sqlTemplate, configJson: rule.configJson }
        ])
      );

      // Convert draft to config
      const config = draftToConfig(draft, indicatorsMap);

      // Call preview API with report UUID and parameters
      // Only works with saved reports (not new drafts)
      const result = await previewLinelistReport({
        reportUuid: initialReport?.uuid || '',
        config,
        parameters: parameterValues,
        maxRows: 100, // Limit preview to 100 rows
        cachedReportDefinitionUuid: cachedReportDefinitionUuid || undefined,
      });

      if (!result.success) {
        setPreviewError(result.error || 'Preview failed');
        return;
      }

      if (result.data) {
        // Store the full result with metadata
        setPreviewData({
          columns: result.data.columns,
          rows: result.data.rows,
          rowCount: result.data.rowCount,
          html: result.data.html,
        });
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewRunning(false);
    }
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Handle adding field from catalogue as column
   */
  const handleAddFieldAsColumn = useCallback((field: CatalogueField) => {
    // Check if column already exists
    if (draft.columns.some((col) => col.name === field.label || col.name === field.name)) {
      setSaveError('This field is already added as a column');
      return;
    }

    // Handle special cases for person attributes and patient identifiers
    const isPersonAttribute = field.id.startsWith('person-attribute-');
    const isPatientIdentifier = field.id.startsWith('patient-identifier-');
    const uuid = field.name; // For API fields, we store the UUID in the name field
    const now = new Date().toISOString();

    let newColumn: LinelistColumnDraft;
    let source: ColumnSource;

    if (isPersonAttribute) {
      // Person Attribute column
      source = {
        dataSourceUuid: 'person_attributes',
        dataSourceName: 'Person Attributes',
        table: 'person_attribute',
        field: field.label,
        fieldType: 'PERSON_ATTRIBUTE',
        attributeTypeUuid: uuid,
      };
      newColumn = {
        id: `col-${Date.now()}`,
        name: field.label,
        description: '',
        source,
        dataDefinitionType: 'PERSON_ATTRIBUTE',
        dataDefinitionConfig: { attributeTypeUuid: uuid },
        additionInfo: {
          addedVia: 'DRAG_DROP',
          addedAt: now,
          orderAdded: draft.columns.length,
        },
        display: {
          width: 150,
          align: 'left',
          sortable: true,
          filterable: true,
          format: 'text',
        },
        sortOrder: draft.columns.length,
        transformations: [],
      };
    } else if (isPatientIdentifier) {
      // Patient Identifier column
      source = {
        dataSourceUuid: 'patient_identifiers',
        dataSourceName: 'Patient Identifiers',
        table: 'patient_identifier',
        field: field.label,
        fieldType: 'IDENTIFIER',
        identifierTypeUuid: uuid,
      };
      newColumn = {
        id: `col-${Date.now()}`,
        name: field.label,
        description: '',
        source,
        dataDefinitionType: 'IDENTIFIER',
        dataDefinitionConfig: { identifierTypeUuid: uuid, preferred: false },
        additionInfo: {
          addedVia: 'DRAG_DROP',
          addedAt: now,
          orderAdded: draft.columns.length,
        },
        display: {
          width: 150,
          align: 'left',
          sortable: true,
          filterable: true,
          format: 'text',
        },
        sortOrder: draft.columns.length,
        repeatResolution: {
          strategy: 'LATEST',
          orderBy: undefined,
          restrictToPeriod: false,
          ignoreVoided: true,
        },
        transformations: [],
      };
    } else if (field.source === 'CALCULATION') {
      // Calculated field
      const primaryDataSource = draft.dataSources.find(ds => ds.role === 'PRIMARY');
      source = {
        dataSourceUuid: primaryDataSource?.uuid || '',
        dataSourceName: primaryDataSource?.name || '',
        table: 'calculated',
        field: field.name,
        fieldType: 'CALCULATED',
      };
      newColumn = {
        id: `col-${Date.now()}`,
        name: field.label || field.name,
        description: '',
        source,
        dataDefinitionType: 'CALCULATION',
        dataDefinitionConfig: { calculation: field.name.toUpperCase(), onDate: ':startDate' },
        additionInfo: {
          addedVia: 'DRAG_DROP',
          addedAt: now,
          orderAdded: draft.columns.length,
        },
        display: {
          width: 120,
          align: 'center',
          sortable: true,
          filterable: false,
          format: 'number',
        },
        sortOrder: draft.columns.length,
        transformations: [],
      };
    } else if (field.id.startsWith('openmrs.person_address.') || field.table === 'person_address') {
      // Person Address field
      source = {
        dataSourceUuid: 'person_address',
        dataSourceName: 'Person Address',
        table: 'person_address',
        field: field.name,
        fieldType: 'TEXT',
      };
      newColumn = {
        id: `col-${Date.now()}`,
        name: field.label || field.name,
        description: '',
        source,
        dataDefinitionType: 'PERSON_ADDRESS',
        dataDefinitionConfig: {
          type: 'ADDRESS_FIELD',
          field: field.name, // e.g., 'address5', 'address4', etc.
        },
        additionInfo: {
          addedVia: 'DRAG_DROP',
          addedAt: now,
          orderAdded: draft.columns.length,
        },
        display: {
          width: 150,
          align: 'left',
          sortable: true,
          filterable: true,
          format: 'text',
        },
        sortOrder: draft.columns.length,
        transformations: [],
      };
    } else {
      // SQL/ETL column
      source = {
        dataSourceUuid: field.dataSourceUuid || field.table,
        dataSourceName: field.dataSourceName || field.table,
        table: field.table,
        field: field.name,
        fieldType: field.type || 'UNKNOWN',
      };
      newColumn = {
        id: `col-${Date.now()}`,
        name: field.label || field.name,
        description: '',
        source,
        dataDefinitionType: 'SQL',
        dataDefinitionConfig: {
          sql: `\`${field.table}\`.\`${field.name}\``, // Default SQL - table.column
        },
        additionInfo: {
          addedVia: 'DRAG_DROP',
          addedAt: now,
          orderAdded: draft.columns.length,
        },
        display: {
          width: 150,
          align: 'left',
          sortable: true,
          filterable: true,
          format: 'text',
        },
        sortOrder: draft.columns.length,
        repeatResolution: field.isRepeated ? {
          strategy: 'LATEST',
          orderBy: undefined,
          restrictToPeriod: false,
          ignoreVoided: true,
        } : undefined,
        transformations: [],
      };
    }

    const updatedColumns = [...draft.columns, newColumn];
    updateDraft({ columns: updatedColumns });
  }, [draft.columns, draft.dataSources, updateDraft]);

  /**
   * Handle adding a custom SQL column from the modal
   * The SQL runs per-row and can reference :patient_id / :patient_id
   */
  const handleAddCustomSqlColumn = useCallback((config: CustomSqlColumnConfig) => {
    // Prevent duplicate column names
    if (draft.columns.some((col) => col.name.toLowerCase() === config.name.toLowerCase())) {
      setSaveError('A column with this name already exists');
      return;
    }

    const now = new Date().toISOString();
    const primaryDataSource = draft.dataSources.find(ds => ds.role === 'PRIMARY');

    const newColumn: LinelistColumnDraft = {
      id: `col-${Date.now()}`,
      name: config.name,
      description: config.description || '',
      source: {
        dataSourceUuid: primaryDataSource?.uuid || 'custom_sql',
        dataSourceName: primaryDataSource?.name || 'Custom SQL',
        table: 'custom_sql',
        field: config.name,
        fieldType: 'SQL',
      },
      dataDefinitionType: 'SQL',
      dataDefinitionConfig: {
        sql: config.sql,
      },
      additionInfo: {
        addedVia: 'SQL_BUILDER',
        addedAt: now,
        orderAdded: draft.columns.length,
      },
      display: {
        width: 150,
        align: 'left',
        sortable: true,
        filterable: true,
        format: 'text',
      },
      sortOrder: draft.columns.length,
      repeatResolution: config.repeatResolution ? {
        strategy: 'LATEST',
        orderBy: undefined,
        restrictToPeriod: false,
        ignoreVoided: true,
      } : undefined,
      transformations: [],
    };

    const updatedColumns = [...draft.columns, newColumn];
    updateDraft({ columns: updatedColumns });
  }, [draft.columns, draft.dataSources, updateDraft]);

  /**
   * Handle adding draft column (from observation/diagnosis modals)
   */
  const handleAddDraftColumn = useCallback((column: LinelistColumnDraft) => {
    // Prevent duplicate column names
    if (draft.columns.some((col) => col.name.toLowerCase() === column.name.toLowerCase())) {
      setSaveError('A column with this name already exists');
      return;
    }

    const updatedColumns = [...draft.columns, column];
    updateDraft({ columns: updatedColumns });
  }, [draft.columns, updateDraft]);

  /**
   * Handle adding field from catalogue as filter
   */
  const handleAddFieldAsFilter = useCallback((field: CatalogueField) => {
    const newCondition = {
      id: `cond-${Date.now()}`,
      field: field.name,
      fieldLabel: field.label,
      fieldType: field.type,
      operator: getDefaultOperator(field.type),
      value: '',
    };

    const updatedFilter = {
      ...draft.population.visualFilter,
      rootGroup: {
        ...draft.population.visualFilter?.rootGroup,
        conditions: [...(draft.population.visualFilter?.rootGroup?.conditions || []), newCondition],
      },
    };

    updateDraft({ population: { ...draft.population, visualFilter: updatedFilter } });
  }, [draft.population, updateDraft]);

  /**
   * Handle fields available from data catalogue
   * Convert CatalogueField[] to format expected by visual filter builder
   */
  const handleFieldsAvailable = useCallback((fields: CatalogueField[]) => {
    const filterFields = fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
    }));
    setAvailableFields(filterFields);
  }, []);

  /**
   * Handle ETL structure detection from data catalogue
   */
  const handleEtlStructureDetected = useCallback((structure: EtlStructure) => {
    setEtlStructure(structure);
  }, []);

  /**
   * Handle panel resize with mouse
   */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = Math.max(200, Math.min(500, e.clientX));
        setLeftPanelWidth(newWidth);
      }
      if (isResizingMiddle) {
        const workspaceRect = document.querySelector(`.${styles.workspace}`)?.getBoundingClientRect();
        if (workspaceRect) {
          const leftPanelEnd = leftPanelCollapsed ? 48 : leftPanelWidth;
          const newWidth = Math.max(400, Math.min(700, e.clientX - workspaceRect.left - leftPanelEnd));
          setMiddlePanelWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingMiddle(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = '';
    };

    if (isResizingLeft || isResizingMiddle) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizingLeft, isResizingMiddle, leftPanelWidth, leftPanelCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Start resizing left panel
   */
  const startResizeLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeft(true);
  }, []);

  /**
   * Start resizing middle panel
   */
  const startResizeMiddle = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingMiddle(true);
  }, []);

/**
 * Get default operator for field type
 */
function getDefaultOperator(fieldType: FilterFieldType): FilterOperator {
  switch (fieldType) {
    case 'TEXT':
      return 'CONTAINS';
    case 'NUMBER':
      return 'EQUALS';
    case 'DATE':
      return 'BETWEEN_DATES';
    case 'CODED':
      return 'IS_ONE_OF';
    case 'BOOLEAN':
      return 'IS_TRUE';
    case 'LOCATION':
      return 'IN_LOCATION';
    default:
      return 'EQUALS';
  }
}

  if (loading) {
    return (
      <div className={styles.workspace}>
        <div className={styles.loading}>Loading report...</div>
      </div>
    );
  }

  return (
    <div className={styles.workspace}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            renderIcon={ChevronLeft}
            iconDescription="Back"
            onClick={handleBack}
          />
        </div>
        <div className={styles.headerCenter}>
          <TextInput
            id="report-name"
            labelText=""
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            placeholder="Report name"
            className={styles.nameInput}
            size="sm"
          />
          <Tag size="sm" type={compileSuccess ? 'green' : 'gray'}>
            {compileSuccess ? 'Compiled' : 'Draft'}
          </Tag>
          {draft.unsavedChanges && (
            <Tag size="sm" type="blue">Unsaved</Tag>
          )}
        </div>
        <div className={styles.headerRight} >
          <ButtonSet>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Save}
              onClick={handleSave}
              disabled={saving || !draft.unsavedChanges}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              kind="primary"
              size="sm"
              renderIcon={Send}
              onClick={handleCompile}
              disabled={compiling || !initialReport?.uuid || !hasPrivilege(RB.REPORT_COMPILE)}
              title={
                hasPrivilege(RB.REPORT_COMPILE)
                  ? undefined
                  : 'Requires the report compile privilege'
              }
            >
              {compiling ? 'Compiling...' : 'Compile'}
            </Button>
          </ButtonSet>
          <OverflowMenu size="sm" renderIcon={OverflowMenuHorizontal} align="right">
            <OverflowMenuItem itemText="Save as" />
            <OverflowMenuItem itemText="Export JSON" />
            <OverflowMenuItem itemText="Import JSON" />
            <OverflowMenuItem itemText="Validate" />
            <OverflowMenuItem itemText="View history" />
            <OverflowMenuItem itemText="Retire" />
          </OverflowMenu>
        </div>
      </header>

      {/* Error notifications */}
      {error && (
        <div className={styles.notification}>
          <InlineNotification kind="error" title="Error" subtitle={error} />
        </div>
      )}
      {saveError && (
        <div className={styles.notification}>
          <InlineNotification kind="error" title="Save Error" subtitle={saveError} onClose={() => setSaveError(null)} />
        </div>
      )}
      {compileError && (
        <div className={styles.notification}>
          <InlineNotification kind="error" title="Compile Error" subtitle={compileError} onClose={() => setCompileError(null)} />
        </div>
      )}
      {compileSuccess && (
        <div className={styles.notification}>
          <InlineNotification kind="success" title="Compiled" subtitle={compileSuccess} onClose={() => setCompileSuccess(null)} />
        </div>
      )}

      {/* Compile Setup Modal */}
      <CompileSetupModal
        open={showCompileSetupModal}
        currentCategoryUuid={draft.categoryUuid}
        onConfirm={handleCompileSetupConfirm}
        onClose={handleCompileSetupCancel}
        reportType="linelist"
      />

      {/* Preview Parameter Modal */}
      <PreviewParameterModal
        open={previewParamModalOpen}
        onClose={() => setPreviewParamModalOpen(false)}
        onRun={handleRunPreviewWithParams}
        parameters={draft.parameters}
        loading={previewRunning}
      />

      {/* Three-Panel Layout */}
      <div className={styles.panels}>
        {/* Left Panel - Data Catalogue */}
        <aside
          className={styles.leftPanel}
          style={{
            width: leftPanelCollapsed ? 48 : leftPanelWidth,
          }}
        >
          <div className={styles.panelHeader}>
            {!leftPanelCollapsed && (
              <>
                <h3 className={styles.panelTitle}>Data Catalogue</h3>
                <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronLeft} iconDescription="Collapse left panel" onClick={() => setLeftPanelCollapsed(true)} />
              </>
            )}
            {leftPanelCollapsed && (
              <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronRight} iconDescription="Expand left panel" onClick={() => setLeftPanelCollapsed(false)} />
            )}
          </div>

          {!leftPanelCollapsed && (
            <div className={styles.panelContent}>
              {/* Column Sources Section */}
              <div className={styles.columnSourcesSection}>
                {/* Population Sources Section */}
                <div className={styles.populationCard}>
                  <PopulationSourceSelector
                    populationSources={draft.populationSources}
                    onChange={(sources) => updateDraft({ populationSources: sources })}
                    disabled={loading}
                  />
                </div>

                {/* Column Sources Section */}
                <div className={styles.columnSourcesCard}>
                  <div className={styles.columnSourcesHeader}>
                    <h4 className={styles.columnSourcesTitle}>
                      <span className={styles.columnSourcesIcon}>📊</span>
                      Column Sources
                    </h4>
                    <span className={styles.columnSourcesSubtitle}>
                      Select columns for output
                    </span>
                  </div>
                  <MultiDatasourceSelector
                    dataSources={draft.dataSources}
                    onChange={handleDataSourcesChange}
                    disabled={loading}
                  />
                  <DataCatalogue
                    dataSources={draft.dataSources}
                    populationSources={draft.populationSources}
                    onPopulationSourcesChange={undefined}
                    onAddToColumns={handleAddFieldAsColumn}
                    onAddToFilters={handleAddFieldAsFilter}
                    onTableChange={handleTableChange}
                    onFieldsAvailable={handleFieldsAvailable}
                    onEtlStructureDetected={handleEtlStructureDetected}
                    selectedFields={selectedFieldIds}
                    onAddCustomSqlColumn={handleAddCustomSqlColumn}
                    onAddDraftColumn={handleAddDraftColumn}
                    idColumnAlias="patient_id"
                    showPopulationSelector={false}
                  />
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Resize Handle - Left/Middle */}
        <div
          className={`${styles.resizeHandle} ${styles.resizeHandleLeftMiddle}`}
          onMouseDown={startResizeLeft}
          style={{ cursor: isResizingLeft ? 'col-resize' : 'col-resize' }}
        />

        {/* Middle Panel - Query Configuration */}
        <aside
          className={styles.middlePanel}
          style={{
            width: middlePanelCollapsed ? 48 : middlePanelWidth,
          }}
        >
          <div className={styles.panelHeader}>
            {!middlePanelCollapsed && (
              <>
                <h3 className={styles.panelTitle}>Query Configuration</h3>
                <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronLeft} iconDescription="Collapse middle panel" onClick={() => setMiddlePanelCollapsed(true)} />
              </>
            )}
            {middlePanelCollapsed && (
              <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronRight} iconDescription="Expand middle panel" onClick={() => setMiddlePanelCollapsed(false)} />
            )}
          </div>

          {!middlePanelCollapsed && (
            <div className={styles.panelContent}>
              <QueryConfigPanel
                draft={draft}
                onDraftChange={updateDraft}
                availableFields={availableFields}
                indicators={indicators}
                onRemoveColumn={handleRemoveColumn}
              />
            </div>
          )}
        </aside>

        {/* Resize Handle - Middle/Right */}
        <div
          className={`${styles.resizeHandle} ${styles.resizeHandleMiddleRight}`}
          onMouseDown={startResizeMiddle}
          style={{ cursor: isResizingMiddle ? 'col-resize' : 'col-resize' }}
        />

        {/* Right Panel - Preview */}
        <main className={styles.rightPanel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Preview</h3>
            <ButtonSet>
              <Button
                kind="primary"
                size="sm"
                onClick={handleRunPreview}
                disabled={
                  previewRunning ||
                  !initialReport?.compiledReportDefinitionUuid ||
                  !hasPrivilege(RB.SQL_EXECUTE)
                }
                tooltipAlignment="end"
                tooltipPosition="bottom"
              >
                {previewRunning ? 'Loading...' : 'Run Preview'}
              </Button>
            </ButtonSet>
          </div>

          <div className={styles.panelContent}>
            {!initialReport?.compiledReportDefinitionUuid && mode === 'edit' && (
              <InlineNotification
                kind="info"
                title="Report Not Compiled"
                subtitle="Please compile the report first before running preview. Click the 'Compile' button above to generate the report definition."
                lowContrast
              />
            )}

            {previewError && (
              <InlineNotification kind="error" title="Preview Error" subtitle={previewError} />
            )}

            {!previewData && !previewError && initialReport?.compiledReportDefinitionUuid && (
              <div className={styles.emptyPreview}>
                <Document size={32} />
                <p>Run a preview to see sample data</p>
              </div>
            )}

            {previewData && previewData.rowCount > 0 && (
              <div className={styles.previewResults}>
                <div className={styles.previewStatus}>
                  <span>Preview rows: {previewData.rowCount}</span>
                  <span>Query duration: —</span>
                </div>
                {previewData.html ? (
                  <div
                    className={styles.htmlPreview}
                    dangerouslySetInnerHTML={{ __html: previewData.html }}
                  />
                ) : (
                  <TableContainer>
                    <Table>
                      <TableHead>
                        <TableRow>
                          {previewData.columns.map((column) => (
                            <TableHeader key={column}>{column}</TableHeader>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewData.rows.map((row, index) => (
                          <TableRow key={index}>
                            {previewData.columns.map((column) => (
                              <TableCell key={`${index}-${column}`}>
                                {row[column]?.toString() ?? ''}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </div>
            )}

            {previewData && previewData.rowCount === 0 && (
              <div className={styles.emptyPreview}>
                <Document size={32} />
                <p>No data found for the current configuration</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default LinelistBuilderWorkspace;
