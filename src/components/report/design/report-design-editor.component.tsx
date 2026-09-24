import React from 'react';
import {
    Button,
    InlineNotification,
    Tabs,
    TabList,
    Tab,
    TextInput,
    NumberInput,
    Select,
    SelectItem,
    Checkbox,
    Tag,
} from '@carbon/react';
import {
    Add,
    ArrowUp,
    ArrowDown,
    TrashCan,
    Draggable,
    ArrowRight,
    ArrowLeft,
    Renew,
    View,
    Download,
    Copy,
    Launch,
} from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';

import styles from '../../../routes/report-builder.scss';

import type { ReportDefinitionDraft } from '../definition/report-definition.types';
import type { DesignGroup, DesignRow, ReportDesignDraft } from './report-design.types';
import {
    createEmptyDesignRow,
    createEmptyReportDesignDraft,
} from './report-design.utils';

export type DesignSectionSource = {
    sectionUuid: string;
    title: string;
    indicators: Array<{
        id: string;
        code: string;
        name: string;
        type: string;
    }>;
};

type Props = {
    value?: ReportDesignDraft | null;
    onChange?: (next: ReportDesignDraft) => void;
    definitionDraft?: ReportDefinitionDraft | null;
    sectionSources?: DesignSectionSource[];
    sectionNameLookup?: Record<string, string>;
};

type DragState = {
    rowId: string;
    fromGroupId: string;
} | null;

type DropTarget = {
    rowId: string;
    position: 'before' | 'after';
} | null;

type StructureItem =
    | { kind: 'group'; group: DesignGroup }
    | { kind: 'row'; group: DesignGroup; row: DesignRow; rowIndex: number };

const MAX_INDENT = 10;

function getMinIndentForRowType(type?: string | null) {
    return type === 'section-label' ? 0 : 1;
}

function clampIndentForRowType(indent: number | undefined, type?: string | null) {
    const min = getMinIndentForRowType(type);
    const safe = Number.isNaN(Number(indent)) ? min : Number(indent ?? min);
    return Math.max(min, Math.min(MAX_INDENT, safe));
}

/**
 * Drops rows repeating an id already seen, keeping the first occurrence.
 * Heals drafts contaminated by earlier buggy refreshes.
 */
function dedupeRowsById(rows: DesignRow[]): DesignRow[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    });
}

/**
 * The rows array order + indent level is the single source of truth for
 * structure. groupingParentId is derived from them — never set by hand —
 * via this pure function, applied in one place (updateGroups / build
 * functions) so it can never drift or mutate shared state. Only group
 * labels act as containers: a row's groupingParentId is the nearest
 * preceding group-label with a smaller indent (section labels and other
 * rows don't count as grouping parents). Also dedupes row ids so duplicate
 * rows can never survive a round-trip through state or storage.
 */
function withDerivedGroupingParents(rows: DesignRow[]): DesignRow[] {
    rows = dedupeRowsById(rows);
    const groupStack: DesignRow[] = [];
    return rows.map((row) => {
        const next = { ...row };
        const indent = next.indent ?? 0;
        while (
            groupStack.length > 0 &&
            (groupStack[groupStack.length - 1].indent ?? 0) >= indent
        ) {
            groupStack.pop();
        }
        const parent = groupStack[groupStack.length - 1];
        next.groupingParentId = parent ? parent.id : undefined;
        if (next.type === 'group-label') {
            groupStack.push(next);
        }
        return next;
    });
}

/**
 * Exclusive end index of the block rooted at idx: the row itself plus every
 * following row indented deeper (its descendants, at any nesting depth).
 */
function blockEndIndex(rows: DesignRow[], idx: number): number {
    const indent = rows[idx].indent ?? 0;
    let end = idx + 1;
    while (end < rows.length && (rows[end].indent ?? 0) > indent) {
        end++;
    }
    return end;
}

function applyRowTypeDefaults(row: DesignRow, nextType: string): DesignRow {
    if (nextType === 'section-label') {
        return {
            ...row,
            type: nextType as any,
            indent: 0,
            span: 'all' as any,
            emphasis: 'section' as any,
            showTotal: false,
            showDisaggregation: false,
        };
    }

    if (nextType === 'group-label') {
        return {
            ...row,
            type: nextType as any,
            indent: clampIndentForRowType(row.indent, nextType),
            span: 'label-only' as any,
            emphasis: 'group' as any,
            showTotal: false,
            showDisaggregation: false,
        };
    }

    if (nextType === 'indicator') {
        return {
            ...row,
            type: nextType as any,
            indent: clampIndentForRowType(row.indent, nextType),
            span: 'label-only' as any,
            emphasis: 'normal' as any,
            showTotal: true,
            showDisaggregation: true,
        };
    }

    return {
        ...row,
        type: nextType as any,
        indent: clampIndentForRowType(row.indent, nextType),
        span: 'label-only' as any,
        emphasis: 'normal' as any,
    };
}

