import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  sentimentModule,
  escalationModule,
  upsellModule,
  churnModule,
  kudosModule,
  competitorModule,
  signatureModule,
  allModules,
  modulesByName,
} from '../modules';
import type { AnalysisModule } from '../../framework/types';

describe('Analysis Modules', () => {
  describe('Module Structure', () => {
    const modules = [
      sentimentModule,
      escalationModule,
      upsellModule,
      churnModule,
      kudosModule,
      competitorModule,
      signatureModule,
    ];

    modules.forEach((module) => {
      it(`should have all required fields: ${module.name}`, () => {
        expect(module.name).toBeDefined();
        expect(module.description).toBeDefined();
        expect(module.instructions).toBeDefined();
        expect(module.schema).toBeDefined();
        expect(typeof module.name).toBe('string');
        expect(typeof module.description).toBe('string');
        expect(typeof module.instructions).toBe('string');
      });

      it(`should have version field: ${module.name}`, () => {
        expect(module.version).toBeDefined();
        expect(module.version).toMatch(/^v\d+\.\d+$/);
      });
    });
  });

  describe('sentimentModule', () => {
    it('should have correct name and description', () => {
      expect(sentimentModule.name).toBe('sentiment');
      expect(sentimentModule.description).toContain('emotional tone');
    });

    it('should have instructions that mention sentiment values', () => {
      expect(sentimentModule.instructions).toContain('positive');
      expect(sentimentModule.instructions).toContain('negative');
      expect(sentimentModule.instructions).toContain('neutral');
      expect(sentimentModule.instructions).toContain('confidence');
    });

    it('should have valid schema', () => {
      const testData = {
        value: 'positive',
        confidence: 0.9,
        target: 'us',
      };
      expect(() => sentimentModule.schema.parse(testData)).not.toThrow();
    });
  });

  describe('escalationModule', () => {
    it('should have correct name and description', () => {
      expect(escalationModule.name).toBe('escalation');
      expect(escalationModule.description).toContain('escalation');
    });

    it('should have instructions that mention escalation indicators', () => {
      expect(escalationModule.instructions).toContain('detected');
      expect(escalationModule.instructions).toContain('urgency');
      expect(escalationModule.instructions).toContain('critical');
    });

    it('should have valid schema', () => {
      const testData = {
        detected: true,
        confidence: 0.8,
        urgency: 'high',
      };
      expect(() => escalationModule.schema.parse(testData)).not.toThrow();
    });
  });

  describe('upsellModule', () => {
    it('should have correct name and description', () => {
      expect(upsellModule.name).toBe('upsell');
      expect(upsellModule.description).toContain('upsell');
    });

    it('should have instructions that mention opportunity', () => {
      expect(upsellModule.instructions).toContain('opportunity');
      expect(upsellModule.instructions).toContain('product');
    });
  });

  describe('churnModule', () => {
    it('should have correct name and description', () => {
      expect(churnModule.name).toBe('churn');
      expect(churnModule.description).toContain('churn');
    });

    it('should have instructions that mention risk levels', () => {
      expect(churnModule.instructions).toContain('riskLevel');
      expect(churnModule.instructions).toContain('indicators');
      expect(churnModule.instructions).toContain('critical');
    });
  });

  describe('kudosModule', () => {
    it('should have correct name and description', () => {
      expect(kudosModule.name).toBe('kudos');
      expect(kudosModule.description).toContain('positive feedback');
    });

    it('should have instructions that mention categories', () => {
      expect(kudosModule.instructions).toContain('category');
      expect(kudosModule.instructions).toContain('product');
      expect(kudosModule.instructions).toContain('service');
    });
  });

  describe('competitorModule', () => {
    it('should have correct name and description', () => {
      expect(competitorModule.name).toBe('competitor');
      expect(competitorModule.description).toContain('competitors');
    });

    it('should have instructions that mention competitor detection', () => {
      expect(competitorModule.instructions).toContain('competitors');
      expect(competitorModule.instructions).toContain('context');
    });
  });

  describe('signatureModule', () => {
    it('should have correct name and description', () => {
      expect(signatureModule.name).toBe('signature-extraction');
      expect(signatureModule.description).toContain('signature');
    });

    it('should have instructions that mention contact fields', () => {
      expect(signatureModule.instructions).toContain('name');
      expect(signatureModule.instructions).toContain('email');
      expect(signatureModule.instructions).toContain('phone');
    });
  });

  describe('allModules', () => {
    it('should include all modules', () => {
      expect(allModules.length).toBeGreaterThanOrEqual(7);
      expect(allModules).toContain(sentimentModule);
      expect(allModules).toContain(escalationModule);
      expect(allModules).toContain(upsellModule);
      expect(allModules).toContain(churnModule);
      expect(allModules).toContain(kudosModule);
      expect(allModules).toContain(competitorModule);
      expect(allModules).toContain(signatureModule);
    });

    it('should have unique module names', () => {
      const names = allModules.map(m => m.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('modulesByName', () => {
    it('should have all modules accessible by name', () => {
      expect(modulesByName['sentiment']).toBe(sentimentModule);
      expect(modulesByName['escalation']).toBe(escalationModule);
      expect(modulesByName['upsell']).toBe(upsellModule);
      expect(modulesByName['churn']).toBe(churnModule);
      expect(modulesByName['kudos']).toBe(kudosModule);
      expect(modulesByName['competitor']).toBe(competitorModule);
      expect(modulesByName['signature-extraction']).toBe(signatureModule);
    });

    it('should return undefined for unknown module name', () => {
      expect(modulesByName['unknown']).toBeUndefined();
    });
  });

  describe('Module Schema Validation', () => {
    it('should validate sentiment module output', () => {
      const result = {
        value: 'positive',
        confidence: 0.85,
        target: 'us',
      };
      expect(() => sentimentModule.schema.parse(result)).not.toThrow();
    });

    it('should validate escalation module output', () => {
      const result = {
        detected: true,
        confidence: 0.9,
        urgency: 'critical',
        reason: 'Customer threatening to cancel',
      };
      expect(() => escalationModule.schema.parse(result)).not.toThrow();
    });

    it('should validate churn module output', () => {
      const result = {
        riskLevel: 'high',
        confidence: 0.8,
        indicators: ['threatening to cancel', 'mentioning competitors'],
      };
      expect(() => churnModule.schema.parse(result)).not.toThrow();
    });
  });
});
