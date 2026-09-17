import React from 'react';
import { ComboBox, Select, SelectItem, InlineLoading } from '@carbon/react';

import type { DataThemeConfig } from '../../../types/theme/data-theme.types';
import { getSchemaTables, type SchemaTable } from '../../../resources/theme/etl-schema.api';
import { getETLTableMeta, type TableColumn } from '../../../resources/theme/etl-table-meta.api';

type Props = {
    open: boolean;
    config: DataThemeConfig;
    onChange: (next: DataThemeConfig) => void;
};

function getTableName(t: SchemaTable): string {
    // supports { name }, { table }, { tableName }, or string-ish payloads (defensive)
    if (typeof (t as any) === 'string') return String(t);
    return (t as any)?.name ?? (t as any)?.table ?? (t as any)?.tableName ?? '';
}

export default function DataThemeSourceSection({ open, config, onChange }: Props) {
    // tables state
    const [tables, setTables] = React.useState<SchemaTable[]>([]);
    const [loadingTables, setLoadingTables] = React.useState(false);
    const [tablesError, setTablesError] = React.useState<string | null>(null);

    // columns state
    const [columns, setColumns] = React.useState<TableColumn[]>([]);
    const [loadingCols, setLoadingCols] = React.useState(false);
    const [colsError, setColsError] = React.useState<string | null>(null);

    // Load schema tables only when modal is open
    React.useEffect(() => {
        if (!open) {
            setTables([]);
            setLoadingTables(false);
            setTablesError(null);
            return;
        }

        const ac = new AbortController();
        setLoadingTables(true);
        setTablesError(null);

        getSchemaTables(ac.signal)
            .then((data) => setTables(data ?? []))
            .catch((e) => {
                if (e?.name !== 'AbortError') setTablesError(e?.message ?? 'Failed to load tables');
            })
            .finally(() => setLoadingTables(false));

        return () => ac.abort();
    }, [open]);

    // Load columns only when modal is open AND a table is selected
    React.useEffect(() => {
        if (!open) {
            setColumns([]);
            setLoadingCols(false);
            setColsError(null);
            return;
        }

        const table = config?.sourceTable;
        if (!table) {
            setColumns([]);
            setLoadingCols(false);
            setColsError(null);
            return;
        }

        const ac = new AbortController();
        setLoadingCols(true);
        setColsError(null);

        getETLTableMeta(table, ac.signal)
            .then((data) => setColumns(data ?? []))
            .catch((e) => {
                if (e?.name !== 'AbortError') setColsError(e?.message ?? 'Failed to load columns');
            })
            .finally(() => setLoadingCols(false));

        return () => ac.abort();
    }, [open, config?.sourceTable]);

    const colNames = React.useMemo(
        () => (columns ?? []).map((c) => c?.name).filter(Boolean) as string[],
        [columns],
    );

    const tableNames = React.useMemo(() => (tables ?? []).map(getTableName).filter(Boolean), [tables]);

    const canPickTable = open && !loadingTables && !tablesError;
    const canPickCols = open && Boolean(config.sourceTable) && !loadingCols && !colsError;

    return (
        <div>
            <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Source</div>

            {/* ✅ Searchable table selector */}
            <ComboBox
                id="theme-source-table"
                titleText="Source table/view"
                items={tableNames}
                selectedItem={config.sourceTable || null}
                disabled={!canPickTable}
                placeholder={loadingTables ? 'Loading…' : tablesError ? 'Failed to load tables' : 'Type to search tables…'}
                onChange={(e: any) => {
                    const nextTable = e?.selectedItem ?? '';

                    onChange({
                        ...config,
                        sourceTable: nextTable,
                        patientIdColumn: '',
                        dateColumn: '',
                        locationColumn: '',
                        fields: config.fields ?? [],
                    });
                }}
            />

            <div style={{ marginTop: '0.5rem' }}>
                {loadingTables ? <InlineLoading description="Loading tables…" /> : null}
                {!loadingTables && tablesError ? (
                    <div style={{ color: 'var(--cds-text-error, #da1e28)' }}>{tablesError}</div>
                ) : null}
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '0.75rem',
                    marginTop: '0.75rem',
                }}
            >
                <Select
                    id="theme-patient-id-col"
                    labelText="patient_id column"
                    value={config.patientIdColumn || ''}
                    disabled={!canPickCols}
                    onChange={(e) => onChange({ ...config, patientIdColumn: (e.target as HTMLSelectElement).value })}
                >
                    <SelectItem value="" disabled text={loadingCols ? 'Loading…' : 'Select'} />
                    {colNames.map((c) => (
                        <SelectItem key={c} value={c} text={c} />
                    ))}
                </Select>

                <Select
                    id="theme-date-col"
                    labelText="date column"
                    value={config.dateColumn || ''}
                    disabled={!canPickCols}
                    onChange={(e) => onChange({ ...config, dateColumn: (e.target as HTMLSelectElement).value })}
                >
                    <SelectItem value="" disabled text={loadingCols ? 'Loading…' : 'Select'} />
                    {colNames.map((c) => (
                        <SelectItem key={c} value={c} text={c} />
                    ))}
                </Select>

                <Select
                    id="theme-location-col"
                    labelText="location column (optional)"
                    value={config.locationColumn || ''}
                    disabled={!canPickCols}
                    onChange={(e) => onChange({ ...config, locationColumn: (e.target as HTMLSelectElement).value })}
                >
                    <SelectItem value="" disabled text={loadingCols ? 'Loading…' : 'Select'} />
                    {colNames.map((c) => (
                        <SelectItem key={c} value={c} text={c} />
                    ))}
                </Select>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
                {loadingCols ? <InlineLoading description="Loading columns…" /> : null}
                {!loadingCols && colsError ? (
                    <div style={{ color: 'var(--cds-text-error, #da1e28)' }}>{colsError}</div>
                ) : null}
            </div>
        </div>
    );
}