function buildDesignFromSectionSources(
    sectionSources: DesignSectionSource[] = [],
    previous?: ReportDesignDraft | null,
): ReportDesignDraft {
    return {
        version: 1,
        template: 'section-tabular',
        arrayName: previous?.arrayName ?? 'results',
        defaultValue: previous?.defaultValue ?? 0,
        dimensions: previous?.dimensions ?? {},
        groups: sectionSources.map((section) => {
            const rows = [
                {
                    id: `${section.sectionUuid}__section_label`,
                    type: 'section-label' as any,
                    label: section.title,
                    indent: 0,
                    span: 'all' as any,
                    emphasis: 'section' as any,
                    showTotal: false,
                    showDisaggregation: false,
                },
                ...section.indicators.map((i) => ({
                    id: i.id,
                    type: 'indicator' as const,
                    code: i.code,
                    label: `${i.code}. ${i.name}`,
                    indent: 1,
                    keyPattern: '{code}_{age}_{sex}',
                    dims: {},
                    showTotal: true,
                    showDisaggregation: true,
                    span: 'label-only' as any,
                    emphasis: 'normal' as any,
                })),
            ];
            return {
                id: section.sectionUuid,
                title: section.title,
                rows: withDerivedGroupingParents(rows),
            };
        }),
    };
}

/**
 * Smart merge function that preserves user customizations when updating from section sources.
 * This is the preferred method over buildDesignFromSectionSources() for incremental design work.
 */
