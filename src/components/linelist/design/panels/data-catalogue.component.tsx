/**
 * Data Catalogue Component for Linelist Reports
 *
 * Left panel component that provides searchable, grouped access to available fields.
 * Integrates with existing ETL metadata infrastructure.
 *
 * Based on design spec section 7: Left panel — Data catalogue
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  TextInput,
  Button,
  Tag,
  Accordion,
  AccordionItem,
  InlineNotification,
  Toggle,
} from '@carbon/react';
import { User, Tag as TagIcon, Function, Hashtag } from '@carbon/react/icons';

// import { useETLTables } from '../../../../hooks/theme';
import { useETLTableMeta } from '../../../../hooks/theme';
// import { useDataThemes } from '../../../../hooks/theme';
// TableColumn type imported as needed
import type { FilterFieldType, DataSourceInfo, PopulationSource, LinelistColumnDraft } from '../../../../types/linelist-types';
import type {
  EtlStructure,
} from '../../../../types/etl/etl-types';
import { listPersonAttributeTypes, type PersonAttributeTypeDto } from '../../../../resources/person-attribute-type/person-attribute-type.api';
import { listPatientIdentifierTypes, type PatientIdentifierTypeDto } from '../../../../resources/patient-identifier-type/patient-identifier-type.api';
import { useAddressFields } from '../../../../hooks/address-template';
import CustomSqlColumnModal, { type CustomSqlColumnConfig } from '../../definition/panels/custom-sql-column-modal.component';
import PopulationSourceSelector from '../../definition/panels/population-source-selector.component';
import ObservationColumnModal from '../../definition/panels/observation-column-modal.component';
import EncounterDiagnosisColumnModal from '../../definition/panels/encounter-diagnosis-column-modal.component';
import styles from './data-catalogue.scss';

/**
 * Field group definitions based on clinical domain
 * Maps field patterns to display groups
 */
