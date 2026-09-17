import React from 'react';
import { ComboBox, TextInput, Stack } from '@carbon/react';

import type { PatientIdColumn, PopulationExtractionMethod } from '../types/custom-indicator.types';

type Props = {
  patientIdColumn: PatientIdColumn;
  extractionMethod: PopulationExtractionMethod;
  configPath: string;
  customExtractor: string;
  onChangePatientIdColumn: (value: PatientIdColumn) => void;
  onChangeExtractionMethod: (value: PopulationExtractionMethod) => void;
  onChangeConfigPath: (value: string) => void;
  onChangeCustomExtractor: (value: string) => void;
};

const PATIENT_ID_OPTIONS = [
  { id: 'patient_id', label: 'patient_id' },
  { id: 'patient_id', label: 'patient_id' },
  { id: 'person_id', label: 'person_id' },
];

const EXTRACTION_METHOD_OPTIONS = [
  { id: 'sqlTemplate', label: 'SQL Template (direct)' },
  { id: 'configJson', label: 'Config JSON Path' },
  { id: 'auto', label: 'Auto-detect' },
  { id: 'custom', label: 'Custom Extractor' },
];

export default function CustomIndicatorPopulationSection({
  patientIdColumn,
  extractionMethod,
  configPath,
  customExtractor,
  onChangePatientIdColumn,
  onChangeExtractionMethod,
  onChangeConfigPath,
  onChangeCustomExtractor,
}: Props) {
  const selectedPatientId = React.useMemo(
    () => PATIENT_ID_OPTIONS.find((opt) => opt.id === patientIdColumn) || PATIENT_ID_OPTIONS[0],
    [patientIdColumn],
  );

  const selectedExtractionMethod = React.useMemo(
    () => EXTRACTION_METHOD_OPTIONS.find((opt) => opt.id === extractionMethod) || EXTRACTION_METHOD_OPTIONS[0],
    [extractionMethod],
  );

  return (
    <Stack gap={4}>
      <h4 style={{ margin: 0 }}>Population Configuration</h4>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <ComboBox
          id="patient-id-column"
          titleText="Patient ID Column"
          items={PATIENT_ID_OPTIONS}
          itemToString={(item) => (item ? item.label : '')}
          selectedItem={selectedPatientId}
          placeholder="Select patient ID column"
          onChange={({ selectedItem: selected }) => {
            if (selected) {
              onChangePatientIdColumn((selected as any).id as PatientIdColumn);
            }
          }}
        />

        <ComboBox
          id="extraction-method"
          titleText="Population Extraction Method"
          items={EXTRACTION_METHOD_OPTIONS}
          itemToString={(item) => (item ? item.label : '')}
          selectedItem={selectedExtractionMethod}
          placeholder="Select extraction method"
          onChange={({ selectedItem: selected }) => {
            if (selected) {
              onChangeExtractionMethod((selected as any).id as PopulationExtractionMethod);
            }
          }}
        />
      </div>

      {extractionMethod === 'configJson' && (
        <TextInput
          id="config-path"
          labelText="Config JSON Path"
          value={configPath}
          onChange={(e) => onChangeConfigPath((e.target as HTMLInputElement).value)}
          placeholder="e.g., populationQuery.sql"
          helperText="Path in configJson where population SQL is stored"
        />
      )}

      {extractionMethod === 'custom' && (
        <TextInput
          id="custom-extractor"
          labelText="Custom Extractor Function"
          value={customExtractor}
          onChange={(e) => onChangeCustomExtractor((e.target as HTMLInputElement).value)}
          placeholder="e.g., extractRttPopulation"
          helperText="Name of the custom extractor function to use"
        />
      )}
    </Stack>
  );
}
