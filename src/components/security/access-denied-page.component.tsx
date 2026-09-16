import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, InlineNotification, Tag } from '@carbon/react';

import { rbDisplay, RB } from '../../constants/privileges';
import { useReportBuilderPrivileges } from '../../hooks/use-report-builder-privileges';
import styles from './access-denied-page.scss';

interface AccessDeniedPageProps {
  /** Full privilege names, e.g. `Task: reportbuilder.report.edit`. */
  requiredPrivileges?: string[];
}

const AccessDeniedPage: React.FC<AccessDeniedPageProps> = ({ requiredPrivileges }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { has } = useReportBuilderPrivileges();
  const privileges = requiredPrivileges ?? [];

  return (
    <div className={styles.container}>
      <InlineNotification
        lowContrast
        kind="error"
        title={t('accessDenied', 'Access denied')}
        subtitle={t('accessDeniedSubtitle', 'Your account does not have permission to open this page.')}
        hideCloseButton
      />

      {privileges.length > 0 && (
        <div className={styles.section}>
          <p className={styles.label}>{t('requiredPrivileges', 'Required privilege(s):')}</p>
          <div className={styles.tags}>
            {privileges.map((privilege) => (
              <Tag key={privilege} type="red">
                {rbDisplay(privilege)}
              </Tag>
            ))}
          </div>
          <p className={styles.hint}>
            {t(
              'accessDeniedHint',
              'Ask your administrator to grant you the report builder role carrying these privileges.',
            )}
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {has(RB.REPORT_VIEW) && (
          <Button kind="primary" onClick={() => navigate('/')}>
            {t('goToHome', 'Go to Home')}
          </Button>
        )}
        <Button kind="secondary" onClick={() => navigate(-1)}>
          {t('goBack', 'Go back')}
        </Button>
      </div>
    </div>
  );
};

export default AccessDeniedPage;
