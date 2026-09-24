import React from 'react';
import {
  Button,
  InlineLoading,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  InlineNotification,
} from '@carbon/react';
import { Save, Download } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import Header from '../shared/header/header.component';
import AiAssistButton from '../ai-support/ai-assist-button.component';

import ReportDetail, { type ReportDetailModel } from './panels/report-detail.component';
import ReportDefinitionEditor from './definition/report-definition-editor.component';
import ReportDesignEditor, { type DesignSectionSource } from './design/report-design-editor.component';

import type { ReportDefinitionDraft } from './definition/report-definition.types';
import type { ReportDesignDraft } from './design/report-design.types';
import { createEmptyReportDesignDraft } from './design/report-design.utils';

import {
  createReport,
  updateReport,
  getReport,
  compileReport,
  type ReportDto,
} from '../../resources/report/reports.api';
import { listSections } from '../../resources/report-section/report-sections.api';
import { listReportCategories, type ReportCategoryDto } from '../../resources/report-category/report-category.api';
import CompileSetupModal, { type CompileSetupResult } from '../shared/compile-setup-modal.component';
import { RB } from '../../constants/privileges';
import { useReportBuilderPrivileges } from '../../hooks/use-report-builder-privileges';

type TabKey = 'details' | 'definition' | 'design';
type BuilderMode = 'create' | 'edit';

type ReportFormState = {
  uuid: string;
  name: string;
  description: string;
  code: string;
  sections: ReportDefinitionDraft['sections'];
  design: ReportDesignDraft;
  categoryUuid: string;
  themeUuid: string;
};

type SectionDtoLike = {
  uuid: string;
  name?: string;
  configJson?: string;
  retired?: boolean;
};

function buildEmptyForm(): ReportFormState {
  return {
    uuid: crypto.randomUUID(),
    name: '',
    description: '',
    code: '',
    sections: [],
    design: createEmptyReportDesignDraft(),
    categoryUuid: '',
    themeUuid: '',
  };
}

