/**
 * Report Visualizer Page - Two-Panel Layout
 *
 * Main container for the report visualizer with collapsible explorer and workspace panels.
 * Adapts collapse pattern from linelist-builder-workspace.component.tsx
 *
 * Phase 6: Integration with existing APIs (getReport, downloadReport, sendReportToDHIS2)
 *
 * Layout:
 * - Left Panel (Explorer): Search, filters, report list, parameters, run button
 * - Right Panel (Workspace): Report title, view tabs, results
 */
import React, { useState, useCallback, useEffect } from 'react';
import styles from './report-visualizer.scss';

// Import custom hooks
import { useReports, useReportParameters, useExplorerPreferences, useReportCapabilities } from './hooks';

// Import components
import ReportExplorerPanel from './components/ReportExplorer/ReportExplorerPanel';
import ReportWorkspacePanel from './components/ReportWorkspace/ReportWorkspacePanel';

// Import categories hook
import { useGetReportCategories } from '../../components/data-visualizer/data-visualizer.resource';

// Import API functions for integration
import {
  getReport,
  downloadReport,
  sendReportToDHIS2,
} from '../../components/data-visualizer/data-visualizer.resource';

// Import utilities
import { formatDate } from '../../components/data-visualizer/data-visualizer.resource';
import { showToast, showNotification, showModal } from '@openmrs/esm-framework';

import type { ReportLibraryItem, ReportViewType } from './types';

const showErrorNotification = (title: string, description: string) =>
  showNotification({
    title,
    kind: 'error',
    critical: true,
    description,
  });