function buildDesignFromSectionSourcesWithMerge(
    sectionSources: DesignSectionSource[] = [],
    previous?: ReportDesignDraft | null,
): ReportDesignDraft {
    if (!previous || !previous.groups.length) {
        // If no previous design exists, fall back to the regular build
        return buildDesignFromSectionSources(sectionSources, previous);
    }

    // Create a map of existing groups and rows for quick lookup
    const existingGroupsMap = new Map<string, DesignGroup>();
    const existingRowsMap = new Map<string, { group: DesignGroup; row: DesignRow }>();

    previous.groups.forEach((group) => {
        existingGroupsMap.set(group.id, group);
        group.rows.forEach((row) => {
            existingRowsMap.set(row.id, { group, row });
        });
    });

    // Create a set of new section UUIDs
    const newSectionUuids = new Set(sectionSources.map((s) => s.sectionUuid));

    // Build new groups, merging with existing where possible
    const mergedGroups: DesignGroup[] = [];

    const processedSectionUuids = new Set<string>();

    for (const sectionSource of sectionSources) {
        // A section ref repeated in the definition must not produce the
        // group (and all its rows) twice
        if (processedSectionUuids.has(sectionSource.sectionUuid)) continue;
        processedSectionUuids.add(sectionSource.sectionUuid);

        const existingGroup = existingGroupsMap.get(sectionSource.sectionUuid);

        if (existingGroup) {
            // Group exists - merge rows
            const mergedRows: DesignRow[] = [];

            // Create a set of new indicator IDs
            const newIndicatorIds = new Set(sectionSource.indicators.map((i) => i.id));

            // Upgrade legacy rows whose ids predate the section-scoped id
            // scheme. Primary match: a legacy id that equals the source
            // indicator's suffix after `sectionUuid__` (legacy ids WERE the
            // raw indicatorUuid/code), which is exact and immutable. Fallback:
            // unique non-empty code — empty codes (custom rows) or codes used
            // by several indicators would match many rows to one id and
            // fabricate duplicates. Unmatched legacy rows adopt the current
            // source id so the rows are recognised below instead of being
            // dropped and re-created at the bottom of the group.
            const suffixBySourceId = new Map(
                sectionSource.indicators.map((i) => {
                    const sep = i.id.indexOf('__');
                    return [sep >= 0 ? i.id.slice(sep + 2) : i.id, i];
                }),
            );
            const codeCounts = new Map<string, number>();
            sectionSource.indicators.forEach((i) => {
                codeCounts.set(i.code, (codeCounts.get(i.code) ?? 0) + 1);
            });
            const sourceByCode = new Map(
                sectionSource.indicators
                    .filter((i) => i.code && codeCounts.get(i.code) === 1)
                    .map((i) => [i.code, i]),
            );
            const existingRows = existingGroup.rows.map((row) => {
                if (row.type !== 'indicator' || newIndicatorIds.has(row.id)) return row;
                const sep = row.id.indexOf('__');
                const legacyKey = sep >= 0 ? row.id.slice(sep + 2) : row.id;
                const match = suffixBySourceId.get(legacyKey) ?? sourceByCode.get(row.code ?? '');
                return match ? { ...row, id: match.id } : row;
            });

            // Create a map of existing rows in this group
            const existingRowsInGroup = new Map<string, DesignRow>();
            existingRows.forEach((row) => {
                existingRowsInGroup.set(row.id, row);
            });

            const sectionLabelRowId = `${sectionSource.sectionUuid}__section_label`;

            // Only create the section label if it doesn't exist yet; if it does,
            // the walk below keeps it in its current (possibly user-moved) position.
            if (!existingRowsInGroup.has(sectionLabelRowId)) {
                mergedRows.push({
                    id: sectionLabelRowId,
                    type: 'section-label' as any,
                    label: sectionSource.title,
                    indent: 0,
                    span: 'all' as any,
                    emphasis: 'section' as any,
                    showTotal: false,
                    showDisaggregation: false,
                });
            }

            // Preserve the user's row ORDER: walk the existing rows in their
            // current arrangement and keep the ones that still belong, so
            // moves/drops and indents survive the refresh.
            for (const row of existingRows) {
                if (newIndicatorIds.has(row.id)) {
                    mergedRows.push({ ...row }); // existing indicator - keep customizations in place
                    continue;
                }
                if (row.type === 'indicator') {
                    continue; // indicator was removed from the section source - drop it
                }
                mergedRows.push({ ...row }); // section label / custom rows keep their position
            }

            // Place indicators that are new to the design next to their
            // source-order neighbours: the section config only carries a flat
            // sortOrder (no parent info), so the closest anchor available is
            // the preceding sibling indicator that already exists in the
            // design. The new row inherits the anchor's indent and is inserted
            // after the anchor's indented block, i.e. as its next sibling.
            const placedIds = new Set(mergedRows.map((r) => r.id));

            sectionSource.indicators.forEach((indicator, idx) => {
                if (placedIds.has(indicator.id)) return;

                const newRow: DesignRow = {
                    id: indicator.id,
                    type: 'indicator' as const,
                    code: indicator.code,
                    label: `${indicator.code}. ${indicator.name}`,
                    indent: 1,
                    keyPattern: '{code}_{age}_{sex}',
                    dims: {},
                    showTotal: true,
                    showDisaggregation: true,
                    span: 'label-only' as any,
                    emphasis: 'normal' as any,
                };

                let inserted = false;
                // Backward: insert after the nearest preceding placed sibling
                // (and its indented children), i.e. as its next sibling
                for (let k = idx - 1; k >= 0 && !inserted; k--) {
                    const anchorId = sectionSource.indicators[k].id;
                    if (!placedIds.has(anchorId)) continue;

                    const anchorIdx = mergedRows.findIndex((r) => r.id === anchorId);
                    if (anchorIdx < 0) break;

                    const anchor = mergedRows[anchorIdx];
                    const anchorIndent = anchor.indent ?? 0;
                    newRow.indent = anchorIndent;

                    let insertIdx = anchorIdx + 1;
                    while (
                        insertIdx < mergedRows.length &&
                        (mergedRows[insertIdx].indent ?? 0) > anchorIndent
                    ) {
                        insertIdx++;
                    }
                    mergedRows.splice(insertIdx, 0, newRow);
                    inserted = true;
                }

                // Forward: nothing placed precedes it in the source — insert
                // before the nearest following placed sibling instead, so a
                // new first-of-section lands at the top rather than the bottom
                for (let k = idx + 1; k < sectionSource.indicators.length && !inserted; k++) {
                    const anchorId = sectionSource.indicators[k].id;
                    if (!placedIds.has(anchorId)) continue;

                    const anchorIdx = mergedRows.findIndex((r) => r.id === anchorId);
                    if (anchorIdx < 0) break;

                    newRow.indent = mergedRows[anchorIdx].indent ?? 1;
                    mergedRows.splice(anchorIdx, 0, newRow);
                    inserted = true;
                }

                if (!inserted) {
                    mergedRows.push(newRow);
                }
                placedIds.add(indicator.id);
            });

            // Update group title but preserve other properties
            mergedGroups.push({
                ...existingGroup,
                title: sectionSource.title,
                rows: withDerivedGroupingParents(mergedRows),
            });
        } else {
            // New group - build from section source
            const newGroupRows = [
                {
                    id: `${sectionSource.sectionUuid}__section_label`,
                    type: 'section-label' as any,
                    label: sectionSource.title,
                    indent: 0,
                    span: 'all' as any,
                    emphasis: 'section' as any,
                    showTotal: false,
                    showDisaggregation: false,
                },
                ...sectionSource.indicators.map((i) => ({
                    id: i.id,
                    type: 'indicator' as const,
                    code: i.code,
                    label: `${i.code}. ${i.name}`,
                    indent: 1,
                    keyPattern: '{code}_{age}_{sex}',
                    dims: {},
                    showTotal: true,
                    showDisaggregation: true,
                    span: 'label-only' as any,
                    emphasis: 'normal' as any,
                })),
            ];

            mergedGroups.push({
                id: sectionSource.sectionUuid,
                title: sectionSource.title,
                rows: withDerivedGroupingParents(newGroupRows),
            });
        }
    }

    // Preserve any additional custom groups that aren't in the new section sources
    // (e.g., groups the user manually created)
    for (const [groupId, group] of existingGroupsMap) {
        if (!newSectionUuids.has(groupId)) {
            // This is a custom group - preserve it
            mergedGroups.push({
                ...group,
                rows: withDerivedGroupingParents(group.rows.map((row) => ({ ...row }))),
            });
        }
    }

    return {
        version: previous.version,
        template: previous.template,
        arrayName: previous.arrayName,
        defaultValue: previous.defaultValue,
        dimensions: previous.dimensions || {},
        groups: mergedGroups,
    };
}

