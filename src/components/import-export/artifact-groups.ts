import type { CarbonIconType } from '@carbon/icons-react';
import {
    Analytics,
    Book,
    ChartBar,
    ColorPalette,
    DataBase,
    Document,
    Folder,
    Group,
    List,
    Settings,
    UserMultiple,
} from '@carbon/icons-react';

import { listAgeCategoriesWithGroups } from '../../resources/agegroup/agegroups.api';
import { listDashboards } from '../../resources/dashboard/dashboard.api';
import { listETLMonitors } from '../../resources/etl-monitor/etl-monitor.api';
import { listETLSources } from '../../resources/etl-source/etl-source.api';
import { listIndicators } from '../../resources/indicator/indicators.api';
import { listLinelistReports } from '../../resources/linelist/linelist-reports.api';
import { listReportCategories } from '../../resources/report-category/report-category.api';
import { listReportLibraries } from '../../resources/report-library/report-library.api';
import { listSections } from '../../resources/report-section/report-sections.api';
import { listReports } from '../../resources/report/reports.api';
import { listThemes } from '../../resources/theme/data-theme.api';

/** Scan state of a single artifact group on the Import / Export page. */
export type ArtifactEntry = {
    /** Number of artifacts found, null while scanning. */
    count: number | null;
    status: 'loading' | 'ready' | 'empty' | 'error';
};

export type ArtifactGroupDef = {
    key: string;
    label: string;
    /** Drives the Type filter and the Artifact Summary panel. */
    kind: 'metadata' | 'reports';
    Icon: CarbonIconType;
    /** Resolves how many artifacts exist for this group (existing list APIs). */
    count: (signal?: AbortSignal) => Promise<number>;
    /** Page that manages this group's artifacts. */
    path: string;
};

const countOf =
    (fn: (signal?: AbortSignal) => Promise<unknown[]>) =>
    (signal?: AbortSignal) =>
        fn(signal).then((items) => items.length);

export const ARTIFACT_GROUPS: ArtifactGroupDef[] = [
    {
        key: 'ageCategories',
        label: 'Age Categories',
        kind: 'metadata',
        Icon: Group,
        count: countOf(listAgeCategoriesWithGroups),
        path: '/admin/age-categories',
    },
    {
        key: 'ageGroups',
        label: 'Age Groups',
        kind: 'metadata',
        Icon: UserMultiple,
        count: (signal) =>
            listAgeCategoriesWithGroups(signal).then((categories) =>
                categories.reduce((sum, category) => sum + (category.ageGroups?.length ?? 0), 0),
            ),
        path: '/admin/age-groups',
    },
    {
        key: 'categories',
        label: 'Categories',
        kind: 'metadata',
        Icon: Folder,
        count: countOf((signal) => listReportCategories(undefined, signal)),
        path: '/admin/report-categories',
    },
    {
        key: 'dashboards',
        label: 'Dashboards',
        kind: 'metadata',
        Icon: ChartBar,
        count: countOf((signal) => listDashboards(undefined, signal)),
        path: '/admin/dashboards',
    },
    {
        key: 'etlMonitors',
        label: 'ETL Monitors',
        kind: 'metadata',
        Icon: Settings,
        count: countOf((signal) => listETLMonitors(undefined, signal)),
        path: '/admin/etl-monitors',
    },
    {
        key: 'etlSources',
        label: 'ETL Sources',
        kind: 'metadata',
        Icon: DataBase,
        count: countOf((signal) => listETLSources(undefined, signal)),
        path: '/admin/etl-sources',
    },
    {
        key: 'indicators',
        label: 'Indicators',
        kind: 'metadata',
        Icon: Analytics,
        count: countOf((signal) => listIndicators(undefined, signal)),
        path: '/indicators',
    },
    {
        key: 'library',
        label: 'Library',
        kind: 'metadata',
        Icon: Book,
        count: countOf((signal) => listReportLibraries(undefined, signal)),
        path: '/admin/report-library',
    },
    {
        key: 'sections',
        label: 'Sections',
        kind: 'metadata',
        Icon: List,
        count: countOf((signal) => listSections(undefined, signal)),
        path: '/sections',
    },
    {
        key: 'themes',
        label: 'Themes',
        kind: 'metadata',
        Icon: ColorPalette,
        count: countOf((signal) => listThemes(undefined, signal)),
        path: '/admin/themes',
    },
    // Reports
    {
        key: 'aggregateReports',
        label: 'Aggregate Reports',
        kind: 'reports',
        Icon: Document,
        count: countOf((signal) => listReports(undefined, signal)),
        path: '/reports',
    },
    {
        key: 'linelistReports',
        label: 'Line-list Reports',
        kind: 'reports',
        Icon: Document,
        count: countOf((signal) => listLinelistReports(undefined, signal)),
        path: '/linelist',
    },
];
