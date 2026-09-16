import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import MonitorRenderer from '../components/etl-monitor/renderers/MonitorRenderer';
import { getDesignSample } from '../components/etl-monitor/builder/steps/design-samples';
import { DESIGN_TYPES } from '../components/etl-monitor/builder/design-registry';

test('every design type renders through MonitorRenderer', () => {
  const lines: string[] = [];
  for (const t of DESIGN_TYPES) {
    const sample = getDesignSample(t.type);
    const div = document.createElement('div');
    const root = createRoot(div);
    act(() => {
      root.render(<MonitorRenderer config={sample.config} data={sample.data} loading={false} error={null} />);
    });
    const html = div.innerHTML;
    const fallback = html.includes('not yet supported');
    const emptyState = html.includes('monitor-empty-state');
    const mainClass =
      (html.match(
        /class="(metrics-grid-renderer|table-renderer|log-renderer|details-renderer|error-log-renderer|monitor-summary-card|monitor-progress|status-card-premium|time-series-renderer)[^"]*"/,
      ) || [])[1] || '(none)';
    lines.push(
      `${t.type.padEnd(14)} bytes:${String(html.length).padStart(5)}  fallback:${fallback ? 'YES' : 'no '}  empty:${emptyState ? 'YES' : 'no '}  root:${mainClass}`,
    );
    root.unmount();
    expect(fallback).toBe(false);
    expect(html.length).toBeGreaterThan(50);
  }
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'));
});
