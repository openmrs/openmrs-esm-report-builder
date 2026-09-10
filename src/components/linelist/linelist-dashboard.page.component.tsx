/**
 * Linelist Reports Page
 *
 * Page for managing linelist (patient list) reports.
 * Provides a list view of existing linelist reports with filters and actions.
 * Follows design spec section 4: Screen 1 — Linelist report list.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tile,
  ButtonSet,
  InlineNotification,
  Tag,
  Search,
  Select,
  SelectItem,
  OverflowMenu,
  OverflowMenuItem,
  Pagination,
  Grid,
  Column,
  Checkbox,
  ProgressBar,
  Modal,
  ModalBody,
} from '@carbon/react';
import { Add, Document, Renew, Download, Play } from '@carbon/react/icons';
import { useNavigate } from 'react-router-dom';

import {
  listLinelistReports,
  deleteLinelistReport,
  compileLinelistReport,
  type LinelistReportDefinitionDto,
  parseLinelistConfig,
} from '../../resources/linelist/linelist-reports.api';
import { listReportCategories, type ReportCategoryDto } from '../../resources/report-category/report-category.api';
import { RB } from '../../constants/privileges';
import { useReportBuilderPrivileges } from '../../hooks/use-report-builder-privileges';
import { listDataThemes, type DataThemeDto } from '../../resources/theme/data-theme.api';
import type { LinelistRowGrain } from '../../types/linelist-types';

import Header from '../shared/header/header.component';
import styles from './linelist-dashboard.page.scss';

type Props = {};

type ReportStatus = 'all' | 'active' | 'retired';
type SortBy = 'name' | 'dateCreated' | 'dateModified' | 'category';

interface ReportWithMetadata extends LinelistReportDefinitionDto {
  parsedConfig?: {
    categoryUuid?: string;
    themeUuid?: string;
    dataSourceUuid?: string;
    rowGrain?: LinelistRowGrain;
  } | null;
  categoryName?: string;
  themeName?: string;
  dataSourceName?: string;
  rowGrainLabel?: string;
}

const LinelistReportsPage: React.FC<Props> = () => {
  const { has: hasPrivilege } = useReportBuilderPrivileges();
  const canCreateLinelist = hasPrivilege(RB.REPORT_ADD, RB.REPORT_EDIT);
  const navigate = useNavigate();

  const [reports, setReports] = useState<ReportWithMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filters
  const [statusFilter] = useState<ReportStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [rowTypeFilter, setRowTypeFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortBy>('dateModified');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reference data
  const [categories, setCategories] = useState<ReportCategoryDto[]>([]);
  const [themes, setThemes] = useState<DataThemeDto[]>([]);

  // Selection state
  const [selectedReports, setSelectedReports] = useState<Set<string>>(new Set());

  // Bulk compile state
  const [compiling, setCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  const [compileResults, setCompileResults] = useState<Array<{ name: string; success: boolean; error?: string }>>([]);
  const [showCompileResults, setShowCompileResults] = useState(false);

  // Category selection modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  /**
   * Fetch reference data (categories, themes)
   */
  useEffect(() => {
    const loadReferenceData = async () => {
      try {
        const [cats, thms] = await Promise.all([
          listReportCategories(),
          listDataThemes(),
        ]);
        setCategories(cats);
        setThemes(thms);
      } catch (err) {
        console.error('Failed to load reference data:', err);
      }
    };
    loadReferenceData();
  }, []);

  /**
   * Fetch linelist reports
   */
  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await listLinelistReports({ includeRetired: statusFilter !== 'active' });

      // Augment reports with metadata from config
      const reportsWithMetadata: ReportWithMetadata[] = data.map((report) => {
        const config = parseLinelistConfig(report);
        const category = categories.find((c) => c.uuid === config?.categoryUuid);
        const theme = themes.find((t) => t.uuid === config?.themeUuid);

        return {
          ...report,
          parsedConfig: config,
          categoryName: category?.name,
          themeName: theme?.name,
          dataSourceName: config?.dataSourceUuid || '-',
          rowGrainLabel: config?.rowGrain?.replace('_', ' ') || '-',
        };
      });

      setReports(reportsWithMetadata);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load linelist reports');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categories, themes]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  /**
   * Handle delete confirmation
   */
  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    try {
      await deleteLinelistReport(deleteConfirm);
      setDeleteConfirm(null);
      fetchReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete report');
    }
  }, [deleteConfirm, fetchReports]);

  /**
   * Handle duplicate report
   */
  const handleDuplicate = useCallback((report: ReportWithMetadata) => {
    // Navigate to edit page with a copy flag
    navigate(`/linelist/new?duplicate=${report.uuid}`);
  }, [navigate]);

  /**
   * Handle export definition
   */
  const handleExport = useCallback((report: ReportWithMetadata) => {
    const config = parseLinelistConfig(report);
    const exportData = {
      name: report.name,
      description: report.description,
      code: report.code,
      config,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.name?.replace(/[^a-z0-9]/gi, '_') || 'linelist'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /**
   * Handle individual report selection
   */
  const handleSelectReport = useCallback((reportUuid: string) => {
    setSelectedReports(prev => {
      const newSet = new Set(prev);
      if (newSet.has(reportUuid)) {
        newSet.delete(reportUuid);
      } else {
        newSet.add(reportUuid);
      }
      return newSet;
    });
  }, []);

  /**
   * Handle bulk compile selected reports
   */
  const handleBulkCompile = useCallback(() => {
    if (selectedReports.size === 0) return;
    // Show category selection modal
    setShowCategoryModal(true);
    setSelectedCategory('');
  }, [selectedReports.size]);

  /**
   * Confirm and execute bulk compile with selected category
   */
  const handleConfirmBulkCompile = useCallback(async () => {
    // Validate category selection
    if (!selectedCategory || selectedCategory.trim() === '') {
      alert('Please select a report category before compiling.');
      return;
    }

    setShowCategoryModal(false);
    setCompiling(true);
    setCompileProgress(0);
    setCompileResults([]);
    setShowCompileResults(false);

    const reportsToCompile = reports.filter(r => selectedReports.has(r.uuid));
    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < reportsToCompile.length; i++) {
      const report = reportsToCompile[i];
      try {
        const result = await compileLinelistReport(report.uuid, selectedCategory);
        results.push({
          name: report.name || 'Unknown',
          success: !!result.compiled,
          error: !result.compiled ? 'Failed to compile' : undefined,
        });
      } catch (err) {
        results.push({
          name: report.name || 'Unknown',
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
      setCompileProgress(((i + 1) / reportsToCompile.length) * 100);
    }

    setCompileResults(results);
    setShowCompileResults(true);
    setCompiling(false);
    setSelectedReports(new Set());
  }, [selectedReports, reports, selectedCategory]);

  /**
   * Get row grain label
   */
  const getRowGrainLabel = (grain?: LinelistRowGrain): string => {
    const labels: Record<LinelistRowGrain, string> = {
      PATIENT: 'Patient',
      ENCOUNTER: 'Encounter',
      OBSERVATION: 'Observation',
      PROGRAM_ENROLLMENT: 'Enrollment',
      APPOINTMENT: 'Appointment',
      ORDER: 'Order',
    };
    return grain ? labels[grain] || grain : '-';
  };

  /**
   * Filter and sort reports
   */
  const filteredAndSortedReports = useMemo(() => {
    let filtered = [...reports];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((report) =>
        report.name?.toLowerCase().includes(query) ||
        report.code?.toLowerCase().includes(query) ||
        report.description?.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter === 'active') {
      filtered = filtered.filter((report) => !report.retired);
    } else if (statusFilter === 'retired') {
      filtered = filtered.filter((report) => report.retired);
    }

    // Apply category filter
    if (categoryFilter) {
      filtered = filtered.filter((report) =>
        report.parsedConfig?.categoryUuid === categoryFilter
      );
    }

    // Apply row type filter
    if (rowTypeFilter && rowTypeFilter !== 'all') {
      filtered = filtered.filter((report) =>
        report.parsedConfig?.rowGrain === rowTypeFilter
      );
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'category':
          return (a.categoryName || '').localeCompare(b.themeName || '');
        case 'dateModified':
        default:
          // UUIDs are roughly time-ordered
          return (b.uuid || '').localeCompare(a.uuid || '');
      }
    });

    return filtered;
  }, [reports, searchQuery, statusFilter, categoryFilter, rowTypeFilter, sortBy]);

  /**
   * Paginate reports
   */
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedReports.slice(start, start + pageSize);
  }, [filteredAndSortedReports, currentPage, pageSize]);

  /**
   * Handle select all toggle
   */
  const handleSelectAll = useCallback(() => {
    if (selectedReports.size === paginatedReports.length && paginatedReports.length > 0) {
      // Deselect all
      setSelectedReports(new Set());
    } else {
      // Select all current page
      setSelectedReports(new Set(paginatedReports.map(r => r.uuid)));
    }
  }, [selectedReports.size, paginatedReports]);

  /**
   * Get row data for DataTable
   */
  const getRowItems = useCallback(() => {
    return paginatedReports.map((report) => ({
      id: report.uuid,
      uuid: report.uuid,
      select: report.uuid,
      name: report.name,
      code: report.code || '-',
      rowGrain: getRowGrainLabel(report.parsedConfig?.rowGrain),
      category: report.categoryName || '-',
      theme: report.themeName || '-',
      dataSource: report.dataSourceName || '-',
      lastModified: formatDate(),
      actions: report.uuid,
    }));
  }, [paginatedReports]);

  /**
   * Format date for display
   * Note: dateModified is not currently available in the DTO
   * Returns '-' until the API provides date fields
   */
  const formatDate = (): string => {
    // TODO: Implement when dateModified is available in the API response
    return '-';
  };

  const headers = [
    { key: 'select', header: 'Select' },
    { key: 'name', header: 'Name' },
    { key: 'code', header: 'Code' },
    { key: 'category', header: 'Category' },
    { key: 'rowGrain', header: 'One row represents' },
    { key: 'status', header: 'Status' },
    { key: 'lastModified', header: 'Last modified' },
    { key: 'actions', header: 'Actions' },
  ];

  return (
    <Stack gap={5}>
      <Header
        title="Linelist Reports"
        subtitle="Manage and run patient list reports with configurable parameters."
      />

      {error && (
        <InlineNotification
          kind="error"
          title="Error"
          subtitle={error}
          onClose={() => setError(null)}
        />
      )}

      <div className={styles.toolbar}>
        <Grid fullWidth>
          <Column md={12} lg={16}>
            <div className={styles.filterBar}>
              {/* Search */}
              <div className={styles.searchWrapper}>
                <Search
                  labelText=""
                  placeholder="Search reports"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery((e.target as HTMLInputElement).value);
                    setCurrentPage(1);
                  }}
                  size="md"
                />
              </div>

              {/* Filter dropdowns */}
              <div className={styles.filterDropdowns}>
                <Select
                  id="category-filter"
                  labelText=""
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter((e.target as HTMLSelectElement).value);
                    setCurrentPage(1);
                  }}
                  size="md"
                >
                  <SelectItem value="" text="All categories" />
                  {categories.map((cat) => (
                    <SelectItem key={cat.uuid} value={cat.uuid} text={cat.name} />
                  ))}
                </Select>

                <Select
                  id="theme-filter"
                  labelText=""
                  value={rowTypeFilter}
                  onChange={(e) => {
                    setRowTypeFilter((e.target as HTMLSelectElement).value);
                    setCurrentPage(1);
                  }}
                  size="md"
                >
                  <SelectItem value="all" text="All data themes" />
                  {themes.map((theme) => (
                    <SelectItem key={theme.uuid} value={theme.uuid} text={theme.name} />
                  ))}
                </Select>

                <Select
                  id="datasource-filter"
                  labelText=""
                  value={sortBy}
                  onChange={(e) => setSortBy((e.target as HTMLSelectElement).value as SortBy)}
                  size="md"
                >
                  <SelectItem value="all" text="All data sources" />
                  <SelectItem value="dateModified" text="Observation" />
                  <SelectItem value="name" text="Encounter" />
                  <SelectItem value="category" text="Appointment" />
                </Select>
              </div>

              {/* Action buttons */}
              <div className={styles.filterActions}>
                {canCreateLinelist && (
                  <Button
                    kind="ghost"
                    size="md"
                    renderIcon={Add}
                    onClick={() => navigate('/linelist/new')}
                  >
                    Create linelist report
                  </Button>
                )}
                {selectedReports.size > 0 && (
                  <Button
                    kind="primary"
                    size="md"
                    renderIcon={Play}
                    onClick={handleBulkCompile}
                    disabled={compiling}
                  >
                    Compile Selected ({selectedReports.size})
                  </Button>
                )}
                <Button
                  kind="ghost"
                  size="md"
                  renderIcon={Renew}
                  onClick={fetchReports}
                  hasIconOnly
                  iconDescription="Refresh"
                />
                <Button
                  kind="ghost"
                  size="md"
                  renderIcon={Download}
                  onClick={() => {
                    // Export all reports
                    const exportData = filteredAndSortedReports.map((r) => ({
                      name: r.name,
                      code: r.code,
                      config: r.parsedConfig,
                    }));
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'linelist-reports.json';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  hasIconOnly
                  iconDescription="Export"
                />
              </div>
            </div>
          </Column>
        </Grid>
      </div>

      {/* Compile Progress */}
      {compiling && (
        <div className={styles.compileProgress}>
          <div className={styles.compileProgressHeader}>
            <span>Compiling reports...</span>
            <span>{Math.round(compileProgress)}%</span>
          </div>
          <ProgressBar label="" value={compileProgress} />
        </div>
      )}

      {/* Compile Results */}
      {showCompileResults && compileResults.length > 0 && (
        <>
          <InlineNotification
            kind={compileResults.every(r => r.success) ? "success" : compileResults.some(r => r.success) ? "warning" : "error"}
            title="Compile Results"
            subtitle={`${compileResults.filter(r => r.success).length} of ${compileResults.length} reports compiled successfully`}
            onClose={() => setShowCompileResults(false)}
          />
          <div className={styles.compileResults}>
            {compileResults.map((result, idx) => (
              <div key={idx} className={styles.compileResultItem}>
                {result.success ? '✓' : '✗'} {result.name}
                {result.error && <span className={styles.error}> - {result.error}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {loading ? (
        <DataTableSkeleton rowCount={10} columnCount={8} />
      ) : filteredAndSortedReports.length === 0 ? (
        <Tile className={styles.emptyState}>
          <Document size={48} />
          <h3>No Linelist Reports Found</h3>
          <p>
            {searchQuery || statusFilter !== 'all' || categoryFilter || rowTypeFilter !== 'all'
              ? 'No reports match your filters. Try adjusting your search criteria.'
              : 'Get started by creating your first linelist report.'}
          </p>
          {!(searchQuery || statusFilter !== 'all' || categoryFilter || rowTypeFilter !== 'all') &&
            canCreateLinelist && (
              <Button kind="primary" renderIcon={Add} onClick={() => navigate('/linelist/new')}>
                Create Linelist Report
              </Button>
            )}
        </Tile>
      ) : (
        <>
          <DataTable rows={getRowItems()} headers={headers}>
            {({ rows: dtRows, headers, getHeaderProps, getRowProps }) => (
              <TableContainer>
                <Table useZebraStyles>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader key={header.key} {...getHeaderProps({ header })}>
                          {header.key === 'select' ? (
                            <Checkbox
                              id="select-all-reports"
                              checked={selectedReports.size === paginatedReports.length && paginatedReports.length > 0}
                              indeterminate={selectedReports.size > 0 && selectedReports.size < paginatedReports.length}
                              onChange={handleSelectAll}
                              labelText=""
                            />
                          ) : (
                            header.header
                          )}
                        </TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dtRows.map((dtRow) => {
                      const report = paginatedReports.find((r) => r.uuid === dtRow.id);
                      return (
                        <TableRow key={dtRow.id} {...getRowProps({ row: dtRow })}>
                          <TableCell>
                            <Checkbox
                              id={`select-report-${dtRow.id}`}
                              checked={selectedReports.has(dtRow.id)}
                              onChange={() => handleSelectReport(dtRow.id)}
                              labelText=""
                            />
                          </TableCell>
                          <TableCell>
                            {report?.name}
                          </TableCell>
                          <TableCell>{report?.code || '—'}</TableCell>
                          <TableCell>{report?.categoryName || '—'}</TableCell>
                          <TableCell>
                            <Tag type="blue" size="sm">
                              {getRowGrainLabel(report?.parsedConfig?.rowGrain)}
                            </Tag>
                          </TableCell>
                          <TableCell>
                            <Tag type={report?.retired ? 'gray' : 'green'} size="sm">
                              {report?.retired ? 'Retired' : 'Active'}
                            </Tag>
                          </TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>
                            <OverflowMenu flipped>
                              <OverflowMenuItem
                                itemText="Run"
                                onClick={() => navigate(`/linelist/run/${dtRow.id}`)}
                              />
                              <OverflowMenuItem
                                itemText="Edit"
                                onClick={() => navigate(`/linelist/edit/${dtRow.id}`)}
                              />
                              <OverflowMenuItem
                                itemText="Duplicate"
                                onClick={() => report && handleDuplicate(report)}
                              />
                              <OverflowMenuItem
                                itemText="Export"
                                onClick={() => report && handleExport(report)}
                              />
                            </OverflowMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>

          <Pagination
            totalItems={filteredAndSortedReports.length}
            pageSize={pageSize}
            pageSizes={[10, 25, 50]}
            page={currentPage}
            onChange={({ page, pageSize: newSize }) => {
              setCurrentPage(page);
              setPageSize(newSize);
            }}
          />
        </>
      )}

      {/* Category Selection Modal */}
      {showCategoryModal && (
        <Modal
          open={showCategoryModal}
          modalHeading="Compile Reports"
          modalLabel="Select Report Category"
          onRequestClose={() => setShowCategoryModal(false)}
          primaryButtonText="Compile"
          primaryButtonDisabled={!selectedCategory || selectedCategory.trim() === ''}
          onRequestSubmit={handleConfirmBulkCompile}
          secondaryButtonText="Cancel"
          danger={undefined}
        >
          <ModalBody>
            <p className={styles.modalDescription}>
              Select a report category to apply to all {selectedReports.size} selected report(s) during compilation.
            </p>
            <Select
              id="bulk-compile-category"
              labelText="Report Category *"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory((e.target as HTMLSelectElement).value)}
            >
              <SelectItem value="" text="Select a category..." />
              {categories.map((cat) => (
                <SelectItem key={cat.uuid} value={cat.uuid} text={cat.name} />
              ))}
            </Select>
          </ModalBody>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className={styles.deleteModalOverlay}>
          <Tile className={styles.deleteModal}>
            <h3>Confirm {reports.find((r) => r.uuid === deleteConfirm)?.retired ? 'Unretire' : 'Retire'}</h3>
            <p>
              Are you sure you want to {reports.find((r) => r.uuid === deleteConfirm)?.retired ? 'unretire' : 'retire'}
              this linelist report? This action cannot be undone.
            </p>
            <ButtonSet>
              <Button kind="secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button kind="danger" onClick={handleDelete}>
                {reports.find((r) => r.uuid === deleteConfirm)?.retired ? 'Unretire' : 'Retire'}
              </Button>
            </ButtonSet>
          </Tile>
        </div>
      )}
    </Stack>
  );
};

export default LinelistReportsPage;
