/**
 * Report Workspace Panel - Right Panel
 *
 * Main content area for displaying report results.
 * Integrates header, view tabs, summary, and results display with real API integration.
 *
 * Phase 6: Full workspace with API integration
 */
import React from 'react';
import { Document } from '@carbon/react/icons';
import { InlineLoading, DataTableSkeleton } from '@carbon/react';
import styles from '../../report-visualizer.scss';

import ReportWorkspaceHeader from './ReportWorkspaceHeader';
import ReportSummary from './ReportSummary';
import ReportLayer from './ReportLayer';
import { ReportTable } from '../TableView';
import type { ReportLibraryItem, ReportCapabilities, ReportViewType } from '../../types';

interface ReportWorkspacePanelProps {
  explorerCollapsed: boolean;
  selectedReport?: ReportLibraryItem | null;
  reportResults?: any;
  runningReport?: boolean;
  htmlContent?: string;
  activeView?: ReportViewType;
  onViewChange?: (view: ReportViewType) => void;
  capabilities?: ReportCapabilities;
  onExport?: (format: 'CSV' | 'XLSX' | 'PDF') => void;
  onSendToDhis2?: () => void;
  parameterValues?: Record<string, any>;
}

const ReportWorkspacePanel: React.FC<ReportWorkspacePanelProps> = ({
  // explorerCollapsed,
  selectedReport,
  reportResults,
  runningReport,
  htmlContent,
  activeView = 'REPORT_LAYOUT',
  onViewChange,
  capabilities = {
    table: true,
    pivot: false,
    chart: false,
    reportLayout: false,
    export: true,
    sendToDhis2: false,
  },
  onExport,
  onSendToDhis2,
  parameterValues,
}) => {
  // Debug logging
  React.useEffect(() => {
    console.log('ReportWorkspacePanel props:', {
      hasSelectedReport: !!selectedReport,
      hasReportResults: !!reportResults,
      hasHtmlContent: !!htmlContent,
      runningReport,
      activeView,
      reportResultsDataLength: reportResults?.data?.length,
      reportResultsColumnsLength: reportResults?.columns?.length,
    });
  }, [selectedReport, reportResults, htmlContent, runningReport, activeView]);

  // Handle view change
  const handleViewChange = (view: ReportViewType) => {
    if (onViewChange) {
      onViewChange(view);
    }
  };

  // Handle export
  const handleExport = (format: 'CSV' | 'XLSX' | 'PDF') => {
    if (onExport) {
      onExport(format);
    }
  };

  // Handle DHIS2 send
  const handleSendToDhis2 = () => {
    if (onSendToDhis2) {
      onSendToDhis2();
    }
  };

  // Handle refresh
  const handleRefresh = () => {
    console.log('Refreshing report');
    // TODO: Re-run the report via parent callback
  };

  return (
    <main className={styles.workspacePanel}>
      {/* Panel Header - Integrated header with view tabs and actions */}
      <div className={styles.panelHeader}>
        {selectedReport ? (
          <ReportWorkspaceHeader
            reportName={selectedReport.name}
            reportDescription={selectedReport.description}
            capabilities={capabilities}
            activeView={activeView}
            onViewChange={handleViewChange}
            onExport={handleExport}
            onSendToDhis2={capabilities.sendToDhis2 ? handleSendToDhis2 : undefined}
            loading={runningReport}
            hasResults={!runningReport && (reportResults || htmlContent)}
          />
        ) : (
          <h3 className={styles.panelTitle}>Report Workspace</h3>
        )}
      </div>

      {/* Panel Content */}
      <div className={styles.panelContent}>
        {runningReport && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <InlineLoading style={{ width: 'auto' }} description="Running report..." />
          </div>
        )}

        {!runningReport && !selectedReport && (
          <div className={styles.emptyState}>
            <Document size={48} />
            <p>Select a report to begin</p>
            <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
              Search and select a report from the explorer panel
            </p>
          </div>
        )}

        {!runningReport && selectedReport && !reportResults && !htmlContent && (
          <div className={styles.emptyState}>
            <DataTableSkeleton size="lg" />
            <p style={{ marginTop: '1rem' }}>Click "Run report" to generate results</p>
          </div>
        )}

        {/* Report Results - Display based on active view */}
        {!runningReport && selectedReport && (reportResults || htmlContent) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Report Summary */}
            {reportResults?.generatedTime && (
              <ReportSummary
                rowCount={reportResults.rowCount}
                generatedTime={new Date(reportResults.generatedTime)}
                parameters={parameterValues}
              />
            )}

            {/* View Content */}
            {activeView === 'TABLE' && reportResults?.data && reportResults.data.length > 0 && (
              <>
                {/* Debug info - remove in production */}
                {process.env.NODE_ENV === 'development' && (
                  <div style={{ padding: '0.5rem', backgroundColor: '#f0f0f0', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                    Debug: Rows={reportResults.data.length}, Columns={reportResults.columns?.length || 0}
                  </div>
                )}
                <ReportTable
                  data={reportResults.data}
                  columns={reportResults.columns || []}
                  onRefresh={handleRefresh}
                  title={selectedReport.name}
                />
              </>
            )}

            {/* Show when no data available */}
            {activeView === 'TABLE' && reportResults && (!reportResults.data || reportResults.data.length === 0) && (
              <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
                <p>No tabular data available for this report</p>
                {process.env.NODE_ENV === 'development' && (
                  <details style={{ marginTop: '1rem', textAlign: 'left' }}>
                    <summary>Debug Info</summary>
                    <pre style={{ fontSize: '0.75rem', overflow: 'auto', maxHeight: '200px' }}>
                      {JSON.stringify(reportResults, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {activeView === 'PIVOT' && reportResults?.data && (
              <div style={{ width: '100%' }}>
                {/* Pivot table will be implemented with react-pivottable */}
                <div style={{ padding: '1rem', backgroundColor: '#f0f0f0', borderRadius: '4px', textAlign: 'center' }}>
                  <p style={{ margin: 0 }}>Pivot View</p>
                  <p style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.5rem' }}>
                    Pivot table view will be implemented with react-pivottable integration
                  </p>
                </div>
                {/* Fallback to table view for now */}
                <ReportTable
                  data={reportResults.data}
                  columns={reportResults.columns || []}
                  onRefresh={handleRefresh}
                  title={selectedReport.name}
                />
              </div>
            )}

            {activeView === 'CHART' && reportResults?.data && (
              <div style={{ width: '100%' }}>
                {/* Chart will be implemented with react-plotly.js */}
                <div style={{ padding: '1rem', backgroundColor: '#f0f0f0', borderRadius: '4px', textAlign: 'center' }}>
                  <p style={{ margin: 0 }}>Chart View</p>
                  <p style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.5rem' }}>
                    Chart view will be implemented with react-plotly.js integration
                  </p>
                </div>
                {/* Fallback to table view for now */}
                <ReportTable
                  data={reportResults.data}
                  columns={reportResults.columns || []}
                  onRefresh={handleRefresh}
                  title={selectedReport.name}
                />
              </div>
            )}

            {activeView === 'REPORT_LAYOUT' && htmlContent && (
              <ReportLayer htmlContent={htmlContent} reportName={selectedReport.name} />
            )}

            {activeView === 'REPORT_LAYOUT' && !htmlContent && reportResults?.data && (
              <ReportTable
                data={reportResults.data}
                columns={reportResults.columns || []}
                onRefresh={handleRefresh}
                title={selectedReport.name}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default ReportWorkspacePanel;
