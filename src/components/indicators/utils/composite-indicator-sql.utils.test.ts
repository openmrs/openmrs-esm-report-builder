/**
 * Unit tests for composite-indicator-sql.utils
 */

import { describe, it, expect } from '@jest/globals';
import { countSqlToPopulationSql } from './composite-indicator-sql.utils';

describe('countSqlToPopulationSql', () => {
  describe('Case 0: COUNT DISTINCT SQL', () => {
    it('should preserve FROM and WHERE clauses when converting COUNT DISTINCT', () => {
      const input = 'SELECT COUNT(DISTINCT a.client_id) AS total FROM patients a WHERE a.active = 1';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      // Should preserve the FROM and WHERE clauses
      expect(result).toContain('FROM patients a');
      expect(result).toContain('WHERE a.active = 1');
      expect(result).toContain('SELECT DISTINCT a.client_id AS client_id');
    });

    it('should handle unqualified column references', () => {
      const input = 'SELECT COUNT(DISTINCT client_id) AS total FROM patients a';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      // Should add table alias 'a.' to unqualified column
      expect(result).toContain('SELECT DISTINCT a.client_id AS client_id');
      expect(result).toContain('FROM patients a');
    });

    it('should preserve JOIN clauses', () => {
      const input =
        'SELECT COUNT(DISTINCT a.client_id) AS total FROM patients a JOIN demographics d ON d.client_id = a.client_id';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).toContain('FROM patients a');
      expect(result).toContain('JOIN demographics d');
      expect(result).toContain('SELECT DISTINCT a.client_id AS client_id');
    });

    it('should handle multi-line queries', () => {
      const input = `SELECT COUNT(DISTINCT a.client_id) AS total
                     FROM patients a
                     WHERE a.date >= :startDate
                       AND a.active = 1`;
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).toContain('FROM patients a');
      expect(result).toContain('WHERE a.date >= :startDate');
      expect(result).toContain('AND a.active = 1');
    });
  });

  describe('Case 1: Composite COUNT SQL with WITH clauses', () => {
    it('should preserve WITH CTEs and extract inner query', () => {
      const input = `WITH A AS (SELECT client_id FROM table_a WHERE x = 1),
                          B AS (SELECT client_id FROM table_b WHERE y = 2)
                     SELECT COUNT(*) AS total
                     FROM (SELECT A.client_id FROM A) X`;
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).toContain('WITH');
      expect(result).toContain('A AS (');
      expect(result).toContain('B AS (');
      expect(result).toContain('SELECT DISTINCT pop.client_id');
      expect(result).toContain('FROM (');
    });
  });

  describe('Case 2: Base COUNT SQL', () => {
    it('should convert COUNT(*) to DISTINCT select', () => {
      const input = 'SELECT COUNT(*) AS total FROM patients a WHERE a.active = 1';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).toContain('SELECT DISTINCT a.client_id AS client_id');
      expect(result).toContain('FROM patients a');
      expect(result).toContain('WHERE a.active = 1');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty input', () => {
      const result = countSqlToPopulationSql('', 'client_id', 'Patients');
      expect(result).toBe('');
    });

    it('should handle input with trailing semicolon', () => {
      const input = 'SELECT COUNT(DISTINCT a.client_id) AS total FROM patients a;';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).not.toContain(';');
      expect(result).toContain('FROM patients a');
    });

    it('should use patient_id for Encounters unit', () => {
      const input = 'SELECT COUNT(DISTINCT a.encounter_id) AS total FROM encounters a';
      const result = countSqlToPopulationSql(input, 'encounter_id', 'Encounters');

      expect(result).toContain('SELECT DISTINCT a.encounter_id AS encounter_id');
    });
  });

  describe('Improved: COUNT DISTINCT with different table aliases', () => {
    it('should handle table alias "p" instead of "a"', () => {
      const input = 'SELECT COUNT(DISTINCT p.patient_id) AS cnt FROM patients p WHERE active = 1';
      const result = countSqlToPopulationSql(input, 'patient_id', 'Patients');

      expect(result).toContain('SELECT DISTINCT p.patient_id AS patient_id');
      expect(result).toContain('FROM patients p');
      expect(result).toContain('WHERE active = 1');
    });

    it('should handle unqualified column with alias "t"', () => {
      const input = 'SELECT COUNT(DISTINCT client_id) AS count FROM my_table t';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).toContain('SELECT DISTINCT t.client_id AS client_id');
      expect(result).toContain('FROM my_table t');
    });

    it('should handle AS keyword in FROM clause', () => {
      const input = 'SELECT COUNT(DISTINCT client_id) AS total FROM patients AS p';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).toContain('SELECT DISTINCT p.client_id AS client_id');
      expect(result).toContain('FROM patients AS p');
    });

    it('should handle alias "base" for composite CTEs', () => {
      const input = 'SELECT COUNT(DISTINCT base.client_id) AS total FROM population base WHERE base.date >= :startDate';
      const result = countSqlToPopulationSql(input, 'client_id', 'Patients');

      expect(result).toContain('SELECT DISTINCT base.client_id AS client_id');
      expect(result).toContain('FROM population base');
    });

    it('should handle COUNT(*) with different table alias', () => {
      const input = 'SELECT COUNT(*) AS total FROM encounters e WHERE e.status = "completed"';
      const result = countSqlToPopulationSql(input, 'encounter_id', 'Encounters');

      expect(result).toContain('SELECT DISTINCT e.encounter_id AS encounter_id');
      expect(result).toContain('FROM encounters e');
    });
  });
});
