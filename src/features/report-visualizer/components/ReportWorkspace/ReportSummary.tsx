/**
 * Report Summary Component
 *
 * Displays report metadata like record count and generation time.
 * Format: "1,254 records • Generated today 14:31"
 *
 * Phase 3.3: Report summary row
 */
import React from 'react';
import { Tag } from '@carbon/react';
import { Time } from '@carbon/react/icons';

interface ReportSummaryProps {
  /** Omitted when the report renders as HTML only and no row count is known */
  rowCount?: number;
  generatedTime: Date;
  parameters?: Record<string, any>;
}

const ReportSummary: React.FC<ReportSummaryProps> = ({
  rowCount,
  generatedTime,
  parameters,
}) => {
  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat().format(num);
  };

  const formatTime = (date: Date): string => {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

    if (isToday) {
      return `today ${time}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isYesterday) {
      return `yesterday ${time}`;
    }

    return `${date.toLocaleDateString()} ${time}`;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      {/* Record count — only when known (tabular results) */}
      {rowCount !== undefined && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', color: '#333' }}>
              {formatNumber(rowCount)} {rowCount === 1 ? 'record' : 'records'}
            </span>
          </div>

          {/* Separator */}
          <span style={{ color: '#999' }}>•</span>
        </>
      )}

      {/* Generation time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', color: '#666' }}>
        <Time size={14} />
        <span>Generated {formatTime(generatedTime)}</span>
      </div>

      {/* Optional: Display key parameters */}
      {parameters && Object.keys(parameters).length > 0 && (
        <>
          <span style={{ color: '#999' }}>•</span>
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {Object.entries(parameters).slice(0, 3).map(([key, value]) => (
              <Tag key={key} size="sm" type="cool-gray">
                {key}: {String(value)}
              </Tag>
            ))}
            {Object.keys(parameters).length > 3 && (
              <Tag size="sm" type="cool-gray">
                +{Object.keys(parameters).length - 3} more
              </Tag>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ReportSummary;