const FIELD_GROUPS = [
  {
    id: 'demographics',
    name: 'Demographics',
    description: 'Patient demographic information',
    fieldPatterns: ['given_name', 'family_name', 'person_name', 'sex', 'gender', 'birth_date', 'age', 'death_date'],
    icon: User,
  },
  {
    id: 'api-person-attributes',
    name: 'Person Attributes',
    description: 'Custom person attributes from OpenMRS (Telephone, Civil Status, etc.)',
    fieldPatterns: [], // No pattern matching - populated via API
    icon: TagIcon,
    isApiDriven: true, // Flag for API-driven groups
  },
  {
    id: 'openmrs-calculated',
    name: 'Calculated Fields',
    description: 'Fields calculated from other data',
    fieldPatterns: ['age', 'bmi'],
    icon: Function,
  },
  {
    id: 'api-patient-identifiers',
    name: 'Patient Identifiers',
    description: 'Patient identification numbers from OpenMRS (Clinic No, National ID, etc.)',
    fieldPatterns: [], // No pattern matching - populated via API
    icon: Hashtag,
    isApiDriven: true, // Flag for API-driven groups
  },
  {
    id: 'api-observations',
    name: 'Observations',
    description: 'Clinical observations from OpenMRS based on concepts (e.g., Weight, Height, Temperature)',
    fieldPatterns: [], // No pattern matching - populated via API
    icon: '📊',
    isApiDriven: true, // Flag for API-driven groups
    isConceptBased: true, // New flag for concept-based groups
  },
  {
    id: 'api-encounter-diagnoses',
    name: 'Encounter Diagnoses',
    description: 'Diagnoses from OpenMRS encounters based on concepts (ICD coded conditions)',
    fieldPatterns: [], // No pattern matching - populated via API
    icon: '🏥',
    isApiDriven: true, // Flag for API-driven groups
    isConceptBased: true, // New flag for concept-based groups
  },
  {
    id: 'openmrs-person-name',
    name: 'Person Name',
    description: 'Patient name components',
    fieldPatterns: ['given_name', 'family_name', 'middle_name', 'person_name'],
    icon: User,
  },
  {
    id: 'openmrs-address',
    name: 'Address & Contact',
    description: 'Address and contact information',
    fieldPatterns: ['address', 'address1', 'address2', 'address3', 'address4', 'address5', 'village', 'parish', 'subcounty', 'county', 'district', 'state', 'stateProvince', 'countyDistrict', 'city', 'cityVillage', 'phone', 'telephone'],
    icon: '📍',
  },
  {
    id: 'addresses',
    name: 'Addresses & Contacts',
    description: 'Patient address and contact information',
    fieldPatterns: ['address', 'address1', 'address2', 'address3', 'address4', 'address5', 'city', 'village', 'parish', 'subcounty', 'county', 'district', 'state', 'stateProvince', 'countyDistrict', 'country', 'phone', 'telephone', 'email'],
    icon: '📍',
  },
  {
    id: 'encounters',
    name: 'Encounters & Visits',
    description: 'Encounter and visit information',
    fieldPatterns: ['encounter', 'visit', 'visit_date', 'encounter_date', 'encounter_type', 'location'],
    icon: '🏥',
  },
  {
    id: 'observations',
    name: 'Observations',
    description: 'Clinical observations and vitals',
    fieldPatterns: ['obs', 'observation', 'value', 'concept', 'weight', 'height', 'bmi', 'temperature', 'blood_pressure'],
    icon: '📊',
  },
  {
    id: 'programs',
    name: 'Programs & Enrollments',
    description: 'Program enrollment and status',
    fieldPatterns: ['program', 'enrollment', 'enrol', 'program_enrollment', 'regimen', 'art', 'hiv', 'tb'],
    icon: '📋',
  },
  {
    id: 'appointments',
    name: 'Appointments',
    description: 'Scheduled appointments',
    fieldPatterns: ['appointment', 'return_visit', 'appointment_date', 'fulfillment', 'scheduled'],
    icon: '📅',
  },
  {
    id: 'laboratory',
    name: 'Laboratory',
    description: 'Lab results and orders',
    fieldPatterns: ['lab', 'laboratory', 'test', 'result', 'specimen', 'order_date', 'result_date'],
    icon: '🔬',
  },
  {
    id: 'medications',
    name: 'Medications',
    description: 'Drug prescriptions and dispenses',
    fieldPatterns: ['drug', 'medication', 'prescription', 'dispense', 'regimen', 'dose'],
    icon: '💊',
  },
];

/**
 * Common OpenMRS Calculated Fields
 * These are always available regardless of selected ETL table
 */
const CALCULATED_FIELDS: CatalogueField[] = [
  {
    id: 'openmrs.calc.age',
    name: 'age',
    label: 'Age',
    type: 'NUMBER',
    source: 'CALCULATION',
    table: 'person',
    isRepeated: false,
    description: 'Age in years (as of report end date)',
  },
  {
    id: 'openmrs.calc.age_months',
    name: 'age_months',
    label: 'Age (Months)',
    type: 'NUMBER',
    source: 'CALCULATION',
    table: 'person',
    isRepeated: false,
    description: 'Age in months (as of report end date)',
  },
  {
    id: 'openmrs.calc.age_years',
    name: 'age_years',
    label: 'Age (Years)',
    type: 'NUMBER',
    source: 'CALCULATION',
    table: 'person',
    isRepeated: false,
    description: 'Age in whole years (as of report end date)',
  },
  {
    id: 'openmrs.calc.bmi',
    name: 'bmi',
    label: 'BMI',
    type: 'NUMBER',
    source: 'CALCULATION',
    table: 'person',
    isRepeated: false,
    description: 'Body Mass Index',
  },
];

/**
 * Common OpenMRS Person/Patient fields
 * These are always available regardless of selected ETL table
 */
