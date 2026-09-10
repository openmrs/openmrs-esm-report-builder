import React from 'react';
import {
  InlineNotification,
  Modal,
  ModalBody,
  ProgressBar,
  Tag,
} from '@carbon/react';
import {Checkmark, Error as ErrorIcon, Package } from '@carbon/react/icons';

import { exportReports, type ShippingRequest, type ExportResult } from '../../resources/report-import-export/import-export-api';

import styles from './import-export.styles.scss';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result?: ExportResult) => void;
}

type ProgressStep = {
  key: string;
  label: string;
  status: 'pending' | 'in-progress' | 'complete' | 'error';
};

const EXPORT_PROGRESS_STEPS: ProgressStep[] = [
  { key: 'validate', label: 'Validating resources...', status: 'pending' },
  { key: 'collect', label: 'Resolving dependencies...', status: 'pending' },
  { key: 'package', label: 'Creating package...', status: 'pending' },
  { key: 'complete', label: 'Complete!', status: 'pending' },
];

const ExportReportModal: React.FC<ExportReportModalProps> = ({ isOpen, onClose, onSuccess }) => {

  // Generate auto version based on current timestamp
  const generateAutoVersion = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day}-${hours}${minutes}`;
  };

  // Export state
  const [isExporting, setIsExporting] = React.useState(false);
  const [currentStep, setCurrentStep] = React.useState(0);
  const [progressSteps, setProgressSteps] = React.useState<ProgressStep[]>(EXPORT_PROGRESS_STEPS);
  const [exportResult, setExportResult] = React.useState<ExportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const resetState = React.useCallback(() => {
    setIsExporting(false);
    setCurrentStep(0);
    setProgressSteps(EXPORT_PROGRESS_STEPS);
    setExportResult(null);
    setError(null);
  }, []);

  // Reset state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  const startExport = async () => {
    setIsExporting(true);
    setError(null);

    try {
      // Simulate progress steps
      for (let i = 0; i < progressSteps.length - 1; i++) {
        await updateProgressStep(i, 'in-progress');
        await sleep(600);
        await updateProgressStep(i, 'complete');
      }

      // Call the export API - always exports artifacts
      // (compiled reports are generated locally by the compile process, not exported)
      const request: ShippingRequest = {
        type: 'artifacts',
        version: generateAutoVersion(),
      };

      const result = await exportReports(request);
      await updateProgressStep(progressSteps.length - 1, 'complete');
      setExportResult(result);

      if (result.success) {
        onSuccess?.(result);
      } else {
        setError(result.errorMessage || 'Export failed. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during export.');
      setProgressSteps((steps) =>
        steps.map((step, i) => (i === currentStep ? { ...step, status: 'error' } : step)),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const updateProgressStep = async (index: number, status: ProgressStep['status']) => {
    if (index >= 0 && index < progressSteps.length) {
      setCurrentStep(index + 1);
      setProgressSteps((steps) =>
        steps.map((step, i) => (i === index ? { ...step, status } : step)),
      );
    }
    await sleep(100);
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const getProgressPercentage = () => {
    return Math.round((currentStep / progressSteps.length) * 100);
  };

  const isValid = true;
  const isFormStage = !isExporting && !exportResult;

  return (
    <Modal
      open={isOpen}
      onRequestClose={onClose}
      modalHeading="Extract Report Builder Artifacts"
      modalLabel="Report Builder"
      primaryButtonText={isFormStage ? 'Extract' : exportResult?.success ? 'Done' : 'Close'}
      primaryButtonDisabled={isFormStage && !isValid}
      onRequestSubmit={isFormStage ? startExport : onClose}
      secondaryButtonText={isFormStage ? 'Cancel' : undefined}
      size="md"
    >
      <ModalBody>
        {!isExporting && !exportResult && (
          <div className={styles.formContainer}>
            {/* Info Box */}
            <div className={styles.formField}>
              <InlineNotification
                kind="info"
                title="Extract All Artifacts"
                subtitle="This will export all Report Builder artifacts (categories, indicators, themes, sections, library, etc.) from the current instance."
                hideCloseButton
                lowContrast
              />
            </div>

            {error && (
              <InlineNotification
                kind="error"
                title="Error"
                subtitle={error}
                hideCloseButton
                lowContrast
              />
            )}
          </div>
        )}

        {/* Progress View */}
        {isExporting && (
          <div className={styles.progressContainer}>
            <div className={styles.progressInfo}>
              <h4>Extracting artifacts...</h4>
              <p>All Report Builder artifacts</p>
            </div>

            <ProgressBar
              value={getProgressPercentage()}
              label={progressSteps[currentStep]?.label || 'Initializing...'}
              className={styles.progressBar}
            />

            <div className={styles.progressSteps}>
              {progressSteps.map((step) => (
                <div key={step.key} className={styles.progressStep}>
                  <span className={styles.stepIcon}>
                    {step.status === 'complete' && <Checkmark size={16} className={styles.success} />}
                    {step.status === 'error' && <ErrorIcon size={16} className={styles.error} />}
                    {step.status === 'in-progress' && (
                      <Package size={16} className={styles.inProgress} />
                    )}
                  </span>
                  <span
                    className={`${styles.stepLabel} ${
                      step.status === 'complete' ? styles.complete :
                      step.status === 'error' ? styles.error :
                      step.status === 'in-progress' ? styles.inProgress : ''
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success View */}
        {exportResult && exportResult.success && (
          <div className={styles.successContainer}>
            <div className={styles.successHeader}>
              <Checkmark size={32} className={styles.successIcon} />
              <div>
                <h4>Artifacts extracted successfully</h4>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: 'var(--cds-text-02)' }}>
                  All Report Builder artifacts
                </p>
                <p style={{ margin: '0', fontSize: '0.875rem', color: 'var(--cds-text-02)' }}>
                  Version {exportResult.version || 'auto'}
                </p>
              </div>
            </div>

            {exportResult.dependencies && (
              <div className={styles.dependencies}>
                <h5>Included</h5>
                <div className={styles.dependencyTags}>
                  {exportResult.dependencies.categories && exportResult.dependencies.categories.length > 0 && (
                    <Tag type="blue">Report Categories {exportResult.dependencies.categories.length}</Tag>
                  )}
                  {exportResult.dependencies.indicators && exportResult.dependencies.indicators.length > 0 && (
                    <Tag type="green">Indicators {exportResult.dependencies.indicators.length}</Tag>
                  )}
                  {exportResult.dependencies.themes && exportResult.dependencies.themes.length > 0 && (
                    <Tag type="purple">Data Themes {exportResult.dependencies.themes.length}</Tag>
                  )}
                  {exportResult.dependencies.sections && exportResult.dependencies.sections.length > 0 && (
                    <Tag type="warm-gray">Sections {exportResult.dependencies.sections.length}</Tag>
                  )}
                  {exportResult.dependencies.library && exportResult.dependencies.library.length > 0 && (
                    <Tag type="cyan">Report Library {exportResult.dependencies.library.length}</Tag>
                  )}
                  {exportResult.dependencies.ageCategories && exportResult.dependencies.ageCategories.length > 0 && (
                    <Tag type="cool-gray">Age Categories {exportResult.dependencies.ageCategories.length}</Tag>
                  )}
                  {exportResult.dependencies.ageGroups && exportResult.dependencies.ageGroups.length > 0 && (
                    <Tag type="cool-gray">Age Groups {exportResult.dependencies.ageGroups.length}</Tag>
                  )}
                </div>
              </div>
            )}

            <div className={styles.resultInfo}>
              {exportResult.sourceFile && (
                <div className={styles.infoRow}>
                  <span className={styles.summary}>Package</span>
                  <span style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>
                    {exportResult.sourceFile.split('/').pop()}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
};

export default ExportReportModal;