function buildMappingPreview(groups: DesignGroup[]) {
    const columns = ['Age <5 | Male', 'Age <5 | Female', '5-14 | Male', '5-14 | Female'];

    const rows = groups.flatMap((group) =>
        group.rows.map((r) => ({
            id: r.id,
            type: r.type,
            code: (r as any).code,
            label: r.label || r.code || 'Untitled row',
            values:
                r.type === ('section-label' as any) || r.type === ('group-label' as any)
                    ? []
                    : columns.map(() => 0),
            indent: r.indent ?? 0,
            groupId: group.id,
        })),
    );

    return { columns, rows };
}

const ReportDesignEditor: React.FC<Props> = ({
                                                 value,
                                                 onChange,
                                                 definitionDraft,
                                                 sectionSources = [],
                                             }) => {
    const { t } = useTranslation();

    const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
    const [selectedRowId, setSelectedRowId] = React.useState<string | null>(null);
    const [dragState, setDragState] = React.useState<DragState>(null);
    const [dropTarget, setDropTarget] = React.useState<DropTarget>(null);
    const [propTab, setPropTab] = React.useState<'details' | 'disaggregation' | 'mapping' | 'api'>('details');

    const draft = React.useMemo<ReportDesignDraft>(
        () => value ?? createEmptyReportDesignDraft(),
        [value],
    );

    const setDraft = React.useCallback(
        (next: ReportDesignDraft) => {
            onChange?.(next);
        },
        [onChange],
    );

    const groups = React.useMemo(() => draft.groups ?? [], [draft.groups]);

    React.useEffect(() => {
        if (!selectedGroupId && groups.length > 0) {
            setSelectedGroupId(groups[0].id);
        }
    }, [groups, selectedGroupId]);

    const selectedRow = React.useMemo(
        () =>
            groups
                .flatMap((g) => g.rows)
                .find((r) => r.id === selectedRowId) ?? null,
        [groups, selectedRowId],
    );

    const updateGroups = React.useCallback(
        (nextGroups: DesignGroup[]) => {
            setDraft({
                ...draft,
                // Single choke point: every row mutation funnels through here,
                // so derived parents are recomputed after every change.
                groups: nextGroups.map((g) => ({ ...g, rows: withDerivedGroupingParents(g.rows) })),
            });
        },
        [draft, setDraft],
    );

    const updateRow = React.useCallback(
        (groupId: string, rowId: string, patch: Partial<DesignRow>) => {
            updateGroups(
                groups.map((g) => {
                    if (g.id !== groupId) return g;

                    const rows = g.rows.map((r) => {
                        if (r.id !== rowId) return r;
                        const next = { ...r, ...patch };
                        return {
                            ...next,
                            indent: clampIndentForRowType(next.indent, next.type),
                        };
                    });

                    return { ...g, rows };
                }),
            );
        },
        [groups, updateGroups],
    );

    const addRowToGroup = React.useCallback(
        (groupId: string) => {
            const row = createEmptyDesignRow();
            row.indent = 1;

            updateGroups(
                groups.map((g) =>
                    g.id === groupId
                        ? { ...g, rows: [...g.rows, row] }
                        : g,
                ),
            );
            setSelectedGroupId(groupId);
            setSelectedRowId(row.id);
        },
        [groups, updateGroups],
    );

    const removeRow = React.useCallback(
        (groupId: string, rowId: string) => {
            updateGroups(
                groups.map((g) =>
                    g.id === groupId
                        ? { ...g, rows: g.rows.filter((r) => r.id !== rowId) }
                        : g,
                ),
            );

            if (selectedRowId === rowId) {
                setSelectedRowId(null);
            }
        },
        [groups, selectedRowId, updateGroups],
    );

    const moveRow = React.useCallback(
        (groupId: string, rowId: string, dir: -1 | 1) => {
            const group = groups.find((g) => g.id === groupId);
            if (!group) return;

            const rows = group.rows.slice();
            const idx = rows.findIndex((r) => r.id === rowId);
            if (idx < 0) return;

            // Move the whole block (the row plus its descendants), swapping
            // with the adjacent sibling block so nesting stays intact.
            const indent = rows[idx].indent ?? 0;
            const end = blockEndIndex(rows, idx);
            const block = rows.slice(idx, end);

            let next: DesignRow[] | null = null;

            if (dir === -1) {
                // Find the start of the previous sibling block (skip its children)
                let p = idx - 1;
                while (p >= 0 && (rows[p].indent ?? 0) > indent) {
                    p--;
                }
                if (p >= 0 && (rows[p].indent ?? 0) === indent) {
                    next = [
                        ...rows.slice(0, p),
                        ...block,
                        ...rows.slice(p, idx),
                        ...rows.slice(end),
                    ];
                }
            } else {
                // Find the end of the next sibling block
                if (end < rows.length && (rows[end].indent ?? 0) >= indent) {
                    const nextEnd = blockEndIndex(rows, end);
                    const nextBlock = rows.slice(end, nextEnd);
                    next = [
                        ...rows.slice(0, idx),
                        ...nextBlock,
                        ...block,
                        ...rows.slice(nextEnd),
                    ];
                }
            }

            if (!next) return; // no sibling to swap with

            updateGroups(
                groups.map((g) =>
                    g.id === groupId ? { ...g, rows: next! } : g,
                ),
            );
        },
        [groups, updateGroups],
    );

    const indentRow = React.useCallback(
        (groupId: string, rowId: string, dir: -1 | 1) => {
            const group = groups.find((g) => g.id === groupId);
            const row = group?.rows.find((r) => r.id === rowId);
            if (!group || !row) return;

            const minIndent = getMinIndentForRowType(row.type);
            const nextIndent = Math.max(minIndent, Math.min(MAX_INDENT, (row.indent ?? minIndent) + dir));

            // Update the row indent
            const rows = group.rows.map((r) =>
                r.id === rowId ? { ...r, indent: nextIndent } : r
            );

            updateGroups(
                groups.map((g) =>
                    g.id === groupId ? { ...g, rows } : g,
                ),
            );
        },
        [groups, updateGroups],
    );

    const generateFromDefinition = React.useCallback(() => {
        const next = buildDesignFromSectionSources(sectionSources, draft);
        setDraft(next);
        setSelectedGroupId(next.groups[0]?.id ?? null);
        setSelectedRowId(next.groups[0]?.rows[0]?.id ?? null);
    }, [draft, sectionSources, setDraft]);

    const refreshFromDefinition = React.useCallback(() => {
        const next = buildDesignFromSectionSourcesWithMerge(sectionSources, draft);
        setDraft(next);
        // Keep current selection if possible, otherwise select first
        const stillSelected = next.groups.find((g) => g.id === selectedGroupId);
        if (stillSelected) {
            const rowStillExists = stillSelected.rows.find((r) => r.id === selectedRowId);
            if (rowStillExists) {
                // Both group and row still exist, keep selection
                return;
            }
            // Group exists but row doesn't, select first row in group
            setSelectedRowId(stillSelected.rows[0]?.id ?? null);
        } else {
            // Group doesn't exist, select first group and row
            setSelectedGroupId(next.groups[0]?.id ?? null);
            setSelectedRowId(next.groups[0]?.rows[0]?.id ?? null);
        }
    }, [draft, sectionSources, setDraft, selectedGroupId, selectedRowId]);

    const handleDragStart = React.useCallback((rowId: string, fromGroupId: string) => {
        setDragState({ rowId, fromGroupId });
    }, []);

    const handleDropOnRow = React.useCallback(
        (targetGroupId: string, targetRowId: string, dropPosition: 'before' | 'after') => {
            const state = dragState;
            setDragState(null);
            setDropTarget(null);

            if (!state) return;
            if (state.fromGroupId !== targetGroupId) return;
            if (state.rowId === targetRowId) return;

            const group = groups.find((g) => g.id === targetGroupId);
            if (!group) return;

            const rows = group.rows.slice();
            const fromIdx = rows.findIndex((r) => r.id === state.rowId);
            const targetIdx = rows.findIndex((r) => r.id === targetRowId);

            if (fromIdx < 0 || targetIdx < 0) return;

            // Move the dragged row together with its descendants (a dragged
            // group label carries its children with it).
            const blockEnd = blockEndIndex(rows, fromIdx);
            if (targetIdx >= fromIdx && targetIdx < blockEnd) return; // can't drop inside own block

            const block = rows.slice(fromIdx, blockEnd);
            const rest = [...rows.slice(0, fromIdx), ...rows.slice(blockEnd)];

            // Insertion point in original indices; adjust for the removed block
            let insertAt = dropPosition === 'before' ? targetIdx : targetIdx + 1;
            if (insertAt >= blockEnd) insertAt -= block.length;
            rest.splice(Math.min(insertAt, rest.length), 0, ...block);

            updateGroups(
                groups.map((g) =>
                    g.id === targetGroupId ? { ...g, rows: rest } : g,
                ),
            );
        },
        [dragState, groups, updateGroups],
    );

    const structureItems = React.useMemo<StructureItem[]>(() => {
        return groups.flatMap((group) => [
            { kind: 'group' as const, group },
            ...group.rows.map((row, rowIndex) => ({
                kind: 'row' as const,
                group,
                row,
                rowIndex,
            })),
        ]);
    }, [groups]);

    const mappingPreview = React.useMemo(() => buildMappingPreview(groups), [groups]);

    // Stringify once per draft change, not on every drag-related re-render
    const draftJson = React.useMemo(() => JSON.stringify(draft, null, 2), [draft]);

    return (
        <div className={styles.designWorkspace}>
            <div style={{ marginBottom: '1rem' }}>
                <h3 className={styles.workspaceTitle}>{t('reportDesign', 'Report Design')}</h3>
                <p className={styles.workspaceHint}>
                    {t(
                        'reportDesignHint',
                        'Design the report structure, indicator presentation, JSON template, and mapping preview.',
                    )}
                </p>
            </div>

            {!definitionDraft ? (
                <InlineNotification
                    kind="warning"
                    lowContrast
                    title="Definition required"
                    subtitle="Build the report definition first so the design can align to it."
                />
            ) : null}

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <Button
                    size="sm"
                    kind="primary"
                    onClick={generateFromDefinition}
                    disabled={!sectionSources.length}
                >
                    Generate From Definition
                </Button>
                <Button
                    size="sm"
                    kind="secondary"
                    onClick={refreshFromDefinition}
                    disabled={!sectionSources.length}
                    renderIcon={Renew}
                >
                    Refresh from Definition
                </Button>
            </div>

            <div
                style={{
                    border: '1px solid var(--cds-border-subtle, #d0d0d0)',
                    borderRadius: 12,
                    padding: '1rem',
                    background: '#fff',
                }}
            >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: '1rem' }}>
                        <div
                            style={{
                                border: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                borderRadius: 10,
                                padding: '1rem',
                                background: 'var(--cds-layer, #f4f4f4)',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Template Structure</div>
                                <Button kind="ghost" size="sm" renderIcon={Renew} onClick={generateFromDefinition}>
                                    Refresh JSON
                                </Button>
                            </div>

                            <div
                                style={{
                                    minHeight: '12rem',
                                    border: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                    borderRadius: 8,
                                    background: '#fff',
                                    padding: '0.5rem',
                                    overflow: 'auto',
                                }}
                            >
                                {structureItems.length === 0 ? (
                                    <div style={{ opacity: 0.7 }}>No sections/rows yet. Generate from definition.</div>
                                ) : (
                                    structureItems.map((item) => {
                                        if (item.kind === 'group') {
                                            return null;
                                        }

                                        const { group, row, rowIndex } = item;
                                        const isSelected = row.id === selectedRowId;
                                        const isDropTarget = dropTarget?.rowId === row.id;
                                        const dropEdge = isDropTarget ? dropTarget!.position : null;

                                        const isSectionLabel = row.type === ('section-label' as any);
                                        const isGroupLabel = row.type === ('group-label' as any);

                                        return (
                                            <div
                                                key={row.id}
                                                draggable
                                                onDragStart={() => handleDragStart(row.id, group.id)}
                                                onDragEnd={() => {
                                                    setDragState(null);
                                                    setDropTarget(null);
                                                }}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    // No drop indicator inside the dragged row's own
                                                    // block — a group can't be dropped into itself
                                                    if (dragState && dragState.fromGroupId === group.id) {
                                                        const fromIdx = group.rows.findIndex((r) => r.id === dragState.rowId);
                                                        if (fromIdx >= 0) {
                                                            const blockEnd = blockEndIndex(group.rows, fromIdx);
                                                            const targetIdx = group.rows.findIndex((r) => r.id === row.id);
                                                            if (targetIdx >= fromIdx && targetIdx < blockEnd) {
                                                                setDropTarget(null);
                                                                return;
                                                            }
                                                        }
                                                    }
                                                    // Decide above/below the target from the cursor's half of the row
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    const after = e.clientY - rect.top > rect.height / 2;
                                                    const position = after ? 'after' as const : 'before' as const;
                                                    setDropTarget((prev) =>
                                                        prev && prev.rowId === row.id && prev.position === position
                                                            ? prev
                                                            : { rowId: row.id, position },
                                                    );
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    handleDropOnRow(group.id, row.id, dropTarget?.rowId === row.id ? dropTarget.position : 'before');
                                                }}
                                                onClick={() => {
                                                    setSelectedGroupId(group.id);
                                                    setSelectedRowId(row.id);
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.65rem 0.75rem',
                                                    marginBottom: '0.35rem',
                                                    marginLeft: `${(row.indent ?? 0) * 18}px`,
                                                    borderRadius: 6,
                                                    border: isSelected
                                                        ? '2px solid var(--cds-border-interactive, #0f62fe)'
                                                        : '1px solid transparent',
                                                    boxShadow: dropEdge
                                                        ? dropEdge === 'before'
                                                            ? 'inset 0 2px 0 var(--cds-border-interactive, #0f62fe)'
                                                            : 'inset 0 -2px 0 var(--cds-border-interactive, #0f62fe)'
                                                        : undefined,
                                                    background: isSelected ? 'var(--cds-layer-selected, #e8f1ff)' : 'transparent',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                <Draggable size={16} />
                                                <span
                                                    style={{
                                                        fontWeight: isSectionLabel ? 700 : isGroupLabel ? 600 : 500,
                                                    }}
                                                >
                          {row.label || row.code || 'Untitled row'}
                        </span>

                                                <Tag
                                                    size="sm"
                                                    type={
                                                        isSectionLabel
                                                            ? 'purple'
                                                            : isGroupLabel
                                                                ? 'cyan'
                                                                : 'gray'
                                                    }
                                                >
                                                    {isSectionLabel
                                                        ? 'section'
                                                        : isGroupLabel
                                                            ? 'group'
                                                            : row.code || row.type}
                                                </Tag>

                                                {isSectionLabel ? (
                                                    <Button
                                                        size="sm"
                                                        kind="ghost"
                                                        renderIcon={Add}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            addRowToGroup(group.id);
                                                        }}
                                                    >
                                                        Add Node
                                                    </Button>
                                                ) : null}

                                                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                                                    <Button
                                                        kind="ghost"
                                                        size="sm"
                                                        hasIconOnly
                                                        iconDescription="Move up"
                                                        renderIcon={ArrowUp}
                                                        disabled={rowIndex === 0}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            moveRow(group.id, row.id, -1);
                                                        }}
                                                    />
                                                    <Button
                                                        kind="ghost"
                                                        size="sm"
                                                        hasIconOnly
                                                        iconDescription="Move down"
                                                        renderIcon={ArrowDown}
                                                        disabled={rowIndex === group.rows.length - 1}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            moveRow(group.id, row.id, 1);
                                                        }}
                                                    />
                                                    <Button
                                                        kind="ghost"
                                                        size="sm"
                                                        hasIconOnly
                                                        iconDescription="Indent"
                                                        renderIcon={ArrowRight}
                                                        disabled={(row.indent ?? getMinIndentForRowType(row.type)) >= MAX_INDENT}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            indentRow(group.id, row.id, 1);
                                                        }}
                                                    />
                                                    <Button
                                                        kind="ghost"
                                                        size="sm"
                                                        hasIconOnly
                                                        iconDescription="Outdent"
                                                        renderIcon={ArrowLeft}
                                                        disabled={(row.indent ?? getMinIndentForRowType(row.type)) <= getMinIndentForRowType(row.type)}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            indentRow(group.id, row.id, -1);
                                                        }}
                                                    />
                                                    <Button
                                                        kind="ghost"
                                                        size="sm"
                                                        hasIconOnly
                                                        iconDescription="Remove"
                                                        renderIcon={TrashCan}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeRow(group.id, row.id);
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        <div
                            style={{
                                border: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                borderRadius: 10,
                                padding: '1rem',
                                background: '#fff',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>JSON Preview</div>
                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                    <Button kind="ghost" hasIconOnly size="sm" iconDescription="Refresh" renderIcon={Renew} />
                                    <Button kind="ghost" hasIconOnly size="sm" iconDescription="Copy" renderIcon={Copy} />
                                    <Button kind="ghost" hasIconOnly size="sm" iconDescription="Download" renderIcon={Download} />
                                    <Button kind="ghost" hasIconOnly size="sm" iconDescription="Expand" renderIcon={Launch} />
                                </div>
                            </div>

                            <pre
                                style={{
                                    margin: 0,
                                    minHeight: '16rem',
                                    maxHeight: '22rem',
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontSize: '0.85rem',
                                    background: '#f8f8f8',
                                    border: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                    borderRadius: 8,
                                    padding: '0.75rem',
                                }}
                            >
                {draftJson}
              </pre>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: '1rem' }}>
                        <div
                            style={{
                                border: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                borderRadius: 10,
                                padding: '1rem',
                                background: 'var(--cds-layer, #f4f4f4)',
                            }}
                        >
                            <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Indicator Properties</div>
                            <div style={{ opacity: 0.8, marginBottom: '0.75rem' }}>
                                Select an indicator/row to edit properties
                            </div>

                            <Tabs
                                selectedIndex={
                                    propTab === 'details' ? 0 : propTab === 'disaggregation' ? 1 : propTab === 'mapping' ? 2 : 3
                                }
                                onChange={({ selectedIndex }) =>
                                    setPropTab(selectedIndex === 0 ? 'details' : selectedIndex === 1 ? 'disaggregation' : selectedIndex === 2 ? 'mapping' : 'api')
                                }
                            >
                                <TabList aria-label="Indicator properties tabs">
                                    <Tab>Details</Tab>
                                    <Tab>Disaggregation</Tab>
                                    <Tab>Mapping</Tab>
                                    <Tab>API</Tab>
                                </TabList>
                            </Tabs>

                            <div style={{ marginTop: '1rem' }}>
                                {!selectedRow || !selectedGroupId ? (
                                    <div style={{ opacity: 0.7 }}>Select a node to edit.</div>
                                ) : propTab === 'details' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <TextInput
                                            id="design-row-label"
                                            labelText="Label"
                                            value={selectedRow.label}
                                            onChange={(e) =>
                                                updateRow(selectedGroupId, selectedRow.id, { label: (e.target as HTMLInputElement).value })
                                            }
                                        />
                                        <TextInput
                                            id="design-row-code"
                                            labelText="Code"
                                            value={selectedRow.code ?? ''}
                                            onChange={(e) =>
                                                updateRow(selectedGroupId, selectedRow.id, { code: (e.target as HTMLInputElement).value })
                                            }
                                        />
                                        <Select
                                            id="design-row-type"
                                            labelText="Row type"
                                            value={selectedRow.type}
                                            onChange={(e) => {
                                                const nextType = (e.target as HTMLSelectElement).value;
                                                const nextRow = applyRowTypeDefaults(selectedRow, nextType);
                                                updateRow(selectedGroupId, selectedRow.id, nextRow);
                                            }}
                                        >
                                            <SelectItem value="section-label" text="Section Label" />
                                            <SelectItem value="group-label" text="Group Label" />
                                            <SelectItem value="indicator" text="Indicator" />
                                            <SelectItem value="label" text="Label" />
                                            <SelectItem value="spacer" text="Spacer" />
                                        </Select>
                                        <NumberInput
                                            id="design-row-indent"
                                            label="Indent"
                                            min={getMinIndentForRowType(selectedRow.type)}
                                            max={MAX_INDENT}
                                            value={selectedRow.indent ?? getMinIndentForRowType(selectedRow.type)}
                                            onChange={(e) => {
                                                const next = Number((e.target as HTMLInputElement).value || getMinIndentForRowType(selectedRow.type));
                                                updateRow(selectedGroupId, selectedRow.id, {
                                                    indent: clampIndentForRowType(next, selectedRow.type),
                                                });
                                            }}
                                        />
                                    </div>
                                ) : propTab === 'disaggregation' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <Checkbox
                                            id="design-row-total"
                                            labelText="Show total"
                                            checked={Boolean(selectedRow.showTotal)}
                                            onChange={(checked) =>
                                                updateRow(selectedGroupId, selectedRow.id, { showTotal: Boolean(checked) })
                                            }
                                        />
                                        <Checkbox
                                            id="design-row-disagg"
                                            labelText="Show disaggregation"
                                            checked={Boolean(selectedRow.showDisaggregation)}
                                            onChange={(checked) =>
                                                updateRow(selectedGroupId, selectedRow.id, { showDisaggregation: Boolean(checked) })
                                            }
                                        />
                                    </div>
                                ) : propTab === 'mapping' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <TextInput
                                            id="design-row-key-pattern"
                                            labelText="Key pattern"
                                            value={selectedRow.keyPattern ?? ''}
                                            onChange={(e) =>
                                                updateRow(selectedGroupId, selectedRow.id, { keyPattern: (e.target as HTMLInputElement).value })
                                            }
                                        />
                                        <div style={{ opacity: 0.8, fontSize: '0.875rem' }}>
                                            Example: {'{code}_{age}_{sex}'}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ opacity: 0.8, fontSize: '0.875rem' }}>
                                        Node API preview and compile-time bindings will appear here.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div
                            style={{
                                border: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                borderRadius: 10,
                                padding: '1rem',
                                background: 'var(--cds-layer, #f4f4f4)',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Mapping Preview</div>
                                <View size={18} />
                            </div>

                            <div
                                style={{
                                    border: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    background: '#fff',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: `minmax(220px, 1.3fr) repeat(${mappingPreview.columns.length}, minmax(120px, 1fr))`,
                                        borderBottom: '1px solid var(--cds-border-subtle, #e0e0e0)',
                                        fontWeight: 600,
                                        background: '#fafafa',
                                    }}
                                >
                                    <div style={{ padding: '0.75rem' }} />
                                    {mappingPreview.columns.map((c) => (
                                        <div key={c} style={{ padding: '0.75rem' }}>
                                            {c}
                                        </div>
                                    ))}
                                </div>

                                {mappingPreview.rows.length === 0 ? (
                                    <div style={{ padding: '1rem', opacity: 0.7 }}>No rows to preview.</div>
                                ) : (
                                    mappingPreview.rows.map((row: any) =>
                                        row.type === 'section-label' ? (
                                            <div
                                                key={row.id}
                                                style={{
                                                    borderTop: '1px solid var(--cds-border-subtle, #f0f0f0)',
                                                    background: 'var(--cds-layer-accent, #f4f4f4)',
                                                    fontWeight: 700,
                                                    padding: '0.85rem 0.75rem',
                                                }}
                                            >
                                                {row.label}
                                            </div>
                                        ) : row.type === 'group-label' ? (
                                            <div
                                                key={row.id}
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: `minmax(220px, 1.3fr) repeat(${mappingPreview.columns.length}, minmax(120px, 1fr))`,
                                                    borderTop: '1px solid var(--cds-border-subtle, #f0f0f0)',
                                                    background: '#fafafa',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        padding: '0.75rem',
                                                        fontWeight: 600,
                                                        paddingLeft: `${12 + row.indent * 18}px`,
                                                    }}
                                                >
                                                    {row.code ? `${row.code} ${row.label}` : row.label}
                                                </div>
                                                {mappingPreview.columns.map((_: any, idx: number) => (
                                                    <div key={idx} style={{ padding: '0.75rem' }} />
                                                ))}
                                            </div>
                                        ) : (
                                            <div
                                                key={row.id}
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: `minmax(220px, 1.3fr) repeat(${mappingPreview.columns.length}, minmax(120px, 1fr))`,
                                                    borderTop: '1px solid var(--cds-border-subtle, #f0f0f0)',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        padding: '0.75rem',
                                                        fontWeight: 600,
                                                        paddingLeft: `${12 + row.indent * 18}px`,
                                                    }}
                                                >
                                                    {row.label}
                                                </div>
                                                {row.values.map((v: any, idx: number) => (
                                                    <div key={idx} style={{ padding: '0.75rem' }}>
                                                        {v}
                                                    </div>
                                                ))}
                                            </div>
                                        ),
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportDesignEditor;