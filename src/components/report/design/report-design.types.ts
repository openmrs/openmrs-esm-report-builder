export type DesignDimensionOption = {
    id: string;
    label: string;
};

export type DesignDimension = {
    id: string;
    label: string;
    options: DesignDimensionOption[];
};

export type DesignRowType = 'section-label' | 'group-label' | 'indicator' | 'label' | 'spacer';

export type DesignRow = {
    id: string;
    type: DesignRowType;
    code?: string;
    label: string;
    indent: number;
    keyPattern?: string;
    dims?: Record<string, string | undefined>;
    showTotal?: boolean;
    showDisaggregation?: boolean;

    // presentation hints
    span?: 'all' | 'label-only';
    emphasis?: 'section' | 'group' | 'normal' | 'summary';

    /**
     * Derived, not hand-edited: recomputed from row order + indent whenever
     * rows change (see withDerivedGroupingParents). Points at the nearest
     * enclosing group-label row (groups may nest); rows belonging directly
     * to the section have no groupingParentId. Not read by the backend
     * compiler — layout is driven by array order + indent.
     */
    groupingParentId?: string;
};

export type DesignGroup = {
    id: string;
    title: string;
    rows: DesignRow[];
};

export type ReportDesignDraft = {
    version: 1;
    template: 'section-tabular';
    arrayName: string;
    defaultValue: number;
    dimensions: Record<string, DesignDimension>;
    groups: DesignGroup[];
};