/**
 * Custom Indicator Type Definitions
 *
 * Custom indicators are complex indicators that don't fit into BASE/COMPOSITE/FINAL categories.
 * They have their own complex SQL logic with multiple JOINs, subqueries, and business rules.
 */

/**
 * Patient identification column types
 */
export type PatientIdColumn = 'patient_id' | 'patient_id' | 'person_id';

/**
 * Population query extraction methods
 */
export type PopulationExtractionMethod = 'sqlTemplate' | 'configJson' | 'auto' | 'custom';

/**
 * Re-disaggregation strategies for custom indicators
 */
export type RedisaggregationStrategy = 'population-extraction' | 'query-rewriting' | 'custom' | 'none';

/**
 * Filter preservation rule - defines which filters should be preserved during disaggregation
 */
export type FilterPreservationRule = {
    /** Filter identifier */
    name: string;
    /** Human-readable description */
    description: string;
    /** Regex pattern to identify the JOIN clause for this filter */
    joinPattern: string;
    /** Regex pattern to identify the WHERE clause for this filter */
    wherePattern: string;
    /** Whether this filter is required for the indicator to work correctly */
    required: boolean;
};

/**
 * Custom indicator configuration
 */
export type CustomIndicatorConfig = {
    version: 1;

    /**
     * Patient identification column
     * Custom indicators define their own patient ID column instead of using theme config
     */
    patientIdColumn: PatientIdColumn;

    /**
     * Population SQL preview
     * The extracted population SQL used for section disaggregation
     */
    sqlPreview?: string;

    /**
     * Full SQL template
     * The complete indicator SQL with COUNT, JOINs, and business logic
     * Included for consistency with BASE/COMPOSITE/FINAL indicators
     */
    sqlTemplate?: string;

    /**
     * Population query extraction configuration
     */
    populationQuery: {
        /** How to extract population SQL from the indicator */
        extractFrom: PopulationExtractionMethod;
        /** Path in configJson if extractFrom is 'configJson' */
        configPath?: string;
        /** Custom extraction function if extractFrom is 'custom' */
        customExtractor?: string;
    };

    /**
     * Filter preservation rules
     * Defines which filters should be preserved during section disaggregation
     */
    preserveFilters?: FilterPreservationRule[];

    /**
     * Re-disaggregation support
     */
    supportsRedisaggregation: boolean;
    /** Strategy for re-disaggregation */
    redisaggregationStrategy: RedisaggregationStrategy;

    /**
     * Theme independence
     * Custom indicators don't require theme configuration
     */
    themeIndependent: boolean;

    /**
     * Business logic description
     * Helps users understand what the indicator does
     */
    businessLogic?: string;

    /**
     * Expected data sources
     * Lists the tables/views this indicator queries
     */
    dataSources?: string[];
};

/**
 * Query structure analysis result
 */
export type QueryStructureAnalysis = {
    /** Patient ID column used in the query */
    patientIdColumn: PatientIdColumn;
    /** Whether the query contains a population subquery */
    hasPopulationQuery: boolean;
    /** Extracted population SQL */
    populationSql?: string;
    /** Filters identified in the query */
    filters: Array<{
        name: string;
        type: 'LEFT JOIN' | 'INNER JOIN' | 'WHERE';
        pattern: string;
    }>;
    /** JOIN structure */
    joinStructure: Array<{
        type: 'LEFT JOIN' | 'INNER JOIN' | 'CROSS JOIN';
        table: string;
        alias: string;
        condition: string;
    }>;
    /** Whether this query can be re-disaggregated */
    redisaggregatable: boolean;
    /** Confidence score for the analysis (0-1) */
    confidence: number;
};

/**
 * Custom indicator authoring metadata
 * Used when creating/editing custom indicators
 */
export type CustomIndicatorAuthoring = {
    version: 1;
    /** Indicator category */
    category: string;
    /** Business purpose */
    purpose: string;
    /** Expected output format */
    outputFormat: 'count' | 'table' | 'list';
    /** Configuration for UI */
    uiConfig?: {
        /** Whether to show advanced options */
        showAdvanced: boolean;
        /** Available parameters */
        parameters?: Array<{
            name: string;
            type: 'date' | 'string' | 'number' | 'boolean';
            required: boolean;
            defaultValue?: any;
        }>;
    };
};