function slugifyCode(name: string): string {
  return (name || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
}

function parseSavedReportToForm(report: ReportDto): ReportFormState {
  let parsed: any = {};
  let metaParsed: any = {};
  try {
    parsed = report.configJson ? JSON.parse(report.configJson) : {};
  } catch {
    parsed = {};
  }
  try {
    metaParsed = report.metaJson ? JSON.parse(report.metaJson) : {};
  } catch {
    metaParsed = {};
  }

  const definition = parsed?.definition ?? {};
  const legacySections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const design = parsed?.design ?? null;

  return {
    uuid: report.uuid,
    name: report.name ?? parsed?.name ?? '',
    description: report.description ?? parsed?.description ?? '',
    code: report.code ?? parsed?.code ?? '',
    sections: Array.isArray(definition?.sections) ? definition.sections : legacySections,
    design: design ?? createEmptyReportDesignDraft(),
    categoryUuid: metaParsed?.categoryUuid ?? parsed?.categoryUuid ?? '',
    themeUuid: metaParsed?.themeUuid ?? parsed?.themeUuid ?? '',
  };
}

function safeParseJson(raw?: string | null): any {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Stable id for indicators lacking uuid/id/code: derived from content, not
 * list position, so reordering the section's indicators doesn't re-key the
 * rows (which would make the next refresh discard their customizations).
 */
function fallbackIndicatorId(code: string, name: string): string {
  const basis = `${code}|${name}`;
  if (!code && !name) return '';
  let hash = 5381;
  for (let i = 0; i < basis.length; i++) {
    hash = ((hash << 5) + hash + basis.charCodeAt(i)) | 0;
  }
  return `ind-${(hash >>> 0).toString(36)}`;
}

export default function ReportEditorPage() {
  const { t } = useTranslation();
  const { reportId } = useParams();
  const { has: hasPrivilege } = useReportBuilderPrivileges();

  const mode: BuilderMode = reportId ? 'edit' : 'create';

  const [tab, setTab] = React.useState<TabKey>('details');
  const [form, setForm] = React.useState<ReportFormState>(() => buildEmptyForm());

  const [savedReport, setSavedReport] = React.useState<ReportDto | null>(null);
  const [allSections, setAllSections] = React.useState<SectionDtoLike[]>([]);
  const [categories, setCategories] = React.useState<ReportCategoryDto[]>([]);

  const [loading, setLoading] = React.useState(mode === 'edit');
  const [sectionsLoading, setSectionsLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [compiling, setCompiling] = React.useState(false);

  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState<string | null>(null);
  const [compileError, setCompileError] = React.useState<string | null>(null);
  const [compileSuccess, setCompileSuccess] = React.useState<string | null>(null);

  // Compile setup modal state
  const [showCompileSetupModal, setShowCompileSetupModal] = React.useState(false);

  React.useEffect(() => {
    const ac = new AbortController();

    setSectionsLoading(true);
    listSections({ v: 'full', includeRetired: false }, ac.signal)
        .then((rows: SectionDtoLike[]) => setAllSections(Array.isArray(rows) ? rows : []))
        .catch(() => setAllSections([]))
        .finally(() => setSectionsLoading(false));

    // Fetch categories for compile
    listReportCategories()
        .then((cats) => setCategories(cats))
        .catch(() => setCategories([]));

    return () => ac.abort();
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      if (mode !== 'edit' || !reportId) {
        setForm(buildEmptyForm());
        setSavedReport(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setSaveError(null);
        setCompileError(null);

        const report = await getReport(reportId);
        if (cancelled) return;

        setSavedReport(report);
        setForm(parseSavedReportToForm(report));
      } catch (e: any) {
        if (!cancelled) {
          setSaveError(e?.message ?? 'Failed to load report');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, [mode, reportId]);

  const detailModel: ReportDetailModel = {
    uuid: form.uuid,
    name: form.name,
    description: form.description,
  };

  const definitionDraft: ReportDefinitionDraft = {
    name: form.name,
    description: form.description,
    code: form.code,
    sections: form.sections,
  };

  const designDraft: ReportDesignDraft = form.design;

  const sectionNameLookup = React.useMemo(() => {
    return allSections.reduce<Record<string, string>>((acc, s) => {
      acc[s.uuid] = s.name ?? s.uuid;
      return acc;
    }, {});
  }, [allSections]);

  const sectionSources = React.useMemo<DesignSectionSource[]>(() => {
    const chosen = Array.isArray(form.sections) ? form.sections : [];
    const sectionMap = new Map(allSections.map((s) => [s.uuid, s]));

    return chosen
        // A section ref repeated in a saved definition would otherwise
        // duplicate the whole group in the design
        .filter((ref: any, idx: number) => chosen.findIndex((r: any) => r.sectionUuid === ref.sectionUuid) === idx)
        .slice()
        .sort((a: any, b: any) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
        .map((ref: any) => {
          const section = sectionMap.get(ref.sectionUuid);
          const cfg = safeParseJson(section?.configJson);
          const indicators = Array.isArray(cfg?.indicators) ? cfg.indicators : [];

          return {
            sectionUuid: ref.sectionUuid,
            title: ref.titleOverride?.trim() || section?.name || ref.sectionUuid,
            indicators: indicators
                .slice()
                .sort((a: any, b: any) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
                .map((i: any) => ({
                  // Scope by section so the same indicator in two sections
                  // can never collide on row id. Fallbacks are content-derived
                  // (no crypto.randomUUID, no list index) so ids survive page
                  // reloads, merges, and indicator reordering.
                  id: `${ref.sectionUuid}__${String(
                      i.indicatorUuid ?? i.id ?? i.code ?? (fallbackIndicatorId(String(i.code ?? ''), String(i.name ?? '')) || 'indicator'),
                  )}`,
                  code: String(i.code ?? ''),
                  name: String(i.name ?? i.code ?? ''),
                  type: String(i.kind ?? 'indicator'),
                })),
          };
        });
  }, [allSections, form.sections]);

  const handleDetailChange = React.useCallback((next: ReportDetailModel) => {
    setForm((prev) => ({
      ...prev,
      name: next.name,
      description: next.description,
      uuid: next.uuid,
      code: prev.code?.trim() ? prev.code : slugifyCode(next.name),
    }));
  }, []);

  const handleDefinitionChange = React.useCallback((next: ReportDefinitionDraft) => {
    setForm((prev) => ({
      ...prev,
      code: next.code,
      sections: next.sections,
    }));
  }, []);

  const handleDesignChange = React.useCallback((next: ReportDesignDraft) => {
    setForm((prev) => ({
      ...prev,
      design: next,
    }));
  }, []);

  const handleDraftSave = React.useCallback(async () => {
    try {
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(null);
      setCompileError(null);

      const authoringJson = {
        version: 1,
        uuid: savedReport?.uuid ?? form.uuid,
        name: form.name,
        code: form.code || slugifyCode(form.name),
        description: form.description,
        definition: {
          sections: form.sections ?? [],
        },
        design: form.design,
        // Include category and theme in config
        categoryUuid: form.categoryUuid,
        themeUuid: form.themeUuid,
      };

      const payload = {
        name: authoringJson.name,
        description: authoringJson.description,
        code: authoringJson.code,
        configJson: JSON.stringify(authoringJson, null, 2),
        // Also store in metaJson for easier access
        metaJson: JSON.stringify({
          categoryUuid: form.categoryUuid,
          themeUuid: form.themeUuid,
        }),
      };

      const result =
          mode === 'edit' && (savedReport?.uuid || reportId)
              ? await updateReport((savedReport?.uuid || reportId) as string, payload)
              : await createReport(payload);

      setSavedReport(result);
      setForm((prev) => ({
        ...prev,
        uuid: result.uuid,
        code: result.code ?? prev.code,
      }));
      setSaveSuccess('Draft saved successfully.');
      return result;
    } catch (e: any) {
      setSaveError(e?.message ?? 'Failed to save report draft');
      throw e;
    } finally {
      setSaving(false);
    }
  }, [form, mode, reportId, savedReport?.uuid]);

  const handleCompile = React.useCallback(async () => {
    try {
      setCompiling(true);
      setCompileError(null);
      setCompileSuccess(null);
      setSaveError(null);

      // Check if category is set
      if (!form.categoryUuid) {
        setShowCompileSetupModal(true);
        setCompiling(false);
        return;
      }

      let targetUuid = savedReport?.uuid || reportId || null;

      if (!targetUuid) {
        const saved = await handleDraftSave();
        targetUuid = saved?.uuid ?? null;
      }

      if (!targetUuid) {
        throw new Error('Save the report first before compiling.');
      }

      // Get category name from the selected category UUID
      const category = categories.find((c) => c.uuid === form.categoryUuid)?.name;

      console.log('Aggregate Editor - Compiling with:', {
        reportUuid: targetUuid,
        categoryUuid: form.categoryUuid,
        categoryName: category,
        categoriesCount: categories.length,
      });

      // Pass category UUID instead of name to avoid "category is required" error
      const result = await compileReport(targetUuid, form.categoryUuid);

      setCompileSuccess(
          result?.reportDefinitionUuid
              ? `Compiled successfully. Runtime report UUID: ${result.reportDefinitionUuid}`
              : 'Compiled successfully.',
      );
    } catch (e: any) {
      setCompileError(e?.message ?? 'Failed to compile report');
    } finally {
      setCompiling(false);
    }
  }, [categories, form.categoryUuid, handleDraftSave, reportId, savedReport?.uuid]);

  const handleCompileSetupConfirm = React.useCallback(async (result: CompileSetupResult) => {
    setShowCompileSetupModal(false);

    // Update the form with selected category
    setForm((prev) => ({
      ...prev,
      categoryUuid: result.categoryUuid,
    }));

    // Save the updated form
    let targetUuid = savedReport?.uuid || reportId || null;

    if (!targetUuid) {
      try {
        const saved = await handleDraftSave();
        targetUuid = saved?.uuid ?? null;
      } catch (e: any) {
        setSaveError(e?.message ?? 'Failed to save report');
        return;
      }
    }

    if (!targetUuid) {
      setCompileError('Cannot compile: Report must be saved first');
      return;
    }

    setCompiling(true);
    setCompileError(null);
    setCompileSuccess(null);

    try {
      // Get category name from the selected category UUID
      const category = categories.find((c) => c.uuid === form.categoryUuid)?.name;

      console.log('Aggregate Editor (compile setup) - Compiling with:', {
        reportUuid: targetUuid,
        categoryUuid: form.categoryUuid,
        categoryName: category,
        categoriesCount: categories.length,
      });

      // Pass category UUID instead of name to avoid "category is required" error
      const compiledResult = await compileReport(targetUuid, form.categoryUuid);

      setCompileSuccess(
          compiledResult?.reportDefinitionUuid
              ? `Compiled successfully. Runtime report UUID: ${compiledResult.reportDefinitionUuid}`
              : 'Compiled successfully.',
      );
    } catch (e: any) {
      setCompileError(e?.message ?? 'Failed to compile report');
    } finally {
      setCompiling(false);
    }
  }, [categories, form.categoryUuid, savedReport?.uuid, reportId, handleDraftSave]);

  const handleCompileSetupCancel = React.useCallback(() => {
    setShowCompileSetupModal(false);
  }, []);

  const handleCancel = React.useCallback(() => {
    setForm(buildEmptyForm());
    setSavedReport(null);
    setSaveError(null);
    setSaveSuccess(null);
    setCompileError(null);
    setCompileSuccess(null);
    setTab('details');
  }, []);

  const canSave = Boolean(form.name.trim()) && !saving && !loading;
  const canCompile =
      hasPrivilege(RB.REPORT_COMPILE) &&
      Boolean((savedReport?.uuid || reportId || form.name.trim()) && !saving && !compiling && !loading);

  // Stringify once per form change so drag interactions in the design editor
  // don't re-serialize the whole form on every render.
  const formDebugJson = React.useMemo(
      () =>
          JSON.stringify(
              {
                uuid: form.uuid,
                name: form.name,
                description: form.description,
                code: form.code,
                definition: {
                  sections: form.sections,
                },
                design: form.design,
                sectionSources,
                mode,
                savedReportUuid: savedReport?.uuid ?? null,
              },
              null,
              2,
          ),
      [form, sectionSources, mode, savedReport],
  );

  return (
      <>
        <Header
            title={t('reportBuilder', 'Report Builder')}
            subtitle={t('reportBuilderSubtitle', 'Create and manage reports as collections of reusable sections.')}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '1rem' }}>
          <div>
            {loading ? <InlineLoading description="Loading report…" /> : null}
            {sectionsLoading ? <InlineLoading description="Loading sections…" /> : null}
            {saving ? <InlineLoading description="Saving draft…" /> : null}
            {compiling ? <InlineLoading description="Compiling report…" /> : null}

            {!loading && !saving && saveError ? (
                <InlineNotification lowContrast kind="error" title="Save failed" subtitle={saveError} />
            ) : null}

            {!loading && !saving && saveSuccess ? (
                <InlineNotification lowContrast kind="success" title="Saved" subtitle={saveSuccess} />
            ) : null}

            {!loading && !compiling && compileError ? (
                <InlineNotification lowContrast kind="error" title="Compile failed" subtitle={compileError} />
            ) : null}

            {!loading && !compiling && compileSuccess ? (
                <InlineNotification lowContrast kind="success" title="Compiled" subtitle={compileSuccess} />
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <AiAssistButton context={{ page: 'Report Builder' }} size="sm" kind="secondary" />

            <Button size="sm" kind="secondary" renderIcon={Download} disabled>
              Export
            </Button>

            <Button size="sm" kind="secondary" onClick={handleCompile} disabled={!canCompile}>
              Compile
            </Button>

            <Button size="sm" kind="primary" renderIcon={Save} onClick={handleDraftSave} disabled={!canSave}>
              Save Draft
            </Button>
          </div>
        </div>

        <Tabs
            selectedIndex={tab === 'details' ? 0 : tab === 'definition' ? 1 : 2}
            onChange={({ selectedIndex }) =>
                setTab(selectedIndex === 0 ? 'details' : selectedIndex === 1 ? 'definition' : 'design')
            }
        >
          <TabList aria-label="Report editor tabs">
            <Tab>Report Detail</Tab>
            <Tab>Report Definition</Tab>
            <Tab>Report Design</Tab>
          </TabList>

          <TabPanels>
            <TabPanel>
              <ReportDetail
                  value={detailModel}
                  onChange={handleDetailChange}
                  onSaveDraft={handleDraftSave}
                  isSaving={saving}
                  onCancel={handleCancel}
              />
            </TabPanel>

            <TabPanel>
              <ReportDefinitionEditor
                  value={definitionDraft}
                  onChange={handleDefinitionChange}
              />
            </TabPanel>

            <TabPanel>
              <ReportDesignEditor
                  value={designDraft}
                  onChange={handleDesignChange}
                  definitionDraft={definitionDraft}
                  sectionSources={sectionSources}
                  sectionNameLookup={sectionNameLookup}
              />
            </TabPanel>
          </TabPanels>
        </Tabs>

        <div
            style={{
              marginTop: '1rem',
              padding: '0.9rem 1rem',
              background: '#fff',
              border: '1px solid var(--cds-border-subtle, #e0e0e0)',
              borderRadius: 12,
            }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Current Report Form</div>

          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>
          {formDebugJson}
        </pre>
        </div>

        {/* Compile Setup Modal */}
        <CompileSetupModal
          open={showCompileSetupModal}
          currentCategoryUuid={form.categoryUuid}
          onConfirm={handleCompileSetupConfirm}
          onClose={handleCompileSetupCancel}
          reportType="aggregate"
        />
      </>
  );
}