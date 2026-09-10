/**
 * Preview Parameter Modal
 *
 * Allows users to set parameter values before running a linelist preview.
 * Supports various parameter types including:
 * - Date parameters with FIXED/RELATIVE mode toggle (global for all dates)
 * - Text and number inputs
 * - Boolean toggles
 * - Configurable lists (dropdowns)
 * - OpenMRS reference types (Location, Concept, Identifier Type, Person Attribute)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  ModalBody,
  InlineNotification,
  Stack,
  Select,
  SelectItem,
  RadioButton,
  RadioButtonGroup,
} from '@carbon/react';

import type { LinelistParameter } from '../../../types/linelist-types';
import {
  RELATIVE_PERIOD_OPTIONS,
  type RelativePeriod,
  resolveRelativePeriod,
  formatDate,
} from '../../../utils/parameter-resolution';

// Import parameter input components from data-visualizer (reuse)
import DateParameterInput from '../../data-visualizer/parameter-inputs/date-parameter-input.component';
import NumberParameterInput from '../../data-visualizer/parameter-inputs/number-parameter-input.component';
import BooleanParameterInput from '../../data-visualizer/parameter-inputs/boolean-parameter-input.component';
import ListParameterInput from '../../data-visualizer/parameter-inputs/list-parameter-input.component';
import LocationParameterInput from '../../data-visualizer/parameter-inputs/location-parameter-input.component';
import ConceptParameterInput from '../../data-visualizer/parameter-inputs/concept-parameter-input.component';
import IdentifierTypeParameterInput from '../../data-visualizer/parameter-inputs/identifier-type-parameter-input.component';
import PersonAttributeParameterInput from '../../data-visualizer/parameter-inputs/person-attribute-parameter-input.component';
import TextParameterInput from '../../data-visualizer/parameter-inputs/text-parameter-input.component';

type Props = {
  open: boolean;
  onClose: () => void;
  onRun: (parameterValues: Record<string, any>) => void;
  parameters: LinelistParameter[];
  initialValues?: Record<string, any>;
  loading?: boolean;
};

type DateMode = 'FIXED' | 'RELATIVE';

const PreviewParameterModal: React.FC<Props> = ({
  open,
  onClose,
  onRun,
  parameters = [],
  initialValues = {},
  loading = false,
}) => {
  // State for parameter values
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // State for search queries (for searchable reference types)
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});

  // State for date mode (FIXED or RELATIVE)
  const [dateMode, setDateMode] = useState<DateMode>('FIXED');

  // State for relative period selection
  const [relativePeriod, setRelativePeriod] = useState<RelativePeriod | ''>('');

  // Check if there are any date parameters
  const hasDateParameters = parameters.some(p => p.type === 'DATE' || p.type === 'DATETIME');

  // Get date parameter names
  const dateParameters = parameters.filter(p => p.type === 'DATE' || p.type === 'DATETIME');

  // Check if report has both startDate and endDate for relative period support
  const hasStartAndEndDateParams =
    dateParameters.some(p => p.name.toLowerCase() === 'startdate' || p.name.toLowerCase() === 'start_date') &&
    dateParameters.some(p => p.name.toLowerCase() === 'enddate' || p.name.toLowerCase() === 'end_date');

  // Only show FIXED/RELATIVE toggle if both start and end date params exist
  const supportsRelativePeriod = hasStartAndEndDateParams;

  // Initialize values from defaults or previously set values - only when modal opens
  useEffect(() => {
    if (!open) return;

    const initialValuesFromParams: Record<string, any> = {};

    for (const param of parameters) {
      // Use explicit value if provided, otherwise use default
      const paramValue = initialValues[param.name] || param.defaultValue || '';
      initialValuesFromParams[param.name] = paramValue;
    }

    setValues(initialValuesFromParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]); // Only run when modal opens, not when parameters/initialValues change

  // Reset errors and other state when modal opens
  useEffect(() => {
    if (open) {
      setErrors({});
      setSearchQueries({});
      setRelativePeriod('');
      setDateMode('FIXED');
    }
  }, [open]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    for (const param of parameters) {
      const value = values[param.name];

      // Skip validation for parameters not shown in RELATIVE mode
      if ((param.type === 'DATE' || param.type === 'DATETIME') && dateMode === 'RELATIVE') {
        continue;
      }

      // Check required parameters
      if (param.required && (!value || value.toString().trim() === '')) {
        newErrors[param.name] = `${param.label} is required`;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRun = () => {
    // Clear previous errors
    setErrors({});

    // If in RELATIVE mode but no period selected, show error
    if (dateMode === 'RELATIVE' && hasDateParameters && !relativePeriod) {
      setErrors({ relativePeriod: 'Please select a reporting period' });
      return;
    }

    // If in RELATIVE mode with period selected, resolve and run
    if (dateMode === 'RELATIVE' && relativePeriod) {
      const resolvedValues = { ...values };
      const { start, end } = resolveRelativePeriod(relativePeriod);

      // Map resolved dates to date parameters
      dateParameters.forEach((param, index) => {
        if (index === 0) {
          resolvedValues[param.name] = formatDate(start);
        } else if (index === 1) {
          resolvedValues[param.name] = formatDate(end);
        }
      });

      onRun(resolvedValues);
      return;
    }

    // For FIXED mode, validate before running
    if (!validate()) {
      return;
    }

    onRun(values);
  };

  const handleValueChange = useCallback((paramName: string, value: any) => {
    setValues((prev) => ({ ...prev, [paramName]: value }));
    // Clear error for this parameter
    if (errors[paramName]) {
      setErrors((prev) => ({ ...prev, [paramName]: '' }));
    }
  }, [errors]);

  const handleErrorChange = useCallback((paramName: string, error: string | undefined) => {
    setErrors((prev) => {
      if (error) {
        return { ...prev, [paramName]: error };
      }
      const newErrors = { ...prev };
      delete newErrors[paramName];
      return newErrors;
    });
  }, []);

  const handleSearchQueryChange = useCallback((paramName: string, query: string) => {
    setSearchQueries((prev) => ({ ...prev, [paramName]: query }));
  }, []);

  // Render a single parameter input using the appropriate component
  const renderParameterInput = (param: LinelistParameter) => {
    const value = values[param.name] || '';
    const error = errors[param.name];

    // Skip start/end date parameters in RELATIVE mode - they're handled by the global relative period selector
    if (supportsRelativePeriod && dateMode === 'RELATIVE') {
      const isStartDate = param.name.toLowerCase() === 'startdate' || param.name.toLowerCase() === 'start_date';
      const isEndDate = param.name.toLowerCase() === 'enddate' || param.name.toLowerCase() === 'end_date';
      if ((param.type === 'DATE' || param.type === 'DATETIME') && (isStartDate || isEndDate)) {
        return null;
      }
    }

    const commonProps = {
      parameter: param,
      value,
      error,
      onChange: (newValue: any) => handleValueChange(param.name, newValue),
    };

    switch (param.type) {
      case 'DATE':
      case 'DATETIME':
        return <DateParameterInput key={param.name} {...commonProps} />;

      case 'NUMBER':
        return <NumberParameterInput key={param.name} {...commonProps} />;

      case 'BOOLEAN':
        return <BooleanParameterInput key={param.name} {...commonProps} />;

      case 'LIST':
        return <ListParameterInput key={param.name} {...commonProps} />;

      case 'LOCATION':
        return (
          <LocationParameterInput
            key={param.name}
            {...commonProps}
            onSearchQueryChange={(query) => handleSearchQueryChange(param.name, query)}
          />
        );

      case 'CONCEPT':
        return (
          <ConceptParameterInput
            key={param.name}
            {...commonProps}
            searchQuery={searchQueries[param.name] || ''}
            onSearchQueryChange={(query) => handleSearchQueryChange(param.name, query)}
          />
        );

      case 'IDENTIFIER_TYPE':
        return <IdentifierTypeParameterInput key={param.name} {...commonProps} />;

      case 'PERSON_ATTRIBUTE':
        return <PersonAttributeParameterInput key={param.name} {...commonProps} />;

      case 'TEXT':
      default:
        return (
          <TextParameterInput
            key={param.name}
            {...commonProps}
            onError={(error) => handleErrorChange(param.name, error)}
          />
        );
    }
  };

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading="Preview Parameters"
      modalLabel="Linelist Preview"
      preventCloseOnClickOutside
      size="sm"
      primaryButtonText="Run Preview"
      primaryButtonDisabled={loading}
      onRequestSubmit={handleRun}
      secondaryButtonText="Cancel"
      loadingStatus={loading ? 'active' : 'inactive'}
      loadingDescription="Running..."
    >
      <ModalBody>
        {parameters.length === 0 ? (
          <InlineNotification
            kind="info"
            title="No Parameters"
            subtitle="This report has no parameters defined. Click Run to use default values."
            lowContrast
          />
        ) : (
          <Stack gap={5}>
            {/* Date Mode Toggle - shown ONLY if report has both startDate AND endDate */}
            {supportsRelativePeriod && (
              <div style={{ marginBottom: '1rem' }}>
                <label className="cds--label">Date Selection Mode</label>
                <RadioButtonGroup
                  legendText=""
                  name="date-mode"
                  valueSelected={dateMode}
                  onChange={(mode) => {
                    setDateMode(mode as DateMode);
                    // Clear relative period when switching to FIXED
                    if (mode === 'FIXED') {
                      setRelativePeriod('');
                    }
                  }}
                >
                  <RadioButton
                    id="date-mode-fixed"
                    labelText="Specific dates"
                    value="FIXED"
                  />
                  <RadioButton
                    id="date-mode-relative"
                    labelText="Relative period"
                    value="RELATIVE"
                  />
                </RadioButtonGroup>
              </div>
            )}

            {/* Relative Period Selector - shown in RELATIVE mode */}
            {dateMode === 'RELATIVE' && supportsRelativePeriod && (
              <div style={{ marginBottom: '1rem' }}>
                <Select
                  id="relative-period-select"
                  labelText="Select reporting period"
                  value={relativePeriod}
                  onChange={(e) => {
                    setRelativePeriod(e.target.value as RelativePeriod);
                  }}
                  size="sm"
                >
                  <SelectItem value="" text="Select period" />
                  {RELATIVE_PERIOD_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      text={option.label}
                    />
                  ))}
                </Select>
                {errors.relativePeriod && (
                  <div style={{ color: '#da1e28', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                    {errors.relativePeriod}
                  </div>
                )}
              </div>
            )}

            {/* Parameter Inputs */}
            {parameters.map((param) => renderParameterInput(param))}
          </Stack>
        )}
      </ModalBody>
    </Modal>
  );
};

export default PreviewParameterModal;
