/*
import type { DiagnosisBaseConfig } from './indicator-types';

function normalizeCsvToSqlInList(csv: string) {
  const cleaned = (csv ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => String(Number(x)))
      .filter((x) => x !== 'NaN');

  return cleaned.length ? cleaned.join(',') : '1';
}

function diagnosisClause(ids: number[]) {
  if (!ids || ids.length === 0) {
    return `-- AND a.diagnosis_coded = <select a concept>`;
  }
  if (ids.length === 1) {
    return `AND a.diagnosis_coded = ${ids[0]}`;
  }
  return `AND a.diagnosis_coded IN (${ids.join(',')})`;
}

export function buildDiagnosisBaseSql(cfg: DiagnosisBaseConfig) {
  const ranks = normalizeCsvToSqlInList(cfg.dxRanksCsv);

  return `
SELECT
  COUNT(*) AS total
FROM mamba_fact_encounter_diagnosis a
JOIN mamba_fact_patients_latest_patient_demographics mdp
  ON mdp.patient_id = a.patient_id
WHERE a.date_created >= :startDate
  AND a.date_created < :endDate
  ${diagnosisClause(cfg.conceptIds)}
  AND a.certainty = '${cfg.certainty}'
  AND a.dx_rank IN (${ranks})
  ${cfg.onlyNotVoided ? 'AND a.voided = 0' : ''}
  ${cfg.requireNonNullBirthdate ? 'AND mdp.birthdate IS NOT NULL' : ''}
  ${cfg.requireNonNullGender ? 'AND mdp.gender IS NOT NULL' : ''}
;`.trim();
}*/
