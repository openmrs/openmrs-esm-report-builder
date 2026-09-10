import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  DataTable,
  Search,
  Stack,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { ChartBar, Download, Information, Play, Renew, Upload } from '@carbon/react/icons';

import { type PackageInfo, getAvailablePackages } from '../../resources/report-import-export/import-export-api';
import ExportReportModal from './export-report-modal.component';
import ImportPackageModal from './import-package-modal.component';
import { ARTIFACT_GROUPS, type ArtifactEntry, type ArtifactGroupDef } from './artifact-groups';
import Header from '../shared/header/header.component';
import { RB } from '../../constants/privileges';
import { useReportBuilderPrivileges } from '../../hooks/use-report-builder-privileges';
import styles from './import-export.styles.scss';

const PackageHeaders = [
  { key: 'name', header: 'Configuration' },
  { key: 'version', header: 'Version' },
  { key: 'size', header: 'Size' },
  { key: 'createdDate', header: 'Created' },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Action' },
];

type TypeFilter = 'all' | 'metadata' | 'reports';

const ImportExportPage: React.FC = () => {
  const { has: hasPrivilege } = useReportBuilderPrivileges();
  const canImport = hasPrivilege(RB.PACKAGE_IMPORT);
  const canExport = hasPrivilege(RB.PACKAGE_EXPORT);
  const navigate = useNavigate();

  // Modals
  const [showExportModal, setShowExportModal] = React.useState(false);
  const [showImportModal, setShowImportModal] = React.useState(false);

  // Tabs
  const [activeTabIndex, setActiveTabIndex] = React.useState(0);

  // Artifact scan state
  const [entries, setEntries] = React.useState<Record<string, ArtifactEntry>>(() =>
    Object.fromEntries(
      ARTIFACT_GROUPS.map((group) => [group.key, { count: null, status: 'loading' as const }]),
    ),
  );
  const [lastScanned, setLastScanned] = React.useState<Date | null>(null);
  const [isScanning, setIsScanning] = React.useState(true);
  const scanAbortRef = React.useRef<AbortController>();

  const refreshArtifacts = React.useCallback(() => {
    scanAbortRef.current?.abort();
    const controller = new AbortController();
    scanAbortRef.current = controller;

    setEntries(
      Object.fromEntries(
        ARTIFACT_GROUPS.map((group) => [group.key, { count: null, status: 'loading' as const }]),
      ),
    );
    setIsScanning(true);

    const tasks = ARTIFACT_GROUPS.map(async (group) => {
      try {
        const count = await group.count(controller.signal);
        if (controller.signal.aborted) return;
        setEntries((prev) => ({
          ...prev,
          [group.key]: { count, status: count > 0 ? 'ready' : 'empty' },
        }));
      } catch (error: any) {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        console.error(`Failed to scan artifacts for ${group.label}:`, error);
        setEntries((prev) => ({ ...prev, [group.key]: { count: null, status: 'error' } }));
      }
    });

    Promise.all(tasks).then(() => {
      if (controller.signal.aborted) return;
      setIsScanning(false);
      setLastScanned(new Date());
    });
  }, []);

  React.useEffect(() => {
    refreshArtifacts();
    return () => scanAbortRef.current?.abort();
  }, [refreshArtifacts]);

  // Artifact filters
  const [artifactSearch, setArtifactSearch] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>('all');

  const visibleGroups = ARTIFACT_GROUPS.filter((group) => {
    if (typeFilter !== 'all' && group.kind !== typeFilter) return false;
    const query = artifactSearch.trim().toLowerCase();
    return !query || group.label.toLowerCase().includes(query);
  });
  const metadataGroups = visibleGroups.filter((group) => group.kind === 'metadata');
  const reportGroups = visibleGroups.filter((group) => group.kind === 'reports');

  // Summary panel numbers
  const metadataGroupCount = ARTIFACT_GROUPS.filter((g) => g.kind === 'metadata').length;
  const reportTypeCount = ARTIFACT_GROUPS.filter((g) => g.kind === 'reports').length;
  const readyArtifacts = ARTIFACT_GROUPS.reduce(
    (sum, group) =>
      entries[group.key]?.status === 'ready' ? sum + (entries[group.key].count ?? 0) : sum,
    0,
  );

  // Packages ("Current Configuration" tab) state
  const [packages, setPackages] = React.useState<PackageInfo[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = React.useState(false);
  const [packagesError, setPackagesError] = React.useState<string | null>(null);
  const [packagesSearch, setPackagesSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [packagesReloadKey, setPackagesReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (activeTabIndex !== 1) {
      return;
    }
    const controller = new AbortController();
    const loadPackages = async () => {
      setIsLoadingPackages(true);
      setPackagesError(null);
      try {
        const effectiveStatusFilter = statusFilter === 'all' ? undefined : statusFilter;
        const data = await getAvailablePackages(
          {
            q: packagesSearch || undefined,
            status: effectiveStatusFilter,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setPackages(data);
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        console.error('Failed to load packages:', err);
        setPackagesError(err.message || 'Failed to load packages');
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingPackages(false);
        }
      }
    };
    loadPackages();
    return () => controller.abort();
  }, [activeTabIndex, packagesSearch, statusFilter, packagesReloadKey]);

  const packagesSearchTimeout = React.useRef<NodeJS.Timeout>();
  const handlePackagesSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    clearTimeout(packagesSearchTimeout.current);
    packagesSearchTimeout.current = setTimeout(() => setPackagesSearch(event.target.value), 300);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '-';
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleExportSuccess = () => {
    refreshArtifacts();
    setPackagesReloadKey((key) => key + 1);
  };

  const handleImportSuccess = () => {
    refreshArtifacts();
    setPackagesReloadKey((key) => key + 1);
  };

  const formatScanned = (date: Date | null) => {
    if (!date) return '—';
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (date.toDateString() === new Date().toDateString()) {
      return `Today, ${time}`;
    }
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
  };

  const renderGroupStatus = (entry?: ArtifactEntry) => {
    if (!entry || entry.status === 'loading') {
      return null;
    }
    if (entry.status === 'error') {
      return (
        <span className={`${styles.groupCardStatus} ${styles.statusError}`}>
          <span className={styles.statusDot} />
          Error
        </span>
      );
    }
    if (entry.status === 'empty') {
      return (
        <span className={`${styles.groupCardStatus} ${styles.statusEmpty}`}>
          <span className={styles.statusDot} />
          Empty
        </span>
      );
    }
    return (
      <span className={`${styles.groupCardStatus} ${styles.statusReady}`}>
        <span className={styles.statusDot} />
        Ready
      </span>
    );
  };

  const renderGroupCard = (group: ArtifactGroupDef) => {
    const entry = entries[group.key];
    return (
      <button
        key={group.key}
        type="button"
        className={styles.groupCard}
        onClick={() => navigate(group.path)}
        title={`View ${group.label}`}
      >
        <span className={styles.groupCardIcon}>
          <group.Icon size={18} />
        </span>
        <span className={styles.groupCardText}>
          <span className={styles.groupCardName}>{group.label}</span>
          <span className={styles.groupCardCount}>
            {entry?.status === 'loading' ? 'Scanning…' : `${entry?.count ?? 0} artifacts`}
          </span>
          {renderGroupStatus(entry)}
        </span>
      </button>
    );
  };

  const renderReportCard = (group: ArtifactGroupDef) => {
    const entry = entries[group.key];
    return (
      <div key={group.key} className={styles.reportCard}>
        <span className={styles.groupCardIcon}>
          <group.Icon size={20} />
        </span>
        <span className={styles.groupCardText}>
          <span className={styles.reportCardName}>{group.label}</span>
          <span className={styles.groupCardCount}>
            {entry?.status === 'loading' ? 'Scanning…' : `${entry?.count ?? 0} artifacts`}
          </span>
          {renderGroupStatus(entry)}
        </span>
        <Button
          kind="ghost"
          size="sm"
          className={styles.outlineButton}
          onClick={() => navigate(group.path)}
        >
          View
        </Button>
      </div>
    );
  };

  const renderAvailableArtifactsTab = () => (
    <div className={styles.artifactsLayout}>
      <div className={styles.panelCard}>
        <div className={styles.toolbar}>
          <Search
            size="md"
            labelText="Search artifacts"
            placeholder="Search artifacts..."
            className={styles.toolbarSearch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setArtifactSearch(e.target.value)}
          />
          <div className={styles.toolbarActions}>
            <select
              className={styles.filterSelect}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              aria-label="Filter by type"
            >
              <option value="all">Type: All</option>
              <option value="metadata">Type: Metadata</option>
              <option value="reports">Type: Reports</option>
            </select>
            <Button
              kind="ghost"
              className={styles.outlineButton}
              renderIcon={Renew}
              onClick={refreshArtifacts}
              disabled={isScanning}
            >
              Refresh
            </Button>
            {canImport && (
              <Button
                kind="ghost"
                className={styles.initAllButton}
                renderIcon={Play}
                onClick={() => setShowImportModal(true)}
              >
                Initialize All
              </Button>
            )}
          </div>
        </div>

        {metadataGroups.length > 0 && (
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>Metadata</h4>
            <p className={styles.sectionSubtitle}>Available metadata artifact groups</p>
            <div className={styles.groupGrid}>{metadataGroups.map(renderGroupCard)}</div>
          </div>
        )}

        {reportGroups.length > 0 && (
          <div className={styles.section}>
            <h4 className={styles.sectionTitle}>Reports</h4>
            <p className={styles.sectionSubtitle}>Available report artifacts</p>
            <div className={styles.reportGrid}>{reportGroups.map(renderReportCard)}</div>
          </div>
        )}

        {metadataGroups.length === 0 && reportGroups.length === 0 && (
          <div className={styles.emptyState}>
            <p>No artifacts match your search.</p>
          </div>
        )}
      </div>

      <div className={styles.summaryCard}>
        <div className={styles.summaryHeader}>
          <span className={styles.summaryHeaderIcon}>
            <ChartBar size={14} />
          </span>
          <span>Artifact Summary</span>
        </div>

        <div className={styles.summaryRow}>
          <span>Metadata groups</span>
          <span className={styles.summaryRowValue}>{metadataGroupCount}</span>
        </div>
        <div className={styles.summaryRow}>
          <span>Report types</span>
          <span className={styles.summaryRowValue}>{reportTypeCount}</span>
        </div>
        <div className={styles.summaryRow}>
          <span>Ready artifacts</span>
          <span className={styles.summaryRowValue}>
            {isScanning ? '—' : readyArtifacts}
          </span>
        </div>
        <div className={styles.summaryRow}>
          <span>Last scanned</span>
          <span className={styles.summaryRowTime}>{formatScanned(lastScanned)}</span>
        </div>

        <hr className={styles.summaryDivider} />

        <div className={styles.aboutTitle}>
          <Information size={14} />
          <span>About</span>
        </div>
        <p className={styles.aboutText}>
          Initialize Report Builder from backend-configured artifacts or extract the current
          reporting configuration.
        </p>
      </div>
    </div>
  );

  const renderPackagesTab = () => (
    <div className={styles.panelCard}>
      <div className={styles.packagesToolbar}>
        <Search
          size="md"
          labelText="Search configurations"
          placeholder="Search configurations…"
          className={styles.toolbarSearch}
          onChange={handlePackagesSearch}
        />
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">Status: All</option>
          <option value="valid">Valid</option>
          <option value="invalid">Invalid</option>
        </select>
      </div>

      {isLoadingPackages ? <div className={styles.packagesMessage}>Loading…</div> : null}
      {!isLoadingPackages && packagesError ? (
        <div className={styles.packagesError}>{packagesError}</div>
      ) : null}

      {!isLoadingPackages && packages.length > 0 && (
        <DataTable
          rows={packages.map((pkg) => ({
            id: pkg.path || pkg.name,
            name: pkg.name,
            version: pkg.version,
            size: formatBytes(pkg.size),
            createdDate: formatDate(pkg.exportedAt || ''),
            status: pkg.status === 'valid' ? 'Valid' : 'Invalid',
            action: 'Import',
          }))}
          headers={PackageHeaders}
        >
          {({ rows, headers, getHeaderProps, getTableProps }) => (
            <TableContainer>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {headers.map((header, i) => (
                      <TableHeader key={i} {...getHeaderProps({ header })}>
                        {header.header}
                      </TableHeader>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const pkg = packages.find((p) => (p.path || p.name) === row.id);
                    return (
                      <TableRow key={row.id}>
                        {row.cells.map((cell, i) => {
                          if (headers[i].key === 'status' && pkg) {
                            return (
                              <TableCell key={cell.id}>
                                <Tag type={pkg.status === 'valid' ? 'green' : 'red'}>{cell.value}</Tag>
                              </TableCell>
                            );
                          }
                          if (headers[i].key === 'action' && pkg) {
                            return (
                              <TableCell key={cell.id}>
                                {canImport && (
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setShowImportModal(true);
                                    }}
                                    disabled={pkg.status !== 'valid'}
                                  >
                                    Import
                                  </Button>
                                )}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      )}

      {!isLoadingPackages && packages.length === 0 && (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>No configuration artifacts are available.</p>
          <p className={styles.emptyHint}>
            Extract artifacts to backup or distribute reporting configuration.
          </p>
          {canExport && (
            <Button
              kind="primary"
              className={styles.tealButton}
              renderIcon={Download}
              onClick={() => setShowExportModal(true)}
            >
              Extract Artifacts
            </Button>
          )}
        </div>
      )}
    </div>
  );

  const renderHistoryTab = () => (
    <div className={styles.panelCard}>
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>No history recorded yet.</p>
        <p className={styles.emptyHint}>
          Import and export operations will appear here after they are performed.
        </p>
      </div>
    </div>
  );

  return (
    <Stack gap={5}>
      <Header
        title="Report Builder Import / Export"
        subtitle="Initialize Report Builder from backend-configured artifacts or extract the current reporting configuration."
      />

      {/* Hero action cards */}
      {(canImport || canExport) && (
        <div className={styles.actionCards}>
          {canImport && (
            <div className={styles.actionCard}>
              <div className={styles.actionCardIcon}>
                <Download size={26} />
              </div>
              <div className={styles.actionCardContent}>
                <h3 className={styles.actionCardTitle}>Initialize from Artifacts</h3>
                <p className={styles.actionCardDescription}>
                  Loads Report Builder configuration from artifacts available on the server.
                </p>
              </div>
              <Button className={styles.tealButton} onClick={() => setShowImportModal(true)}>
                Initialize
              </Button>
            </div>
          )}
          {canExport && (
            <div className={styles.actionCard}>
              <div className={styles.actionCardIcon}>
                <Upload size={26} />
              </div>
              <div className={styles.actionCardContent}>
                <h3 className={styles.actionCardTitle}>Extract Artifacts</h3>
                <p className={styles.actionCardDescription}>
                  Exports the current Report Builder configuration to the configured artifacts
                  location.
                </p>
              </div>
              <Button className={styles.tealButton} onClick={() => setShowExportModal(true)}>
                Extract
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Info banner */}
      <div className={styles.infoBanner}>
        <Information size={16} className={styles.infoBannerIcon} />
        <span>
          Artifact storage is configured by the system administrator. No file or folder selection
          is required.
        </span>
      </div>

      {/* Tabs */}
      <Tabs
        selectedIndex={activeTabIndex}
        onChange={(event: { selectedIndex: number }) => setActiveTabIndex(event.selectedIndex ?? 0)}
      >
        <TabList aria-label="Import / Export sections">
          <Tab>Available Artifacts</Tab>
          <Tab>Current Configuration</Tab>
          <Tab>History</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>{renderAvailableArtifactsTab()}</TabPanel>
          <TabPanel>{renderPackagesTab()}</TabPanel>
          <TabPanel>{renderHistoryTab()}</TabPanel>
        </TabPanels>
      </Tabs>

      {/* Export Modal */}
      <ExportReportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onSuccess={handleExportSuccess}
      />

      {/* Import Modal */}
      <ImportPackageModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={handleImportSuccess}
      />
    </Stack>
  );
};

export default ImportExportPage;
