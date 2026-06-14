import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  sentimentAnalysisDefinition,
  escalationAnalysisDefinition,
  upsellAnalysisDefinition,
  churnAnalysisDefinition,
  kudosAnalysisDefinition,
  competitorAnalysisDefinition,
  signatureExtractionAnalysisDefinition,
  allAnalysisDefinitions,
  definitionsByType,
  getAnalysisDefinition,
} from '../definitions';
import type { AnalysisDefinition } from '../../framework/types';
import type { AnalysisType } from '@crm/shared';

describe('Analysis Definitions', () => {
  describe('Definition Structure', () => {
    const definitions = [
      sentimentAnalysisDefinition,
      escalationAnalysisDefinition,
      upsellAnalysisDefinition,
      churnAnalysisDefinition,
      kudosAnalysisDefinition,
      competitorAnalysisDefinition,
      signatureExtractionAnalysisDefinition,
    ];

    definitions.forEach((definition) => {
      it(`should have all required fields: ${definition.type}`, () => {
        expect(definition.type).toBeDefined();
        expect(definition.name).toBeDefined();
        expect(definition.module).toBeDefined();
        expect(definition.models).toBeDefined();
        expect(definition.settings).toBeDefined();
        
        expect(typeof definition.type).toBe('string');
        expect(typeof definition.name).toBe('string');
        expect(definition.models.primary).toBeDefined();
      });

      it(`should have valid module: ${definition.type}`, () => {
        expect(definition.module.name).toBeDefined();
        expect(definition.module.description).toBeDefined();
        expect(definition.module.instructions).toBeDefined();
        expect(definition.module.schema).toBeDefined();
      });

      it(`should have valid model config: ${definition.type}`, () => {
        expect(definition.models.primary).toBeTruthy();
        expect(typeof definition.models.primary).toBe('string');
        if (definition.models.fallback) {
          expect(typeof definition.models.fallback).toBe('string');
        }
      });
    });
  });

  describe('sentimentAnalysisDefinition', () => {
    it('should have correct type and name', () => {
      expect(sentimentAnalysisDefinition.type).toBe('sentiment');
      expect(sentimentAnalysisDefinition.name).toContain('Sentiment');
    });

    it('should use sentiment module', () => {
      expect(sentimentAnalysisDefinition.module.name).toBe('sentiment');
    });
  });

  describe('escalationAnalysisDefinition', () => {
    it('should have correct type and name', () => {
      expect(escalationAnalysisDefinition.type).toBe('escalation');
      expect(escalationAnalysisDefinition.name).toContain('Escalation');
    });
  });

  describe('churnAnalysisDefinition', () => {
    it('should have correct type and name', () => {
      expect(churnAnalysisDefinition.type).toBe('churn');
      expect(churnAnalysisDefinition.name).toContain('Churn');
    });
  });

  describe('signatureExtractionAnalysisDefinition', () => {
    it('should have correct type and name', () => {
      expect(signatureExtractionAnalysisDefinition.type).toBe('signature-extraction');
      expect(signatureExtractionAnalysisDefinition.name).toContain('Signature');
    });

    it('should use signature module', () => {
      expect(signatureExtractionAnalysisDefinition.module.name).toBe('signature-extraction');
    });
  });

  describe('allAnalysisDefinitions', () => {
    it('should include all definitions', () => {
      expect(allAnalysisDefinitions.length).toBeGreaterThanOrEqual(7);
      expect(allAnalysisDefinitions).toContain(sentimentAnalysisDefinition);
      expect(allAnalysisDefinitions).toContain(escalationAnalysisDefinition);
      expect(allAnalysisDefinitions).toContain(upsellAnalysisDefinition);
      expect(allAnalysisDefinitions).toContain(churnAnalysisDefinition);
      expect(allAnalysisDefinitions).toContain(kudosAnalysisDefinition);
      expect(allAnalysisDefinitions).toContain(competitorAnalysisDefinition);
      expect(allAnalysisDefinitions).toContain(signatureExtractionAnalysisDefinition);
    });

    it('should have unique analysis types', () => {
      const types = allAnalysisDefinitions.map(d => d.type);
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBe(types.length);
    });
  });

  describe('definitionsByType', () => {
    it('should have all definitions accessible by type', () => {
      expect(definitionsByType['sentiment']).toBe(sentimentAnalysisDefinition);
      expect(definitionsByType['escalation']).toBe(escalationAnalysisDefinition);
      expect(definitionsByType['upsell']).toBe(upsellAnalysisDefinition);
      expect(definitionsByType['churn']).toBe(churnAnalysisDefinition);
      expect(definitionsByType['kudos']).toBe(kudosAnalysisDefinition);
      expect(definitionsByType['competitor']).toBe(competitorAnalysisDefinition);
      expect(definitionsByType['signature-extraction']).toBe(signatureExtractionAnalysisDefinition);
    });

    it('should NOT have entries for the regex-only extraction types', () => {
      // domain-extraction and contact-extraction are pure regex returned in
      // the /analyze response payload, not LLM analyses. They were removed
      // from the AnalysisType union as part of the pipeline refactor.
      expect((definitionsByType as any)['domain-extraction']).toBeUndefined();
      expect((definitionsByType as any)['contact-extraction']).toBeUndefined();
    });
  });

  describe('getAnalysisDefinition', () => {
    it('should return definition for valid type', () => {
      expect(getAnalysisDefinition('sentiment')).toBe(sentimentAnalysisDefinition);
      expect(getAnalysisDefinition('escalation')).toBe(escalationAnalysisDefinition);
    });
  });

  describe('Definition Validation', () => {
    it('should have valid schema in each module', () => {
      allAnalysisDefinitions.forEach((definition) => {
        expect(definition.module.schema).toBeDefined();
        // Test that schema is a Zod schema by checking if it has parse method
        expect(typeof definition.module.schema.parse).toBe('function');
      });
    });

    it('should have valid instructions in each module', () => {
      allAnalysisDefinitions.forEach((definition) => {
        expect(definition.module.instructions).toBeTruthy();
        expect(definition.module.instructions.length).toBeGreaterThan(0);
      });
    });
  });
});
