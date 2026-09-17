import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  InlineLoading,
  InlineNotification,
} from '@carbon/react';

import type { IndicatorDto } from '../../resources/indicator/indicators.api';

import type {
  CustomIndicatorConfig,
  PatientIdColumn,
  PopulationExtractionMethod,
  RedisaggregationStrategy,
  FilterPreservationRule,
} from './types/custom-indicator.types';

import { customIndicatorInterpreter } from './utils/custom-indicator-interpreter';

import CustomIndicatorBasicsSection from './sections/custom-indicator-basics.section';
import CustomIndicatorPopulationSection from './sections/custom-indicator-population.section';
import CustomIndicatorDisaggregationSection from './sections/custom-indicator-disaggregation.section';
import CustomIndicatorFiltersSection from './sections/custom-indicator-filters.section';
import CustomIndicatorSqlPreviewSection from './sections/custom-indicator-sql-preview.section';

type Props = {
  open: boolean;
  mode?: 'create' | 'edit' | 'duplicate';
  initial?: IndicatorDto | null;

  onClose: () => void;

  onCreate: (payload: Partial<IndicatorDto>) => Promise<void>;
  onUpdate?: (uuid: string, payload: Partial<IndicatorDto>) => Promise<void>;
  onSaved: () => void;
};

function safeParseJson<T = any>(input?: string | null): T | null {
  if (!input) return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

const toCode = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

export default function CreateCustomIndicatorModal({
  open,
  mode = 'create',
  initial,
  onClose,
  onCreate,
  onUpdate,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validation state
  const [sqlValidation, setSqlValidation] = useState<{
    valid: boolean;
    canDisaggregate: boolean;
    warnings: string[];
    errors: string[];
    extractedPopulationSql?: string;
  }>({ valid: false, canDisaggregate: false, warnings: [], errors: [] });

  // Config preview state
  const [showConfigPreview, setShowConfigPreview] = useState(false);

  // Basic fields
  const [basics, setBasics] = useState({ name: '', code: '', description: '' });
  const [sqlTemplate, setSqlTemplate] = useState('');

  // Population configuration
  const [patientIdColumn, setPatientIdColumn] = useState<PatientIdColumn>('patient_id');
  const [extractionMethod, setExtractionMethod] = useState<PopulationExtractionMethod>('sqlTemplate');
  const [configPath, setConfigPath] = useState('');
  const [customExtractor, setCustomExtractor] = useState('');

  // Re-disaggregation
  const [supportsRedisaggregation, setSupportsRedisaggregation] = useState(true);
  const [redisaggregationStrategy, setRedisaggregationStrategy] = useState<RedisaggregationStrategy>('population-extraction');

  // Filter preservation
  const [preserveFilters, setPreserveFilters] = useState<FilterPreservationRule[]>([]);

  // Business logic
  const [businessLogic, setBusinessLogic] = useState('');

  // Data sources
  const [dataSources, setDataSources] = useState<string[]>([]);
  const [dataSourceInput, setDataSourceInput] = useState('');

  // Theme independence
  const [themeIndependent, setThemeIndependent] = useState(true);

  // Initialize from existing indicator (edit mode or duplicate mode)
  useEffect(() => {
    if (!open) return;

    if ((mode === 'edit' || mode === 'duplicate') && initial) {
      const config = safeParseJson<CustomIndicatorConfig>(initial.configJson);

      setBasics({
        name: initial.name ?? '',
        code: initial.code ?? '',
        description: initial.description ?? '',
      });

      // Try to get sqlTemplate from initial, or from configJson (for newer indicators)
      const sqlFromConfig = config?.sqlTemplate;
      setSqlTemplate(initial.sqlTemplate ?? sqlFromConfig ?? '');

      if (config) {
        setPatientIdColumn(config.patientIdColumn ?? 'patient_id');
        setExtractionMethod(config.populationQuery?.extractFrom ?? 'sqlTemplate');
        setConfigPath(config.populationQuery?.configPath ?? '');
        setCustomExtractor(config.populationQuery?.customExtractor ?? '');
        setSupportsRedisaggregation(config.supportsRedisaggregation ?? true);
        setRedisaggregationStrategy(config.redisaggregationStrategy ?? 'population-extraction');
        setPreserveFilters(config.preserveFilters ?? []);
        setBusinessLogic(config.businessLogic ?? '');
        setDataSources(config.dataSources ?? []);
        setThemeIndependent(config.themeIndependent ?? true);
        // sqlPreview is only used for display/reference, not editing
      }
    } else {
      // Reset for create mode
      setBasics({ name: '', code: '', description: '' });
      setSqlTemplate('');
      setPatientIdColumn('patient_id');
      setExtractionMethod('sqlTemplate');
      setConfigPath('');
      setCustomExtractor('');
      setSupportsRedisaggregation(true);
      setRedisaggregationStrategy('population-extraction');
      setPreserveFilters([]);
      setBusinessLogic('');
      setDataSources([]);
      setThemeIndependent(true);
      setError(null);
    }
  }, [open, mode, initial]);

  // Validate SQL template for section disaggregation compatibility
  useEffect(() => {
    if (!sqlTemplate.trim()) {
      setSqlValidation({ valid: false, canDisaggregate: false, warnings: [], errors: [] });
      return;
    }

    try {
      // Create a temporary config for validation
      const tempConfig: CustomIndicatorConfig = {
        version: 1,
        patientIdColumn,
        populationQuery: { extractFrom: extractionMethod },
        supportsRedisaggregation,
        redisaggregationStrategy,
        themeIndependent,
        dataSources,
      };

      // Analyze the SQL
      const analysis = customIndicatorInterpreter.analyze(sqlTemplate, tempConfig);

      // Try to extract population SQL
      const extractionResult = customIndicatorInterpreter.extractPopulationSql(sqlTemplate, tempConfig);

      // Build validation result
      const warnings: string[] = [];
      const errors: string[] = [];
      let canDisaggregate = false;

      // Check if population SQL was extracted
      if (extractionResult.success && extractionResult.sql) {
        canDisaggregate = true;
        warnings.push(...(extractionResult.warnings || []));

        // Check for potential issues
        if (!analysis.redisaggregatable) {
          warnings.push('SQL structure may not support optimal re-disaggregation');
        }

        // Check if patient ID column is detected
        if (!extractionResult.patientIdColumn && !tempConfig.patientIdColumn) {
          warnings.push('Patient ID column could not be auto-detected');
        }
      } else {
        // Extraction failed
        errors.push(...(extractionResult.warnings || ['Could not extract population SQL']));
        if (!analysis.hasPopulationQuery) {
          errors.push('SQL does not contain a recognizable population query structure');
          errors.push('Expected: SELECT COUNT(DISTINCT patient_id) FROM (...) alias');
        }
      }

      setSqlValidation({
        valid: errors.length === 0,
        canDisaggregate,
        warnings,
        errors,
        extractedPopulationSql: extractionResult.sql,
      });
    } catch (e) {
      setSqlValidation({
        valid: false,
        canDisaggregate: false,
        warnings: [],
        errors: ['Validation error: ' + (e instanceof Error ? e.message : String(e))],
      });
    }
  }, [sqlTemplate, patientIdColumn, extractionMethod, supportsRedisaggregation, redisaggregationStrategy, themeIndependent, dataSources]);

  const canSubmit =
    Boolean(basics.name.trim()) &&
    Boolean(sqlTemplate.trim()) &&
    Boolean(patientIdColumn) &&
    sqlValidation.errors.length === 0;

  const addDataSource = () => {
    const trimmed = dataSourceInput.trim();
    if (trimmed && !dataSources.includes(trimmed)) {
      setDataSources([...dataSources, trimmed]);
      setDataSourceInput('');
    }
  };

  const removeDataSource = (source: string) => {
    setDataSources(dataSources.filter((s) => s !== source));
  };

  const submit = async () => {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      const finalCode = basics.code.trim() || toCode(basics.name);

      // Extract population SQL for the sqlPreview field
      let sqlPreview: string | undefined;
      if (sqlTemplate.trim()) {
        try {
          const extractionResult = customIndicatorInterpreter.extractPopulationSql(
            sqlTemplate.trim(),
            {
              version: 1,
              patientIdColumn,
              populationQuery: { extractFrom: extractionMethod },
              supportsRedisaggregation,
              redisaggregationStrategy,
              themeIndependent,
              dataSources,
            }
          );

          if (extractionResult.success && extractionResult.sql) {
            sqlPreview = extractionResult.sql;
          } else {
            // If extraction failed, use the original SQL as preview
            sqlPreview = sqlTemplate.trim();
            console.warn('[CustomIndicator] Could not extract population SQL, using original SQL:', extractionResult.warnings);
          }
        } catch (e) {
          // If interpreter fails, use the original SQL as preview
          sqlPreview = sqlTemplate.trim();
          console.error('[CustomIndicator] Population SQL extraction failed:', e);
        }
      }

      const config: CustomIndicatorConfig = {
        version: 1,
        patientIdColumn,
        populationQuery: {
          extractFrom: extractionMethod,
          ...(extractionMethod === 'configJson' && configPath ? { configPath } : {}),
          ...(extractionMethod === 'custom' && customExtractor ? { customExtractor } : {}),
        },
        preserveFilters: preserveFilters.length > 0 ? preserveFilters : undefined,
        supportsRedisaggregation,
        redisaggregationStrategy,
        themeIndependent,
        ...(businessLogic ? { businessLogic } : {}),
        ...(dataSources.length > 0 ? { dataSources } : {}),
        // Include both sqlTemplate (full) and sqlPreview (population) in config
        sqlTemplate: sqlTemplate.trim(),
        ...(sqlPreview ? { sqlPreview } : {}),
      };

      const payload: Partial<IndicatorDto> = {
        name: basics.name.trim(),
        code: finalCode,
        description: basics.description.trim() || undefined,
        kind: 'CUSTOM',
        defaultValueType: 'NUMBER',
        themeUuid: null,
        configJson: JSON.stringify(config, null, 2),
        sqlTemplate: sqlTemplate.trim(),
      };

      console.log('📦 [CustomIndicator] Saving indicator with config:', {
        configKeys: Object.keys(config),
        hasSqlTemplate: !!config.sqlTemplate,
        hasSqlPreview: !!config.sqlPreview,
        sqlTemplateLength: config.sqlTemplate?.length || 0,
        sqlPreviewLength: config.sqlPreview?.length || 0,
        fullConfig: config,
      });

      if (mode === 'edit' && initial?.uuid) {
        if (!onUpdate) throw new Error('onUpdate handler is required for edit mode');
        await onUpdate(initial.uuid, payload);
      } else {
        await onCreate(payload);
      }

      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save custom indicator');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading={mode === 'edit' ? 'Edit Custom Indicator' : mode === 'duplicate' ? 'Duplicate Custom Indicator' : 'Create Custom Indicator'}
      primaryButtonText={mode === 'edit' ? 'Update Indicator' : mode === 'duplicate' ? 'Create Duplicate' : 'Save Indicator'}
      secondaryButtonText="Cancel"
      onRequestSubmit={submit}
      primaryButtonDisabled={!canSubmit || loading}
      size="lg"
    >
      <Stack gap={6}>
        {loading && <InlineLoading description="Saving indicator…" status="active" />}
        {error && <InlineNotification kind="error" lowContrast title="Error" subtitle={error} />}

        <CustomIndicatorBasicsSection
          value={basics}
          sqlTemplate={sqlTemplate}
          onChange={setBasics}
          onSqlChange={setSqlTemplate}
        />

        {/* SQL Validation Status */}
        {sqlTemplate && (
          <div>
            {sqlValidation.errors.length > 0 && (
              <>
                <InlineNotification
                  kind="error"
                  lowContrast
                  title="SQL Validation Failed"
                  subtitle="This SQL may not work with section-level disaggregation. See details below:"
                  hideCloseButton
                />
                <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'var(--cds-field-01, #f4f4f4)', borderRadius: '4px' }}>
                  <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Errors:</div>
                  <ul style={{ paddingLeft: '1.5rem', margin: 0 }}>
                    {sqlValidation.errors.map((error, i) => (
                      <li key={i} style={{ marginBottom: '0.25rem' }}>
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {sqlValidation.errors.length === 0 && sqlValidation.warnings.length > 0 && (
              <>
                <InlineNotification
                  kind="warning"
                  lowContrast
                  title="SQL Validation Warnings"
                  subtitle="See warnings below:"
                  hideCloseButton
                />
                <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'var(--cds-field-01, #f4f4f4)', borderRadius: '4px' }}>
                  <ul style={{ paddingLeft: '1.5rem', margin: 0 }}>
                    {sqlValidation.warnings.map((warning, i) => (
                      <li key={i} style={{ marginBottom: '0.25rem' }}>
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {sqlValidation.errors.length === 0 && sqlValidation.warnings.length === 0 && sqlValidation.canDisaggregate && (
              <InlineNotification
                kind="success"
                lowContrast
                title="SQL Validation Passed"
                subtitle="This SQL is compatible with section-level disaggregation. The population SQL has been successfully extracted."
                hideCloseButton
              />
            )}

            {sqlValidation.extractedPopulationSql && (
              <details style={{ marginTop: '0.5rem' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
                  View extracted population SQL (for reference)
                </summary>
                <pre
                  style={{
                    background: 'var(--cds-field-01, #f4f4f4)',
                    padding: '1rem',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '200px',
                    fontSize: '0.75rem',
                    marginTop: '0.5rem',
                  }}
                >
                  {sqlValidation.extractedPopulationSql}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Config Preview */}
        {sqlTemplate && (
          <div style={{ marginTop: '0.5rem' }}>
            <details
              open={showConfigPreview}
              onToggle={(e) => setShowConfigPreview((e.target as HTMLDetailsElement).open)}
              style={{ border: '1px solid var(--cds-border-subtle, #e0e0e0)', borderRadius: '4px', padding: '0.5rem' }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  padding: '0.5rem',
                  userSelect: 'none',
                }}
              >
                {showConfigPreview ? '▼' : '▶'} Config JSON Preview
                <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--cds-text-secondary, #666)', marginLeft: '0.5rem' }}>
                  (How the config will be saved)
                </span>
              </summary>
              <div style={{ padding: '1rem', paddingTop: '0.5rem' }}>
                <pre
                  style={{
                    background: 'var(--cds-field-01, #f4f4f4)',
                    padding: '1rem',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '400px',
                    fontSize: '0.75rem',
                    margin: 0,
                  }}
                >
                  {JSON.stringify(
                    {
                      version: 1,
                      patientIdColumn,
                      populationQuery: {
                        extractFrom: extractionMethod,
                        ...(extractionMethod === 'configJson' && configPath ? { configPath } : {}),
                        ...(extractionMethod === 'custom' && customExtractor ? { customExtractor } : {}),
                      },
                      preserveFilters: preserveFilters.length > 0 ? preserveFilters : undefined,
                      supportsRedisaggregation,
                      redisaggregationStrategy,
                      themeIndependent,
                      ...(businessLogic ? { businessLogic } : {}),
                      ...(dataSources.length > 0 ? { dataSources } : {}),
                      sqlTemplate: sqlTemplate.trim(),
                      ...(sqlValidation.extractedPopulationSql ? { sqlPreview: sqlValidation.extractedPopulationSql } : {}),
                    },
                    null,
                    2
                  )}
                </pre>
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--cds-text-secondary, #666)' }}>
                  This is the config JSON that will be saved to the database. It includes both the full SQL template
                  and the extracted population SQL for section-level disaggregation.
                </div>
              </div>
            </details>
          </div>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--cds-border-subtle, #e0e0e0)' }} />

        <CustomIndicatorPopulationSection
          patientIdColumn={patientIdColumn}
          extractionMethod={extractionMethod}
          configPath={configPath}
          customExtractor={customExtractor}
          onChangePatientIdColumn={setPatientIdColumn}
          onChangeExtractionMethod={setExtractionMethod}
          onChangeConfigPath={setConfigPath}
          onChangeCustomExtractor={setCustomExtractor}
        />

        <hr style={{ border: 0, borderTop: '1px solid var(--cds-border-subtle, #e0e0e0)' }} />

        <CustomIndicatorDisaggregationSection
          supportsRedisaggregation={supportsRedisaggregation}
          redisaggregationStrategy={redisaggregationStrategy}
          themeIndependent={themeIndependent}
          onChangeSupportsRedisaggregation={setSupportsRedisaggregation}
          onChangeRedisaggregationStrategy={setRedisaggregationStrategy}
          onChangeThemeIndependent={setThemeIndependent}
        />

        <hr style={{ border: 0, borderTop: '1px solid var(--cds-border-subtle, #e0e0e0)' }} />

        <CustomIndicatorFiltersSection
          preserveFilters={preserveFilters}
          onChange={setPreserveFilters}
        />

        <hr style={{ border: 0, borderTop: '1px solid var(--cds-border-subtle, #e0e0e0)' }} />

        <CustomIndicatorSqlPreviewSection
          sql={sqlTemplate}
          businessLogic={businessLogic}
          dataSources={dataSources}
          dataSourceInput={dataSourceInput}
          onChangeBusinessLogic={setBusinessLogic}
          onDataSourceInputChange={setDataSourceInput}
          onAddDataSource={addDataSource}
          onRemoveDataSource={removeDataSource}
        />
      </Stack>
    </Modal>
  );
}
