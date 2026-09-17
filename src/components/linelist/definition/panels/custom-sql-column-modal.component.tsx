/**
 * Custom SQL Column Modal
 *
 * Lets users add a custom column backed by a SQL expression.
 * The SQL runs per-row and can reference the patient/client ID via
 * the :patient_id or :patient_id bind parameter.
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  TextInput,
  TextArea,
  InlineNotification,
  Button,
  Toggle,
  CodeSnippet,
} from '@carbon/react';

export type CustomSqlColumnConfig = {
  name: string;
  description?: string;
  sql: string;
  repeatResolution?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (config: CustomSqlColumnConfig) => void;
  /** Existing column names, used to prevent duplicates */
  existingColumnNames?: string[];
  /** The patient/client ID column alias used by the base cohort SQL */
  idColumnAlias?: 'patient_id' | 'patient_id';
  /** Name of the current primary datasource (for display) */
  primaryDatasourceName?: string;
};

const EXAMPLES = [
  {
    label: 'Last visit date',
    sql: 'SELECT MAX(encounter_datetime) FROM encounter WHERE patient_id = :patient_id',
  },
  {
    label: 'Latest CD4 count',
    sql: "SELECT value_numeric FROM obs WHERE patient_id = :patient_id AND concept_id = 5497 ORDER BY obs_datetime DESC LIMIT 1",
  },
  {
    label: 'Current ART regimen',
    sql: "SELECT value_text FROM obs WHERE patient_id = :patient_id AND concept_id = 1085 ORDER BY obs_datetime DESC LIMIT 1",
  },
];

const CustomSqlColumnModal: React.FC<Props> = ({
  open,
  onClose,
  onSave,
  existingColumnNames = [],
  idColumnAlias = 'patient_id',
  primaryDatasourceName = '',
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sql, setSql] = useState('');
  const [useRepeatResolution, setUseRepeatResolution] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setSql('');
      setUseRepeatResolution(false);
      setError(null);
    }
  }, [open]);

  const handleSave = () => {
    // Validate name
    if (!name.trim()) {
      setError('Column name is required');
      return;
    }

    // Check for duplicate name
    if (existingColumnNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())) {
      setError('A column with this name already exists');
      return;
    }

    // Validate SQL
    if (!sql.trim()) {
      setError('SQL expression is required');
      return;
    }

    // Warn (but allow) if SQL doesn't reference the patient/client ID
    const paramPattern = /:(patient_id|patient_id|clientId|patientId)\b/i;
    if (!paramPattern.test(sql)) {
      setError(
        `SQL should reference :${idColumnAlias} to return a value per patient. ` +
          'Add it to your WHERE clause.'
      );
      return;
    }

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      sql: sql.trim(),
      repeatResolution: useRepeatResolution,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSave}
      modalHeading="Add Custom SQL Column"
      modalLabel="Custom Column"
      primaryButtonText="Add Column"
      secondaryButtonText="Cancel"
      size="lg"
      preventCloseOnClickOutside
    >
      <Stack gap={5}>
        <p>
          Write a SQL expression that returns a single value for each patient. Use{' '}
          <code>:{idColumnAlias}</code> as a bind parameter — it will be replaced with the
          patient/client ID for each row in the report.
        </p>

        {/* Datasource Info */}
        {primaryDatasourceName && (
          <InlineNotification
            kind="info"
            title="About Data Sources"
            subtitle={`This column will be associated with your primary datasource: "${primaryDatasourceName}". To use a different datasource, go to the Data Sources panel and set it as primary first.`}
            lowContrast
          />
        )}
        {!primaryDatasourceName && (
          <InlineNotification
            kind="warning"
            title="No Primary Data Source"
            subtitle="Custom SQL columns need a primary datasource. Please select a datasource in the Data Sources panel before adding custom columns."
            lowContrast
          />
        )}

        {error && (
          <InlineNotification
            kind="error"
            title="Validation Error"
            subtitle={error}
            hideCloseButton
          />
        )}

        <TextInput
          id="custom-column-name"
          labelText="Column Name *"
          placeholder="e.g., Last Visit Date"
          value={name}
          onChange={(e) => {
            setName((e.target as HTMLInputElement).value);
            setError(null);
          }}
        />

        <TextInput
          id="custom-column-description"
          labelText="Description (optional)"
          placeholder="What this column represents"
          value={description}
          onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
        />

        <TextArea
          id="custom-column-sql"
          labelText="SQL Expression *"
          placeholder={`SELECT ... FROM ... WHERE patient_id = :${idColumnAlias}`}
          value={sql}
          onChange={(e) => {
            setSql((e.target as HTMLTextAreaElement).value);
            setError(null);
          }}
          rows={6}
          helperText={`The :${idColumnAlias} parameter is replaced with each patient's ID. The query must return a single value.`}
        />

        <Toggle
          id="custom-column-repeat"
          labelText="May return multiple values (configure repeat resolution)"
          labelA="No"
          labelB="Yes"
          toggled={useRepeatResolution}
          onToggle={setUseRepeatResolution}
        />

        {useRepeatResolution && (
          <InlineNotification
            kind="info"
            title="Repeat Resolution"
            subtitle="The most recent value (LATEST strategy) will be used by default. You can adjust this later in the column settings."
            hideCloseButton
            lowContrast
          />
        )}

        {/* Examples */}
        <div>
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Examples (click to use):</p>
          <Stack gap={2}>
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.label}
                kind="ghost"
                size="sm"
                onClick={() => {
                  setSql(ex.sql);
                  if (!name) setName(ex.label);
                  setError(null);
                }}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {ex.label}
              </Button>
            ))}
          </Stack>
        </div>

        {sql && (
          <div>
            <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Your SQL:</p>
            <CodeSnippet type="multi">{sql}</CodeSnippet>
          </div>
        )}
      </Stack>
    </Modal>
  );
};

export default CustomSqlColumnModal;
