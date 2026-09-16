import React from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronDown, Location, UserFollow } from '@carbon/react/icons';
import { formatDate, useSession } from '@openmrs/esm-framework';

import Illustration from './illustration.component';
import styles from './header.scss';
import AiAssistButton from '../../ai-support/ai-assist-button.component';

export interface HeaderStatus {
    label: string;
    kind?: 'neutral' | 'info' | 'success' | 'warning'; // kept for future, not styled as pill in this design
}

export interface HeaderProps {
    title: string;
    subtitle?: string;
    status?: HeaderStatus;
    actions?: React.ReactNode;

    showAiAssist?: boolean; // NEW
}

const Header: React.FC<HeaderProps> = ({ title, subtitle, status, actions, showAiAssist = true }) => {
    const { t } = useTranslation();
    const session = useSession();
    const location = session?.sessionLocation?.display;

    const metaLeft = status?.label;
    const metaRight = subtitle;

    return (
        <div className={styles.header}>
            {/* LEFT */}
            <div className={styles.left}>
                <div className={styles.illustrationWrap}>
                    <Illustration />
                </div>

                <div className={styles.pageLabels}>
                    <div className={styles.appName}>{t('reportBuilder', 'Report builder')}</div>
                    <h1 className={styles.pageTitle}>{title}</h1>

                    {(metaLeft || metaRight) && (
                        <div className={styles.metaLine}>
                            {metaLeft ? <span className={styles.metaItem}>{metaLeft}</span> : null}
                            {metaLeft && metaRight ? <span className={styles.metaDot}>•</span> : null}
                            {metaRight ? <span className={styles.metaItem}>{metaRight}</span> : null}
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT */}
            <div className={styles.right}>
                <div className={styles.rightTop}>
                    <div className={styles.userRow}>
                        <span className={styles.userName}>{session?.user?.person?.display}</span>
                        <UserFollow size={18} className={styles.userIcon} />
                    </div>

                    <div className={styles.contextRow}>
                        <Location size={16} />
                        <span className={styles.value}>{location}</span>
                        <span className={styles.metaDot}>•</span>
                        <Calendar size={16} />
                        <span className={styles.value}>{formatDate(new Date(), { mode: 'standard' })}</span>
                        <ChevronDown size={16} className={styles.chevron} />
                    </div>
                </div>

                {showAiAssist || actions ? (
                    <div className={styles.actions}>
                        {showAiAssist ? <AiAssistButton context={{ page: title }} /> : null}
                        {actions}
                    </div>
                ) : null}
            </div>


        </div>
    );
};

export default Header;