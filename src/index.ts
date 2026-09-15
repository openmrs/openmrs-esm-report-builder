import { defineConfigSchema, getAsyncLifecycle } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

const moduleName = '@openmrs/esm-report-builder';

const options = {
  featureName: 'report-builder',
  moduleName,
};

export const reportBuilderAdminLink = getAsyncLifecycle(
  () => import('./admin-card-link.extension'),
  options,
);

// Optional but recommended if you add translations folder
export const importTranslation = require.context('../translations', true, /.json$/, 'lazy');

export const root = getAsyncLifecycle(() => import('./root.component'), options);

// Data Visualizer confirm modal (used for sending reports to DHIS2)
export const confirmModal = getAsyncLifecycle(
  () => import('./components/data-visualizer/components/model/confirm.component'),
  options
);

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}