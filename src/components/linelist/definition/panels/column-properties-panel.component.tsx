/**
 * Edit Column Modal for Linelist Reports
 *
 * Allows users to edit column properties including:
 * - Display name
 * - Width and alignment
 * - Sortable and filterable settings
 * - Format type
 * - Repeat resolution (for potentially repeated columns)
 */

import React, { useState, useEffect } from 'react';
import {
  Modal,
  ModalBody,
  TextInput,
  TextArea,
  NumberInput,
  Select,
  SelectItem,
  Toggle,
  Stack,
  Tag,
} from '@carbon/react';
import type { LinelistColumnDraft, FilterMap } from '../../../../types/linelist-types';

// Scoped styles for the SQL editor
const editModalStyles = `
.sql-editor {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}
.sql-editor textarea {
  tab-size: 2;
}
`;

type Props = {
  /** Whether the modal is open */
  open: boolean;
  /** The column to edit */
  column: LinelistColumnDraft | null;
  /** Callback when user saves changes */
  onSave: (column: LinelistColumnDraft) => void;
  /** Callback when user cancels */
  onClose: () => void;
  /** Available filterMap parameters from base cohort */
  filterMap?: FilterMap;
};

const RESOLUTION_STRATEGIES = [
  { value: 'LATEST', label: 'Latest', description: 'Use the most recent value' },
  { value: 'EARLIEST', label: 'Earliest', description: 'Use the earliest value' },
  { value: 'FIRST_WITHIN_PERIOD', label: 'First within period', description: 'Use the first value within reporting period' },
  { value: 'LAST_WITHIN_PERIOD', label: 'Last within period', description: 'Use the last value within reporting period' },
  { value: 'ALL_VALUES', label: 'All values', description: 'Show all values (may change row grain)' },
] as const;

const ALIGNMENT_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

const FORMAT_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'currency', label: 'Currency' },
];

const ORDER_FIELDS = ['encounter_date', 'encounter_datetime', 'date_created', 'date_modified'];