const ReportVisualizerPage: React.FC = () => {
  // ===== PREFERENCES =====
  // Load user preferences from localStorage
  const {
    preferences,
    setExplorerExpanded,
    setLastActiveView,
    isLoaded: prefsLoaded,
  } = useExplorerPreferences();

  // ===== PANEL STATE =====
  // Panel state - initialized from preferences
  const [explorerCollapsed, setExplorerCollapsed] = useState(!preferences.explorerExpanded);
  const [explorerWidth, setExplorerWidth] = useState(preferences.explorerWidth);

  // Resizable state
  const [isResizing, setIsResizing] = useState(false);

  // ===== FILTER STATE =====
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // ===== SELECTION STATE =====
  const [selectedReportUuid, setSelectedReportUuid] = useState<string | undefined>();

  // ===== VIEW STATE =====
  const [activeView, setActiveView] = useState<ReportViewType>('REPORT_LAYOUT');

  // ===== REPORT EXECUTION STATE =====
  const [runningReport, setRunningReport] = useState(false);
  const [reportResults, setReportResults] = useState<any>(null);
  const [dhisJson, setDhisJson] = useState({});
  const [htmlContent, setHTML] = useState('');

  // ===== USE HOOKS =====
  // Get reports with filtering
  const { filteredReports, loading: loadingReports, getReportByUuid, availableTags } = useReports({
    searchQuery,
    selectedCategory,
    selectedTags,
  });

  // Get categories
  const { reportCategories, isLoadingReportCategories: loadingCategories } = useGetReportCategories();

  // Get selected report object
  const selectedReport = selectedReportUuid ? getReportByUuid(selectedReportUuid) || null : null;

  // Get parameters for selected report
  const {
    parameters: reportParameters,
    values: parameterValues,
    errors: parameterErrors,
    setValues: setParameterValues,
    validate: validateParameters,
    reset: resetParameters,
    // hasParameters,
  } = useReportParameters({ report: selectedReport });

  // Get capabilities for selected report
  const { capabilities } = useReportCapabilities(selectedReport);

  // ===== PANEL RESIZE =====
  /**
   * Handle panel resize with mouse
   * Adapted from linelist-builder-workspace.component.tsx lines 1258-1294
   */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = Math.max(280, Math.min(700, e.clientX));
        setExplorerWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = '';
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing]);

  /**
   * Start resizing explorer panel
   */
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  /**
   * Collapse explorer panel
   */
  const handleCollapse = useCallback(() => {
    setExplorerCollapsed(true);
    setExplorerExpanded(false);
  }, [setExplorerExpanded]);

  /**
   * Expand explorer panel
   */
  const handleExpand = useCallback(() => {
    setExplorerCollapsed(false);
    setExplorerExpanded(true);
  }, [setExplorerExpanded]);

  // ===== FILTER HANDLERS =====
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleCategoryChange = useCallback((category?: string) => {
    setSelectedCategory(category);
  }, []);

  const handleTagsChange = useCallback((tags: string[]) => {
    setSelectedTags(tags);
  }, []);

  // ===== REPORT SELECTION =====
  const handleReportSelect = useCallback((report: ReportLibraryItem) => {
    setSelectedReportUuid(report.uuid);
    // Reset previous results
    setReportResults(null);
    setHTML('');
    setDhisJson({});
  }, []);

  // ===== PARAMETER HANDLERS =====
  const handleParameterChange = useCallback((values: Record<string, any>) => {
    setParameterValues(values);
  }, [setParameterValues]);

  const handleParametersReset = useCallback(() => {
    resetParameters();
  }, [resetParameters]);

  // ===== VIEW CHANGE =====
  const handleViewChange = useCallback((view: ReportViewType) => {
    setActiveView(view);
    setLastActiveView(view);
  }, [setLastActiveView]);

  // ===== REPORT EXECUTION =====
  /**
   * Handle run report click - ONLY triggered when user clicks the Run Report button
   * Validates parameters and executes the report using getReport API
   */
  const handleRunReport = useCallback(async () => {
    console.log('handleRunReport called - user clicked Run Report button');

    if (!selectedReport) return;

    // Validate required parameters
    if (!validateParameters()) {
      showNotification({
        title: 'Validation Error',
        kind: 'error',
        critical: false,
        description: 'Please fill in all required parameters',
      });
      return;
    }

    setRunningReport(true);
    setReportResults(null);
    setHTML('');
    setDhisJson({});

    try {
      // Get the report UUID (use reportDefinitionUuid if available, otherwise use uuid)
      const reportUuid = selectedReport.reportDefinitionUuid || selectedReport.reportBuilderReportUuid || selectedReport.uuid;

      // Build request parameters
      const requestParams: any = {
        uuid: reportUuid,
        startDate: parameterValues.startDate || formatDate(new Date()),
        endDate: parameterValues.endDate || formatDate(new Date()),
        renderType: 'html',
        parameters: parameterValues,
      };

      console.log('Executing report:', selectedReport.name);
      console.log('Request params:', requestParams);

      // Call getReport API
      const response = await getReport(requestParams);

      if (response.status === 200) {
        const reportData = response.data;

        console.log('Report response data:', reportData);

        // Use HTML returned by backend (all report types return HTML)
        // Backend handles design-based rendering for each report type
        if (reportData._html && reportData._html.length > 0) {
          setHTML(reportData._html[0].html || '');
        } else if (reportData.html) {
          setHTML(reportData.html || '');
        }

        // Set DHIS2 JSON if available
        if (reportData.json) {
          setDhisJson(reportData.json);
        }

        // TODO: Future - parse tabular data based on report design interpreter
        // For now, reports are rendered via HTML only, so no row count is known —
        // omitting rowCount keeps the summary and print header from claiming "0 records"
        setReportResults({
          generatedTime: new Date().toISOString(),
          parameters: parameterValues,
        });

        console.log('Report HTML content set');

        showToast({
          title: 'Report executed successfully',
          kind: 'success',
          critical: false,
          description: '',
        });
      } else {
        console.error(`Report execution failed with status ${response.status}`);
        showErrorNotification('Error executing report', `Report execution failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to run report:', error);
      showErrorNotification('Error executing report', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setRunningReport(false);
    }
  }, [selectedReport, parameterValues, validateParameters]);

  // ===== EXPORT =====
  /**
   * Print only the report via a hidden iframe. The iframe document contains the report
   * content and nothing else, so the printout is the report section alone. Printing from
   * an iframe also sidesteps the shadow DOM boundary — page-level print CSS cannot hide
   * SPA chrome around a shadow tree, so an isolated document is the reliable route.
   */
  const handlePrintReport = useCallback(() => {
    const tableData = reportResults?.data;
    const hasTable = !!tableData?.length;
    if (!htmlContent && !hasTable) {
      showNotification({
        title: 'Nothing to print',
        kind: 'warning',
        critical: false,
        description: 'Run the report first, then export it as PDF',
      });
      return;
    }

    const reportName = selectedReport?.name ?? 'Report';
    const startDate = parameterValues?.startDate || formatDate(new Date());
    const endDate = parameterValues?.endDate || formatDate(new Date());
    const escapeHtml = (value: any) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Content source: the backend-rendered report HTML, printed with its own styles plus
    // the clean base print styles below. Deliberately not the on-screen rendering — the
    // UI theme styling (Carbon variables, module classes) reads like the app, while the
    // backend HTML reads like the source document. When tabular results exist they are
    // printed as a plain table instead.
    let contentHtml = '';
    if (htmlContent) {
      contentHtml = htmlContent;
    } else if (hasTable) {
      const columns: Array<any> = reportResults.columns?.length
        ? reportResults.columns
        : Object.keys(tableData[0]).map((key) => ({ key, header: key }));
      const header = `<tr>${columns.map((c) => `<th>${escapeHtml(c.header ?? c.key)}</th>`).join('')}</tr>`;
      const rows = tableData
        .map((row: any) => `<tr>${columns.map((c) => `<td>${escapeHtml(row[c.key])}</td>`).join('')}</tr>`)
        .join('');
      contentHtml = `<table>${header}${rows}</table>`;
    }

    if (!contentHtml) {
      showNotification({
        title: 'Nothing to print',
        kind: 'warning',
        critical: false,
        description: 'Run the report first, then export it as PDF',
      });
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Report print preview');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(reportName)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body {
      font-family: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
      color: #000;
      background: #fff;
      margin: 0;
      /* Print shaded table headers etc. as they appear on screen */
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .print-header h1 { font-size: 14pt; margin: 0 0 2pt; }
    .print-header p { font-size: 8pt; color: #444; margin: 0 0 10pt; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #8d8d8d; padding: 2pt 4pt; font-size: 8pt; text-align: left; }
    th { background: #e0e0e0; }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${escapeHtml(reportName)}</h1>
    <p>Generated ${new Date().toLocaleString()} &middot; Start date: ${escapeHtml(startDate)} &middot; End date: ${escapeHtml(endDate)}${
      reportResults?.rowCount > 0 ? ` &middot; ${reportResults.rowCount} records` : ''
    }</p>
  </div>
  ${contentHtml}
</body>
</html>`);
    doc.close();

    iframe.contentWindow.addEventListener('afterprint', () => iframe.remove());
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    // Fallback removal if afterprint never fires
    setTimeout(() => iframe.remove(), 60000);
  }, [htmlContent, reportResults, selectedReport, parameterValues]);

  /**
   * Handle export request
   */

  /**
   * Handle export request
   */
  const handleExport = useCallback(async (format: 'CSV' | 'XLSX' | 'PDF') => {
    if (!selectedReport) return;

    // PDF prints the rendered report section on the page instead of asking the backend for a file
    if (format === 'PDF') {
      handlePrintReport();
      return;
    }

    try {
      const reportUuid = selectedReport.reportDefinitionUuid || selectedReport.uuid;

      // Call downloadReport API — the endpoint defaults to excel when no format is sent,
      // so the chosen export format must be passed explicitly
      const response = await downloadReport({
        uuid: reportUuid,
        startDate: parameterValues.startDate || formatDate(new Date()),
        endDate: parameterValues.endDate || formatDate(new Date()),
        format: format === 'CSV' ? 'csv' : 'excel',
      });

      if (response.ok) {
        // Get filename from Content-Disposition header
        const contentDisposition = response.headers.get('Content-Disposition');
        const filenameMatch = contentDisposition?.match(/filename=(.+)/);
        const filename = filenameMatch ? filenameMatch[1] : `${selectedReport.name}.${format.toLowerCase()}`;

        // Create blob and download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        window.URL.revokeObjectURL(url);

        showToast({
          title: 'Export successful',
          kind: 'success',
          critical: false,
          description: '',
        });
      } else {
        console.error(`Export failed with status ${response.status}`);
        showErrorNotification('Error exporting report', `Export failed with status ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to export report:', error);
      showErrorNotification('Error exporting report', error instanceof Error ? error.message : 'Unknown error');
    }
  }, [selectedReport, parameterValues, handlePrintReport]);

  // ===== DHIS2 =====
  /**
   * Confirm send to DHIS2 - shows confirmation modal and handles the send
   */
  const confirmSendToDhis2 = useCallback(async () => {
    if (!selectedReport) return;

    const dispose = showModal('confirm-modal', {
      close: () => dispose(),
      submit: async () => {
        try {
          const reportUuid = selectedReport.reportDefinitionUuid || selectedReport.uuid;
          const response = await sendReportToDHIS2(reportUuid, dhisJson);

          if (response.status === 200) {
            showToast({
              title: 'Report sent to DHIS2',
              kind: 'success',
              critical: true,
              description: `Report ${selectedReport.name} sent successfully`,
            });
          } else {
            console.error(`DHIS2 send failed with status ${response.status}`);
            showErrorNotification('Error sending to DHIS2', `DHIS2 send failed with status ${response.status}`);
          }
        } catch (error) {
          console.error('Failed to send to DHIS2:', error);
          showErrorNotification('Error sending to DHIS2', error instanceof Error ? error.message : 'Unknown error');
        }
        dispose();
      },
      report: selectedReport.name,
    });
  }, [selectedReport, dhisJson]);

  const loading = loadingReports || loadingCategories || !prefsLoaded;

  return (
    <div className={styles.page}>
      <div className={styles.panels}>
        {/* Left Panel - Explorer with all components */}
        <ReportExplorerPanel
          collapsed={explorerCollapsed}
          width={explorerWidth}
          onCollapse={handleCollapse}
          onExpand={handleExpand}
          // Report data
          categories={reportCategories ?? []}
          availableTags={availableTags}
          reports={filteredReports}
          // Current state
          searchQuery={searchQuery}
          selectedCategory={selectedCategory}
          selectedTags={selectedTags}
          selectedReportUuid={selectedReportUuid}
          // Parameters
          reportParameters={reportParameters}
          parameterValues={parameterValues}
          parameterErrors={parameterErrors}
          // Handlers
          onSearchChange={handleSearchChange}
          onCategoryChange={handleCategoryChange}
          onTagsChange={handleTagsChange}
          onReportSelect={handleReportSelect}
          onParameterChange={handleParameterChange}
          onParametersReset={handleParametersReset}
          onRunReport={handleRunReport}
          // UI state
          loading={loading}
          runningReport={runningReport}
        />

        {/* Resize Handle */}
        {!explorerCollapsed && (
          <div
            className={styles.resizeHandle}
            onMouseDown={startResize}
          />
        )}

        {/* Right Panel - Workspace */}
        <ReportWorkspacePanel
          explorerCollapsed={explorerCollapsed}
          selectedReport={selectedReport}
          reportResults={reportResults}
          runningReport={runningReport}
          htmlContent={htmlContent}
          activeView={activeView}
          onViewChange={handleViewChange}
          capabilities={capabilities}
          onExport={handleExport}
          onSendToDhis2={capabilities.sendToDhis2 ? confirmSendToDhis2 : undefined}
          parameterValues={parameterValues}
        />
      </div>
    </div>
  );
};

export default ReportVisualizerPage;
