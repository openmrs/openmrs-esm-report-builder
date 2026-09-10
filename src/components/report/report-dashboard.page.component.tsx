import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  InlineNotification,
  Modal,
  ModalBody,
  ProgressBar,
  Select,
  SelectItem,
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Checkbox,
  Search,
  Pagination,
  Tag,
  OverflowMenu,
  OverflowMenuItem,
} from '@carbon/react';
import { Play, Add, Renew } from '@carbon/react/icons';

import Header from '../shared/header/header.component';
import { listReports, compileReport, type ReportDto } from '../../resources/report/reports.api';
import { RB } from '../../constants/privileges';
import { useReportBuilderPrivileges } from '../../hooks/use-report-builder-privileges';
import { listReportCategories, type ReportCategoryDto } from '../../resources/report-category/report-category.api';
import ExportReportModal from '../import-export/export-report-modal.component';

type ReportWithMetadata = ReportDto & {
  parsedConfig?: {
    categoryUuid?: string;
    themeUuid?: string;
  } | null;
  categoryName?: string;
  themeName?: string;
};

const ReportDashboardPage: React.FC = () => {
  const { has: hasPrivilege } = useReportBuilderPrivileges();
  const canCreateReport = hasPrivilege(RB.REPORT_ADD, RB.REPORT_EDIT);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [search, setSearch] = React.useState('');
  const [reports, setReports] = React.useState<ReportWithMetadata[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Selection state
  const [selectedReports, setSelectedReports] = React.useState<Set<string>>(new Set());

  // Bulk compile state
  const [compiling, setCompiling] = React.useState(false);
  const [compileProgress, setCompileProgress] = React.useState(0);
  const [compileResults, setCompileResults] = React.useState<Array<{ name: string; success: boolean; error?: string }>>([]);
  const [showCompileResults, setShowCompileResults] = React.useState(false);

  // Category selection modal state
  const [showCategoryModal, setShowCategoryModal] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState('');

  // Pagination
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  // Reference data
  const [categories, setCategories] = React.useState<ReportCategoryDto[]>([]);

  // Export modal state
  const [showExportModal, setShowExportModal] = React.useState(false);

  React.useEffect(() => {
    const ac = new AbortController();

    const loadData = async () => {
      try {
        const [reportsData, categoriesData] = await Promise.all([
          listReports({ v: 'full', includeRetired: false }, ac.signal),
          listReportCategories(undefined, ac.signal),
        ]);

        // Augment reports with metadata from API response
        const reportsWithMetadata: ReportWithMetadata[] = reportsData.map((report) => {
          let config = null;
          try {
            if (report.configJson) {
              config = JSON.parse(report.configJson);
            }
          } catch (e) {
            console.warn('Failed to parse config:', e);
          }

          // Category is already nested in the report response
          const categoryName = (report as any).category?.name;

          return {
            ...report,
            parsedConfig: config,
            categoryName,
          };
        });

        setReports(reportsWithMetadata);
        setCategories(categoriesData);
      } catch (err) {
        console.error('Failed to load reports:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    return () => ac.abort();
  }, []);

  const headers = [
    { key: 'select', header: 'Select' },
    { key: 'name', header: 'Report' },
    { key: 'code', header: 'Code' },
    { key: 'category', header: 'Category' },
    { key: 'reportType', header: 'Type' },
    { key: 'compileStatus', header: 'Status' },
    { key: 'lastCompiledAt', header: 'Last compiled' },
    { key: 'actions', header: 'Actions' },
  ];

  const filteredReports = React.useMemo(() => {
    if (!search.trim()) return reports;
    const q = search.toLowerCase();
    return reports.filter((r) =>
      r.name?.toLowerCase().includes(q) ||
      r.code?.toLowerCase().includes(q) ||
      r.description?.toLowerCase().includes(q)
    );
  }, [search, reports]);

  // Paginate reports
  const paginatedReports = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredReports.slice(start, start + pageSize);
  }, [filteredReports, currentPage, pageSize]);

  /**
   * Handle individual report selection
   */
  const handleSelectReport = React.useCallback((reportId: string) => {
    setSelectedReports((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(reportId)) {
        newSet.delete(reportId);
      } else {
        newSet.add(reportId);
      }
      return newSet;
    });
  }, []);

  /**
   * Handle select all toggle
   */
  const handleSelectAll = React.useCallback(() => {
    if (selectedReports.size === paginatedReports.length && paginatedReports.length > 0) {
      // Deselect all
      setSelectedReports(new Set());
    } else {
      // Select all current page
      setSelectedReports(new Set(paginatedReports.map((r) => r.uuid)));
    }
  }, [selectedReports.size, paginatedReports]);

  /**
   * Handle bulk compile selected reports
   */
  const handleBulkCompile = React.useCallback(() => {
    if (selectedReports.size === 0) return;
    // Show category selection modal
    setShowCategoryModal(true);
    setSelectedCategory('');
  }, [selectedReports.size]);

  /**
   * Confirm and execute bulk compile with selected category
   */
  const handleConfirmBulkCompile = React.useCallback(async () => {
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

    const reportsToCompile = filteredReports.filter((r) => selectedReports.has(r.uuid));
    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < reportsToCompile.length; i++) {
      const report = reportsToCompile[i];
      try {
        const result = await compileReport(report.uuid, selectedCategory);
        results.push({
          name: report.name,
          success: !!result.compiled,
          error: !result.compiled ? 'Failed to compile' : undefined,
        });
      } catch (err) {
        results.push({
          name: report.name,
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
  }, [selectedReports, filteredReports, selectedCategory]);

  /**
   * Get row data for DataTable
   */
  const getRowItems = React.useCallback(() => {
    return paginatedReports.map((report) => ({
      id: report.uuid,
      uuid: report.uuid,
      select: report.uuid,
      name: report.name,
      code: report.code || '-',
      category: report.categoryName || '-',
      theme: report.themeName || '-',
      status: report.retired ? 'Retired' : 'Draft',
      lastModified: '-', // TODO: Add when dateModified is available
      actions: report.uuid,
    }));
  }, [paginatedReports]);

  /**
   * Handle delete/retire
   */
  const handleDuplicate = React.useCallback((report: ReportWithMetadata) => {
    navigate(`/new?duplicate=${report.uuid}`);
  }, [navigate]);

  const handleExport = React.useCallback((report: ReportWithMetadata) => {
    const exportData = {
      name: report.name,
      description: report.description,
      code: report.code,
      config: report.parsedConfig,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.name?.replace(/[^a-z0-9]/gi, '_') || 'report'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportPackage = React.useCallback(() => {
    setShowExportModal(true);
  }, []);

  const handleExportSuccess = React.useCallback((result: any) => {
    console.log('Export package successful:', result);
    setShowExportModal(false);
  }, []);

  return (
      <div>
        <Header
            title={t('aggregateReports', 'Aggregate Reports')}
            subtitle={t('manageAggregateReports', 'Manage and create aggregate reports')}
        />

        {/* Action Buttons */}
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
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
        </div>

        {/* Compile Progress */}
        {compiling && (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
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
              kind={
                compileResults.every((r) => r.success)
                  ? 'success'
                  : compileResults.some((r) => r.success)
                  ? 'warning'
                  : 'error'
              }
              title="Compile Results"
              subtitle={`${compileResults.filter((r) => r.success).length} of ${compileResults.length} reports compiled successfully`}
              onClose={() => setShowCompileResults(false)}
              style={{ marginBottom: '1rem' }}
            />
            <div style={{ marginBottom: '1rem' }}>
              {compileResults.map((result, idx) => (
                <div key={idx} style={{ padding: '0.5rem', borderBottom: '1px solid #e0e0e0' }}>
                  {result.success ? '✓' : '✗'} {result.name}
                  {result.error && <span style={{ color: '#da1e28', marginLeft: '0.5rem' }}> - {result.error}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Search and Actions Toolbar */}
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Search
            labelText=""
            placeholder="Search reports"
            value={search}
            onChange={(e) => {
              setSearch((e.target as HTMLInputElement).value);
              setCurrentPage(1);
            }}
            style={{ flexGrow: 1 }}
          />
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
          {canCreateReport && (
            <Button
              kind="ghost"
              size="md"
              renderIcon={Add}
              onClick={() => navigate('/new')}
            >
              Create Report
            </Button>
          )}
          <Button
            kind="ghost"
            size="md"
            renderIcon={Renew}
            onClick={() => window.location.reload()}
            hasIconOnly
            iconDescription="Refresh"
          />
        </div>

        {/* Table */}
        {!loading && filteredReports.length > 0 ? (
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
                          <TableCell
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/edit/${dtRow.id}`)}
                          >
                            {report?.name}
                          </TableCell>
                          <TableCell>{report?.code || '—'}</TableCell>
                          <TableCell>{report?.categoryName || '—'}</TableCell>
                          <TableCell>{report?.reportType || '—'}</TableCell>
                          <TableCell>
                            <Tag
                              type={
                                (report as any)?.compileStatus === 'COMPILED'
                                  ? 'green'
                                  : (report as any)?.compileStatus === 'PENDING'
                                    ? 'cyan'
                                    : 'gray'
                              }
                            >
                              {(report as any)?.compileStatus || 'Unknown'}
                            </Tag>
                          </TableCell>
                          <TableCell>
                            {(report as any)?.lastCompiledAt
                              ? new Date((report as any).lastCompiledAt).toLocaleDateString()
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <OverflowMenu flipped>
                              <OverflowMenuItem
                                itemText="Edit"
                                onClick={() => navigate(`/edit/${dtRow.id}`)}
                              />
                              <OverflowMenuItem
                                itemText="Duplicate"
                                onClick={() => report && handleDuplicate(report)}
                              />
                              <OverflowMenuItem
                                itemText="Export"
                                onClick={() => report && handleExport(report)}
                              />
                              <OverflowMenuItem
                                itemText="Export Package"
                                onClick={handleExportPackage}
                                requireTitle
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
        ) : null}

        {/* Empty State */}
        {!loading && filteredReports.length === 0 ? (
          <div style={{ opacity: 0.7, marginTop: '1rem', textAlign: 'center', padding: '2rem' }}>
            {search.trim()
              ? t('noReportsFound', 'No reports match your search')
              : t('noReports', 'No reports found. Create your first report to get started.')}
          </div>
        ) : null}

        {/* Loading State */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>Loading reports...</div>
        )}

        {/* Pagination */}
        {!loading && filteredReports.length > 0 && (
          <Pagination
            totalItems={filteredReports.length}
            pageSize={pageSize}
            pageSizes={[10, 25, 50]}
            page={currentPage}
            onChange={({ page, pageSize: newSize }) => {
              setCurrentPage(page);
              setPageSize(newSize);
            }}
          />
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
              <p style={{ marginBottom: '1rem' }}>
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

        {/* Export Package Modal */}
        <ExportReportModal
          isOpen={showExportModal}
          onClose={() => {
            setShowExportModal(false);
          }}
          onSuccess={handleExportSuccess}
        />
      </div>
  );
};

export default ReportDashboardPage;