const EditColumnModal: React.FC<Props> = ({ open, column, onSave, onClose, filterMap }) => {
  const [editedColumn, setEditedColumn] = useState<LinelistColumnDraft | null>(null);

  // Reset form when column changes or modal opens
  useEffect(() => {
    if (column) {
      setEditedColumn({ ...column });
    }
  }, [column, open]);

  if (!editedColumn) return null;

  const isPotentiallyRepeated = editedColumn.dataDefinitionType === 'SQL' &&
    /appointment|observation|encounter|program_enrollment|visit/i.test(editedColumn.dataDefinitionConfig?.sql || '');

  const handleChange = (field: keyof LinelistColumnDraft, value: any) => {
    setEditedColumn(prev => prev ? { ...prev, [field]: value } : null);
  };

  const handleDisplayChange = (field: string, value: any) => {
    setEditedColumn(prev => prev ? {
      ...prev,
      display: { ...prev.display, [field]: value }
    } : null);
  };

  const handleRepeatResolutionChange = (field: string, value: any) => {
    setEditedColumn(prev => prev ? {
      ...prev,
      repeatResolution: { ...prev.repeatResolution, [field]: value }
    } : null);
  };

  const handleDataDefinitionConfigChange = (field: string, value: any) => {
    setEditedColumn(prev => prev ? {
      ...prev,
      dataDefinitionConfig: { ...prev.dataDefinitionConfig, [field]: value }
    } : null);
  };

  const handleSave = () => {
    if (editedColumn) {
      onSave(editedColumn);
    }
  };

  return (
    <>
      <style>{editModalStyles}</style>
      <Modal
      open={open}
      onRequestClose={onClose}
      size="md"
      modalHeading="Edit Column"
      modalLabel="Column Configuration"
      primaryButtonText="Save Changes"
      onRequestSubmit={handleSave}
      secondaryButtonText="Cancel"
    >
      <ModalBody>
        <Stack gap={6}>
          {/* Basic Information */}
          <div>
            <h4 className="cds--label">Basic Information</h4>
            <Stack gap={4}>
              <TextInput
                id="column-name"
                labelText="Display Name"
                value={editedColumn.name}
                onChange={(e) => handleChange('name', (e.target as HTMLInputElement).value)}
                placeholder="Enter display name"
              />
              <TextInput
                id="column-description"
                labelText="Description"
                value={editedColumn.description || ''}
                onChange={(e) => handleChange('description', (e.target as HTMLInputElement).value)}
                placeholder="Enter description (optional)"
              />
            </Stack>
          </div>

          {/* Display Settings */}
          <div>
            <h4 className="cds--label">Display Settings</h4>
            <Stack gap={4}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <NumberInput
                  id="column-width"
                  label="Width (px)"
                  value={editedColumn.display?.width || 150}
                  onChange={(e) => {
                    const target = e.target as HTMLInputElement;
                    handleDisplayChange('width', target.value ? Number(target.value) : 150);
                  }}
                  min={50}
                  max={500}
                  step={10}
                />
                <Select
                  id="column-align"
                  labelText="Alignment"
                  value={editedColumn.display?.align || 'left'}
                  onChange={(e) => handleDisplayChange('align', (e.target as HTMLSelectElement).value)}
                >
                  {ALIGNMENT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} text={opt.label} />
                  ))}
                </Select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <Select
                  id="column-format"
                  labelText="Format"
                  value={editedColumn.display?.format || 'text'}
                  onChange={(e) => handleDisplayChange('format', (e.target as HTMLSelectElement).value)}
                >
                  {FORMAT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} text={opt.label} />
                  ))}
                </Select>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem' }}>
                  <Toggle
                    id="column-sortable"
                    labelText="Sortable"
                    toggled={editedColumn.display?.sortable || false}
                    onToggle={(value) => handleDisplayChange('sortable', value)}
                  />
                  <Toggle
                    id="column-filterable"
                    labelText="Filterable"
                    toggled={editedColumn.display?.filterable || false}
                    onToggle={(value) => handleDisplayChange('filterable', value)}
                  />
                </div>
              </div>
            </Stack>
          </div>

          {/* Repeat Resolution */}
          {isPotentiallyRepeated && (
            <div style={{ background: 'var(--cds-layer-01, #f4f4f4)', padding: '1rem', borderRadius: '8px' }}>
              <h4 className="cds--label">Repeat Resolution</h4>
              <p style={{ fontSize: '0.875rem', marginBottom: '1rem', opacity: 0.9 }}>
                This column may return multiple values per row. Configure how to handle them.
              </p>
              <Stack gap={4}>
                <Select
                  id="resolution-strategy"
                  labelText="Resolution Strategy"
                  value={editedColumn.repeatResolution?.strategy || 'LATEST'}
                  onChange={(e) => handleRepeatResolutionChange('strategy', (e.target as HTMLSelectElement).value)}
                >
                  {RESOLUTION_STRATEGIES.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} text={`${opt.label} - ${opt.description}`} />
                  ))}
                </Select>

                {(editedColumn.repeatResolution?.strategy === 'LATEST' ||
                  editedColumn.repeatResolution?.strategy === 'EARLIEST' ||
                  editedColumn.repeatResolution?.strategy === 'FIRST_WITHIN_PERIOD' ||
                  editedColumn.repeatResolution?.strategy === 'LAST_WITHIN_PERIOD') && (
                  <>
                    <Select
                      id="resolution-orderby"
                      labelText="Order By Field"
                      value={editedColumn.repeatResolution?.orderBy || 'encounter_date'}
                      onChange={(e) => handleRepeatResolutionChange('orderBy', (e.target as HTMLSelectElement).value)}
                    >
                      {ORDER_FIELDS.map(field => (
                        <SelectItem key={field} value={field} text={field} />
                      ))}
                    </Select>
                    <Toggle
                      id="resolution-ignore-voided"
                      labelText="Ignore voided records"
                      toggled={editedColumn.repeatResolution?.ignoreVoided !== false}
                      onToggle={(value) => handleRepeatResolutionChange('ignoreVoided', value)}
                    />
                    <Toggle
                      id="resolution-restrict-period"
                      labelText="Restrict to time period"
                      toggled={editedColumn.repeatResolution?.restrictToPeriod || false}
                      onToggle={(value) => handleRepeatResolutionChange('restrictToPeriod', value)}
                    />
                  </>
                )}
              </Stack>
            </div>
          )}

          {/* SQL Definition */}
          {editedColumn.dataDefinitionType === 'SQL' && (
            <div style={{ background: 'var(--cds-layer-01, #f4f4f4)', padding: '1rem', borderRadius: '8px' }}>
              <h4 className="cds--label">SQL Definition</h4>
              <p style={{ fontSize: '0.875rem', marginBottom: '1rem', opacity: 0.9 }}>
                Edit the SQL query for this column. Use <code>:patientId</code> to reference the current patient.
              </p>
              <TextArea
                id="column-sql"
                className="sql-editor"
                placeholder="SELECT field_name FROM table_name WHERE patient_id = :patientId..."
                value={editedColumn.dataDefinitionConfig?.sql || ''}
                onChange={(e: any) => handleDataDefinitionConfigChange('sql', e.target.value)}
                rows={6}
                labelText=""
              />
              <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', opacity: 0.7 }}>
                <small>Available parameters: </small>
                <Tag size="sm" type="blue"><code>:patientId</code></Tag>
                <Tag size="sm" type="blue"><code>:startDate</code></Tag>
                <Tag size="sm" type="blue"><code>:endDate</code></Tag>
                {filterMap && Object.keys(filterMap).length > 0 && (
                  <>
                    <small style={{ marginLeft: '0.5rem' }}>| FilterMap parameters:</small>
                    {Object.entries(filterMap).map(([paramName, colRef]) => (
                      <Tag key={paramName} size="sm" type="green">
                        <code>:{paramName}</code>
                        <span style={{ opacity: 0.7, fontSize: '0.75em' }}> → {colRef}</span>
                      </Tag>
                    ))}
                  </>
                )}
              </div>
              {filterMap && Object.keys(filterMap).length > 0 && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', opacity: 0.6 }}>
                  <small>💡 FilterMap parameters allow you to reference specific columns from the base cohort row (e.g., <code>:{Object.keys(filterMap)[0]}</code> for the exact row that matched)</small>
                </div>
              )}
            </div>
          )}

          {/* Column Type Info */}
          <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
            <p><strong>Type:</strong> {editedColumn.dataDefinitionType}</p>
            {editedColumn.source?.dataSourceName && (
              <p><strong>Source:</strong> {editedColumn.source.dataSourceName}</p>
            )}
            {editedColumn.source?.table && (
              <p><strong>Table:</strong> {editedColumn.source.table}</p>
            )}
          </div>
        </Stack>
      </ModalBody>
    </Modal>
    </>
  );
};

export default EditColumnModal;