const DEMOGRAPHIC_FIELDS: CatalogueField[] = [
  // Person Name
  {
    id: 'openmrs.person.given_name',
    name: 'given_name',
    label: 'Given Name',
    type: 'TEXT',
    source: 'CORE',
    table: 'person',
    isRepeated: false,
    description: 'Patient given name',
  },
  {
    id: 'openmrs.person.family_name',
    name: 'family_name',
    label: 'Family Name',
    type: 'TEXT',
    source: 'CORE',
    table: 'person',
    isRepeated: false,
    description: 'Patient family name/surname',
  },
  {
    id: 'openmrs.person.full_name',
    name: 'full_name',
    label: 'Full Name',
    type: 'TEXT',
    source: 'CORE',
    table: 'person',
    isRepeated: false,
    description: 'Complete patient name',
  },
  // Person Attributes
  {
    id: 'openmrs.person.gender',
    name: 'gender',
    label: 'Gender',
    type: 'CODED',
    source: 'CORE',
    table: 'person',
    isRepeated: false,
    description: 'Patient gender',
  },
  {
    id: 'openmrs.person.birthdate',
    name: 'birthdate',
    label: 'Birth Date',
    type: 'DATE',
    source: 'CORE',
    table: 'person',
    isRepeated: false,
    description: 'Patient birth date',
  },
  {
    id: 'openmrs.person.death_date',
    name: 'death_date',
    label: 'Death Date',
    type: 'DATE',
    source: 'CORE',
    table: 'person',
    isRepeated: false,
    description: 'Patient death date',
  },
];

/**
 * Map SQL column types to FilterFieldType
 */
function mapColumnTypeToFilterFieldType(sqlType?: string): FilterFieldType {
  if (!sqlType) return 'TEXT';

  const type = sqlType.toLowerCase();

  // Integer types
  if (type.includes('int') || type.includes('serial') || type.includes('bigint')) {
    return 'NUMBER';
  }

  // Decimal/numeric types
  if (type.includes('decimal') || type.includes('numeric') || type.includes('float') || type.includes('double')) {
    return 'NUMBER';
  }

  // Date/time types
  if (type.includes('date') || type.includes('time') || type.includes('timestamp')) {
    return 'DATE';
  }

  // Boolean type
  if (type.includes('bool') || type.includes('bit')) {
    return 'BOOLEAN';
  }

  // Default to text
  return 'TEXT';
}

/**
 * Get field source type
 */
function getFieldType(columnName: string, table: string): 'CORE' | 'ETL' | 'CALCULATION' {
  // Add calculation detection logic here
  if (columnName.includes('age') || columnName.includes('bmi')) {
    return 'CALCULATION';
  }

  // ETL tables typically have specific prefixes
  if (table.includes('_etl') || table.includes('_fact') || table.includes('_dim')) {
    return 'ETL';
  }

  return 'CORE';
}

/**
 * Categorize a field into a group
 */
function categorizeField(fieldName: string): string | null {
  const lowerField = fieldName.toLowerCase();

  for (const group of FIELD_GROUPS) {
    for (const pattern of group.fieldPatterns) {
      if (lowerField.includes(pattern.toLowerCase())) {
        return group.id;
      }
    }
  }

  return null;
}

/**
 * Check if a field can have multiple values per patient
 */
function isPotentiallyRepeated(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();
  const repeatedKeywords = [
    'appointment', 'visit', 'encounter', 'obs', 'observation',
    'lab', 'test', 'result', 'program', 'enrollment', 'drug',
    'medication', 'regimen'
  ];

  return repeatedKeywords.some(keyword => lowerField.includes(keyword));
}

type Props = {
  /** Legacy: Single table name (deprecated, use dataSources) */
  table?: string;
  /** Multiple datasources to browse columns from */
  dataSources?: DataSourceInfo[];
  /** Population sources for cohort definition */
  populationSources?: PopulationSource[];
  /** Callback when population sources change */
  onPopulationSourcesChange?: (populationSources: PopulationSource[]) => void;
  /** Show population sources selector (for SQL/Hybrid modes) */
  showPopulationSelector?: boolean;
  onAddToColumns: (field: CatalogueField) => void;
  onAddToFilters: (field: CatalogueField) => void;
  onTableChange?: (table: string) => void;
  onDataSourcesChange?: (dataSources: DataSourceInfo[]) => void;
  onFieldsAvailable?: (fields: CatalogueField[]) => void; // Callback to expose available fields to parent
  onEtlStructureDetected?: (structure: EtlStructure) => void; // Callback when ETL structure is detected
  selectedFields?: string[]; // Field IDs that are already selected
  disabled?: boolean;
  /** Callback to add a custom SQL column */
  onAddCustomSqlColumn?: (config: CustomSqlColumnConfig) => void;
  /** Callback to add a draft column (for observation/diagnosis columns) */
  onAddDraftColumn?: (column: LinelistColumnDraft) => void;
  /** The patient/client ID column alias used by the base cohort SQL */
  idColumnAlias?: 'patient_id' | 'patient_id';
};

/**
 * Field in the catalogue
 */
export type CatalogueField = {
  id: string;
  name: string;
  label: string;
  type: FilterFieldType;
  source: 'CORE' | 'ETL' | 'CALCULATION';
  table: string;
  isRepeated: boolean;
  description?: string;
  /** Which datasource this field comes from */
  dataSourceUuid?: string;
  /** Display name of the datasource */
  dataSourceName?: string;
};

const DataCatalogue: React.FC<Props> = ({
  table: legacyTable,
  dataSources: propDataSources,
  populationSources: propPopulationSources,
  onPopulationSourcesChange,
  showPopulationSelector = true,
  onAddToColumns,
  onAddToFilters,
  onFieldsAvailable,
  onEtlStructureDetected,
  selectedFields = [],
  disabled = false,
  onAddCustomSqlColumn,
  onAddDraftColumn,
  idColumnAlias = 'patient_id',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [etlStructure, setEtlStructure] = useState<EtlStructure | null>(null);
  const [customSqlModalOpen, setCustomSqlModalOpen] = useState(false);
  const [observationModalOpen, setObservationModalOpen] = useState(false);
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);

  // State for API-fetched data
  const [personAttributeTypes, setPersonAttributeTypes] = useState<Array<PersonAttributeTypeDto>>([]);
  const [patientIdentifierTypes, setPatientIdentifierTypes] = useState<Array<PatientIdentifierTypeDto>>([]);
  const [apiDataLoading, setApiDataLoading] = useState(true);
  const [apiDataError, setApiDataError] = useState<string | null>(null);

  // Internal state for population sources (if not controlled)
  const [internalPopulationSources, setInternalPopulationSources] = useState<PopulationSource[]>([]);
  const populationSources = propPopulationSources ?? internalPopulationSources;

  // Handle population sources change
  const handlePopulationSourcesChange = (newSources: PopulationSource[]) => {
    setInternalPopulationSources(newSources);
    if (onPopulationSourcesChange) {
      onPopulationSourcesChange(newSources);
    }
  };

  // Fetch dynamic address fields from OpenMRS address template
  const { addressFields } = useAddressFields();

  // Get available tables
  // const { tables, loading: tablesLoading, error: tablesError } = useETLTables(true);

  // Use new dataSources prop or fall back to legacy single table
  const dataSources = useMemo(() => {
    return propDataSources || (legacyTable ? [{
      uuid: legacyTable,
      name: legacyTable,
      type: 'ETL',
      role: 'PRIMARY',
      tables: [],
    }] : []);
  }, [propDataSources, legacyTable]);

  // Get the primary datasource for single-table mode compatibility
  const primaryDataSource = dataSources.find(ds => ds.role === 'PRIMARY');
  const primaryTable = primaryDataSource?.uuid || legacyTable || '';
  const primaryDatasourceName = primaryDataSource?.name || '';

  // Get columns for selected table (primary datasource)
  const {
    columns,
    loading: columnsLoading,
    error: columnsError,
  } = useETLTableMeta(primaryTable, Boolean(primaryTable));

  // Fetch person attribute types and patient identifier types on mount
  useEffect(() => {
    const fetchApiData = async () => {
      try {
        setApiDataLoading(true);
        setApiDataError(null);

        const [attributes, identifiers] = await Promise.all([
          listPersonAttributeTypes(true),
          listPatientIdentifierTypes(true),
        ]);

        setPersonAttributeTypes(attributes);
        setPatientIdentifierTypes(identifiers);
      } catch (error) {
        console.error('Failed to fetch person attributes/identifiers:', error);
        setApiDataError('Failed to load person attributes and identifiers from server');
      } finally {
        setApiDataLoading(false);
      }
    };

    fetchApiData();
  }, []);

  /**
   * Organize columns into field groups
   */
  const groupedFields = useMemo(() => {
    const groups: Record<string, CatalogueField[]> = {};

    // Initialize empty arrays for all groups
    FIELD_GROUPS.forEach((group) => {
      groups[group.id] = [];
    });

    // Add "uncategorized" group for fields that don't match any group
    groups['uncategorized'] = [];

    // Add calculated fields (always available)
    groups['openmrs-calculated'] = CALCULATED_FIELDS;

    // Add demographic fields (always available)
    groups['demographics'] = DEMOGRAPHIC_FIELDS;

    // Add dynamic address fields from OpenMRS address template
    groups['openmrs-address'] = addressFields;

    // Add API-fetched person attribute types
    groups['api-person-attributes'] = personAttributeTypes
      .filter((attr) => !attr.retired) // Filter out retired attributes
      .map((attr) => ({
        id: `person-attribute-${attr.uuid}`,
        name: attr.uuid,
        label: attr.display || attr.name || attr.uuid,
        type: 'TEXT' as FilterFieldType,
        source: 'CORE' as const,
        table: 'person_attribute',
        isRepeated: false,
        description: attr.description || 'Custom person attribute',
      }));

    // Add API-fetched patient identifier types
    groups['api-patient-identifiers'] = patientIdentifierTypes
      .filter((id) => !id.retired) // Filter out retired identifiers
      .map((idType) => ({
        id: `patient-identifier-${idType.uuid}`,
        name: idType.uuid,
        label: idType.display || idType.name || idType.uuid,
        type: 'TEXT' as FilterFieldType,
        source: 'CORE' as const,
        table: 'patient_identifier',
        isRepeated: true, // Patients can have multiple identifiers of the same type
        description: idType.description || 'Patient identifier',
      }));

    // Add placeholder for concept-based observations
    // These will be dynamically added by users via concept search
    groups['api-observations'] = [];

    // Add placeholder for concept-based encounter diagnoses
    // These will be dynamically added by users via concept search
    groups['api-encounter-diagnoses'] = [];

    // Categorize each column from the selected table
    if (columns && columns.length > 0) {
      columns.forEach((column) => {
        const groupId = categorizeField(column.name) || 'uncategorized';

        // Skip groups that are pre-populated with static/dynamic fields
        // to avoid duplicates with ETL table columns
        if (groupId === 'demographics' || groupId === 'openmrs-calculated') {
          return;
        }

        const field: CatalogueField = {
          id: `${primaryTable}.${column.name}`,
          name: column.name,
          label: formatFieldLabel(column.name),
          type: mapColumnTypeToFilterFieldType(column.type),
          source: getFieldType(column.name, primaryTable),
          table: primaryTable,
          isRepeated: isPotentiallyRepeated(column.name),
          dataSourceUuid: dataSources.find(ds => ds.uuid === primaryTable)?.uuid || primaryTable,
          dataSourceName: dataSources.find(ds => ds.uuid === primaryTable)?.name || primaryTable,
        };

        groups[groupId].push(field);
      });
    }

    return groups;
  }, [columns, primaryTable, personAttributeTypes, patientIdentifierTypes, dataSources, addressFields]);

  /**
   * Expose all available fields to parent component
   */
  useEffect(() => {
    if (onFieldsAvailable) {
      const allFields: CatalogueField[] = Object.values(groupedFields).flat();
      onFieldsAvailable(allFields);
    }
  }, [groupedFields, onFieldsAvailable]);

  /**
   * Detect ETL structure when table/columns change
   */
  useEffect(() => {
    if (!primaryTable || !columns || columns.length === 0) {
      return;
    }

    // Import the detection function dynamically to avoid circular deps
    import('../../../../types/etl/etl-types').then(({ detectEtlStructure }) => {
      const columnNames = columns.map((c) => c.name);
      const detected = detectEtlStructure(primaryTable, columnNames);
      setEtlStructure(detected);

      if (onEtlStructureDetected) {
        onEtlStructureDetected(detected);
      }
    });
  }, [primaryTable, columns, onEtlStructureDetected]);

  /**
   * Filter fields based on search term and selection toggle
   */
  const filteredGroupedFields = useMemo(() => {
    let result = groupedFields;
    const selectedSet = new Set(selectedFields);

    // By default, exclude selected fields from the available options
    // (unless showSelectedOnly is enabled, then show ONLY selected fields)
    if (!showSelectedOnly && selectedSet.size > 0) {
      const filtered: Record<string, CatalogueField[]> = {};
      Object.entries(groupedFields).forEach(([groupId, fields]) => {
        const availableFields = fields.filter((field) => !selectedSet.has(field.id));
        if (availableFields.length > 0) {
          filtered[groupId] = availableFields;
        }
      });
      result = filtered;
    } else if (showSelectedOnly) {
      // Show only selected fields
      const filtered: Record<string, CatalogueField[]> = {};
      Object.entries(groupedFields).forEach(([groupId, fields]) => {
        const matchingFields = fields.filter((field) => selectedSet.has(field.id));
        if (matchingFields.length > 0) {
          filtered[groupId] = matchingFields;
        }
      });
      result = filtered;
    }

    // Apply search filter
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      const filtered: Record<string, CatalogueField[]> = {};
      Object.entries(result).forEach(([groupId, fields]) => {
        const matchingFields = fields.filter(
          (field) =>
            field.name.toLowerCase().includes(lowerSearch) ||
            field.label.toLowerCase().includes(lowerSearch)
        );
        if (matchingFields.length > 0) {
          filtered[groupId] = matchingFields;
        }
      });
      result = filtered;
    }

    return result;
  }, [groupedFields, searchTerm, showSelectedOnly, selectedFields]);

  /**
   * Toggle group expansion
   */
  const toggleGroup = useCallback((groupId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  /**
   * Expand all groups
   */
  const expandAll = useCallback(() => {
    setExpandedGroups(new Set(Object.keys(filteredGroupedFields)));
  }, [filteredGroupedFields]);

  /**
   * Collapse all groups
   */
  const collapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

  const isLoading = columnsLoading || apiDataLoading;
  const error = columnsError || apiDataError;
  const totalFields = Object.values(filteredGroupedFields).reduce((sum, fields) => sum + fields.length, 0);

  return (
    <div className={styles.catalogue}>
      {/* Population Sources Selector */}
      {showPopulationSelector && onPopulationSourcesChange && (
        <div className={styles.populationSourcesSection}>
          <PopulationSourceSelector
            populationSources={populationSources}
            onChange={handlePopulationSourcesChange}
            disabled={disabled}
            showAdvanced={false}
          />
        </div>
      )}

      {/* ETL Structure Indicator */}
      {etlStructure && (
        <div className={styles.etlIndicator}>
          <div className={styles.etlTypeBadge}>
            <span className={styles.etlTypeIcon}>
              {etlStructure.type === 'VERTICAL' ? '📊' : '📋'}
            </span>
            <span className={styles.etlTypeLabel}>
              {etlStructure.type === 'VERTICAL' ? 'Vertical ETL' : 'Horizontal ETL'}
            </span>
          </div>
          <div className={styles.etlDescription}>
            {etlStructure.type === 'VERTICAL' ? (
              <>
                Data stored in long format. Filter by{' '}
                <strong>{etlStructure.dataIdentifierColumn || 'concept'}</strong> to select specific data points.
              </>
            ) : (
              <>
                Data stored in wide format. Columns are directly selectable data points.
              </>
            )}
          </div>
          {etlStructure.type === 'VERTICAL' && etlStructure.requiredFilters && (
            <div className={styles.etlHint}>
              <strong>Required filters:</strong> {etlStructure.requiredFilters.map(f => f.column).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Search and controls */}
      <div className={styles.controls}>
        <TextInput
          id="field-search"
          labelText=""
          placeholder="Search fields..."
          size="sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          disabled={disabled || isLoading}
        />
        <div className={styles.actionButtons}>
          <Button
            kind="ghost"
            size="sm"
            onClick={expandAll}
            disabled={disabled || isLoading}
          >
            Expand All
          </Button>
          <Button
            kind="ghost"
            size="sm"
            onClick={collapseAll}
            disabled={disabled || isLoading}
          >
            Collapse All
          </Button>
        </div>
      </div>

      {/* Add Custom SQL Column */}
      {onAddCustomSqlColumn && (
        <div className={styles.customColumnSection}>
          <Button
            kind="secondary"
            size="sm"
            onClick={() => setCustomSqlModalOpen(true)}
            disabled={disabled}
          >
            + Custom SQL Column
          </Button>
        </div>
      )}

      {/* Available/Selected toggle */}
      {selectedFields.length > 0 && (
        <div className={styles.toggleContainer}>
          <Toggle
            id="show-selected-toggle"
            labelText="Show selected only"
            labelA="All fields"
            labelB="Selected only"
            toggled={showSelectedOnly}
            onToggle={() => setShowSelectedOnly(!showSelectedOnly)}
            disabled={disabled || isLoading}
          />
          <Tag type="blue">{selectedFields.length} selected</Tag>
        </div>
      )}

      {/* Error state */}
      {error && (
        <InlineNotification
          kind="error"
          title="Error"
          subtitle={error}
          hideCloseButton
        />
      )}

      {/* Empty state */}
      {!isLoading && !error && totalFields === 0 && (
        <div className={styles.empty}>
          {primaryTable ? (
            <p>No fields found for table: {primaryTable}</p>
          ) : (
            <p>Select a data source to view available fields</p>
          )}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className={styles.loading}>Loading fields...</div>
      )}

      {/* Field groups */}
      {!isLoading && totalFields > 0 && (
        <div className={styles.fieldGroups}>
          <Accordion className={styles.accordion}>
            {FIELD_GROUPS.map((group) => {
              const groupFields = filteredGroupedFields[group.id] || [];
              const isExpanded = expandedGroups.has(group.id);

              // Allow concept-based groups to show even with no fields
              if (groupFields.length === 0 && !group.isConceptBased) return null;

              return (
                <AccordionItem
                  key={group.id}
                  title={
                    <div className={styles.groupHeader}>
                      <span className={styles.groupIcon}>{group.icon && React.createElement(group.icon, { size: 16 })}</span>
                      <span className={styles.groupName}>{group.name}</span>
                      {group.isConceptBased ? (
                        <Tag size="sm" type="blue">+</Tag>
                      ) : (
                        <Tag size="sm" type="gray">{groupFields.length}</Tag>
                      )}
                    </div>
                  }
                  open={isExpanded}
                  onClick={(e) => toggleGroup(group.id, e)}
                >
                  {/* Concept-based groups show an "Add Column" button instead of predefined fields */}
                  {group.isConceptBased ? (
                    <div className={styles.conceptBasedGroupContent}>
                      <p className={styles.conceptBasedDescription}>
                        {group.description}
                      </p>
                      <div className={styles.conceptBasedActions}>
                        {group.id === 'api-observations' && (
                          <Button
                            kind="primary"
                            size="sm"
                            onClick={() => setObservationModalOpen(true)}
                            disabled={disabled}
                            renderIcon={null}
                          >
                            + Add Observation Column
                          </Button>
                        )}
                        {group.id === 'api-encounter-diagnoses' && (
                          <Button
                            kind="primary"
                            size="sm"
                            onClick={() => setDiagnosisModalOpen(true)}
                            disabled={disabled}
                            renderIcon={null}
                          >
                            + Add Diagnosis Column
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      className={styles.fieldList}
                      onClick={(e) => {
                        // Prevent accordion toggle when clicking on field items
                        e.stopPropagation();
                      }}
                    >
                      {groupFields.map((field) => {
                        const isSelected = selectedFields.includes(field.id);
                        return (
                          <div key={field.id} className={styles.fieldItem} data-selected={isSelected}>
                            <div className={styles.fieldInfo}>
                              <span className={styles.fieldName}>{field.label}</span>
                              <div className={styles.fieldMeta}>
                                {isSelected && (
                                  <Tag size="sm" type="green">Selected</Tag>
                                )}
                                {field.dataSourceName && (
                                  <Tag size="sm" type="cool-gray">{field.dataSourceName}</Tag>
                                )}
                                <Tag size="sm" type="blue">{field.type}</Tag>
                                <Tag size="sm" type="gray">{field.source}</Tag>
                                {field.isRepeated && (
                                  <Tag size="sm" type="purple">Repeated</Tag>
                                )}
                              </div>
                              <div className={styles.fieldName}>{field.name}</div>
                            </div>
                            <div className={styles.fieldActions}>
                              <Button
                                kind="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddToColumns(field);
                                }}
                                disabled={disabled}
                              >
                                + Column
                              </Button>
                              <Button
                                kind="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddToFilters(field);
                                }}
                                disabled={disabled}
                              >
                                + Filter
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </AccordionItem>
              );
            })}

            {/* Uncategorized fields */}
            {filteredGroupedFields['uncategorized'] && filteredGroupedFields['uncategorized'].length > 0 && (
              <AccordionItem
                key="uncategorized"
                title={
                  <div className={styles.groupHeader}>
                    <span className={styles.groupIcon}>📁</span>
                    <span className={styles.groupName}>Other Fields</span>
                    <Tag size="sm" type="gray">{filteredGroupedFields['uncategorized'].length}</Tag>
                  </div>
                }
                open={expandedGroups.has('uncategorized')}
                onClick={() => toggleGroup('uncategorized')}
              >
                <div className={styles.fieldList}>
                  {filteredGroupedFields['uncategorized']?.map((field) => {
                    const isSelected = selectedFields.includes(field.id);
                    return (
                      <div key={field.id} className={styles.fieldItem} data-selected={isSelected}>
                        <div className={styles.fieldInfo}>
                          <span className={styles.fieldName}>{field.label}</span>
                          <div className={styles.fieldMeta}>
                            {isSelected && (
                              <Tag size="sm" type="green">Selected</Tag>
                            )}
                            {field.dataSourceName && (
                              <Tag size="sm" type="cool-gray">{field.dataSourceName}</Tag>
                            )}
                            <Tag size="sm" type="blue">{field.type}</Tag>
                            <Tag size="sm" type="gray">{field.source}</Tag>
                            {field.isRepeated && (
                              <Tag size="sm" type="purple">Repeated</Tag>
                            )}
                          </div>
                          <div className={styles.fieldName}>{field.name}</div>
                        </div>
                        <div className={styles.fieldActions}>
                          <Button
                            kind="ghost"
                            size="sm"
                            onClick={() => onAddToColumns(field)}
                            disabled={disabled}
                          >
                            + Column
                          </Button>
                          <Button
                            kind="ghost"
                            size="sm"
                            onClick={() => onAddToFilters(field)}
                            disabled={disabled}
                          >
                            + Filter
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </AccordionItem>
            )}
          </Accordion>
        </div>
      )}

      {/* Summary */}
      {!isLoading && totalFields > 0 && (
        <div className={styles.summary}>
          {totalFields} field{totalFields !== 1 ? 's' : ''} available
        </div>
      )}

      {/* Custom SQL Column Modal */}
      {onAddCustomSqlColumn && (
        <CustomSqlColumnModal
          open={customSqlModalOpen}
          onClose={() => setCustomSqlModalOpen(false)}
          onSave={onAddCustomSqlColumn}
          existingColumnNames={[]}
          idColumnAlias={idColumnAlias}
          primaryDatasourceName={primaryDatasourceName}
        />
      )}

      {/* Observation Column Modal */}
      <ObservationColumnModal
        open={observationModalOpen}
        onClose={() => setObservationModalOpen(false)}
        onAddColumn={onAddDraftColumn || (() => {})}
        existingColumns={[]}
      />

      {/* Encounter Diagnosis Column Modal */}
      <EncounterDiagnosisColumnModal
        open={diagnosisModalOpen}
        onClose={() => setDiagnosisModalOpen(false)}
        onAddColumn={onAddDraftColumn || (() => {})}
        existingColumns={[]}
      />
    </div>
  );
};

/**
 * Format field name into a readable label
 */
function formatFieldLabel(fieldName: string): string {
  return fieldName
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default DataCatalogue;
