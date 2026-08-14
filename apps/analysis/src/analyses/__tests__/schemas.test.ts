import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  sentimentSchema,
  escalationSchema,
  upsellSchema,
  churnSchema,
  kudosSchema,
  competitorSchema,
  signatureSchema,
  getAnalysisSchema,
} from '../schemas';

describe('Analysis Schemas', () => {
  describe('sentimentSchema', () => {
    it('should validate valid sentiment result', () => {
      const result = {
        value: 'positive',
        confidence: 0.9,
        target: 'us',
      };

      const parsed = sentimentSchema.parse(result);
      expect(parsed.value).toBe('positive');
      expect(parsed.confidence).toBe(0.9);
      expect(parsed.target).toBe('us');
    });

    it('should reject invalid sentiment value', () => {
      const result = {
        value: 'happy', // Invalid
        confidence: 0.9,
        target: 'us',
      };

      expect(() => sentimentSchema.parse(result)).toThrow();
    });

    it('should reject confidence outside 0-1 range', () => {
      const result = {
        value: 'positive',
        confidence: 1.5, // Invalid
        target: 'us',
      };

      expect(() => sentimentSchema.parse(result)).toThrow();
    });

    // `target` is required so the model must commit to WHO the sentiment is
    // aimed at. A verdict that silently omits it is exactly the ambiguity this
    // field exists to remove, so it must not validate.
    it('should reject a result with no target', () => {
      const result = {
        value: 'negative',
        confidence: 0.9,
      };

      expect(() => sentimentSchema.parse(result)).toThrow();
    });

    it('should reject an unrecognised target', () => {
      const result = {
        value: 'negative',
        confidence: 0.9,
        target: 'the_vendor', // Invalid
      };

      expect(() => sentimentSchema.parse(result)).toThrow();
    });

    it.each(['us', 'third_party', 'none'])('should accept target "%s"', (target) => {
      const parsed = sentimentSchema.parse({ value: 'neutral', confidence: 0.5, target });
      expect(parsed.target).toBe(target);
    });

    it('should carry the reason alongside the target', () => {
      const parsed = sentimentSchema.parse({
        value: 'neutral',
        confidence: 0.8,
        target: 'third_party',
        reason: 'Vendor is chasing the client for payment; we are only copied.',
      });

      expect(parsed.target).toBe('third_party');
      expect(parsed.reason).toContain('only copied');
    });
  });

  describe('escalationSchema', () => {
    it('should validate escalation result', () => {
      const result = {
        detected: true,
        confidence: 0.8,
        reason: 'Customer threatening to cancel',
        urgency: 'high',
      };

      const parsed = escalationSchema.parse(result);
      expect(parsed.detected).toBe(true);
      expect(parsed.confidence).toBe(0.8);
      expect(parsed.urgency).toBe('high');
    });

    it('should work with minimal fields', () => {
      const result = {
        detected: false,
        confidence: 0.3,
      };

      const parsed = escalationSchema.parse(result);
      expect(parsed.detected).toBe(false);
      expect(parsed.reason).toBeUndefined();
    });
  });

  describe('upsellSchema', () => {
    it('should validate upsell result', () => {
      const result = {
        detected: true,
        confidence: 0.7,
        opportunity: 'Customer asking about premium features',
        product: 'Premium Plan',
      };

      const parsed = upsellSchema.parse(result);
      expect(parsed.detected).toBe(true);
      expect(parsed.opportunity).toBe('Customer asking about premium features');
    });

    it('should work without optional fields', () => {
      const result = {
        detected: false,
        confidence: 0.2,
      };

      const parsed = upsellSchema.parse(result);
      expect(parsed.detected).toBe(false);
    });
  });

  describe('churnSchema', () => {
    it('should validate churn result', () => {
      const result = {
        riskLevel: 'high',
        confidence: 0.85,
        indicators: ['threatening to cancel', 'mentioning competitors'],
        reason: 'Multiple complaints',
      };

      const parsed = churnSchema.parse(result);
      expect(parsed.riskLevel).toBe('high');
      expect(parsed.indicators).toHaveLength(2);
    });

    it('should require riskLevel and confidence', () => {
      const result = {
        riskLevel: 'critical',
        confidence: 0.9,
        indicators: [],
      };

      const parsed = churnSchema.parse(result);
      expect(parsed.riskLevel).toBe('critical');
    });
  });

  describe('kudosSchema', () => {
    it('should validate kudos result', () => {
      const result = {
        detected: true,
        confidence: 0.9,
        message: 'Great product!',
        category: 'product',
      };

      const parsed = kudosSchema.parse(result);
      expect(parsed.detected).toBe(true);
      expect(parsed.category).toBe('product');
    });

    it('should accept all category types', () => {
      const categories = ['product', 'service', 'team', 'other'] as const;
      
      categories.forEach(category => {
        const result = {
          detected: true,
          confidence: 0.8,
          category,
        };
        
        const parsed = kudosSchema.parse(result);
        expect(parsed.category).toBe(category);
      });
    });
  });

  describe('competitorSchema', () => {
    it('should validate competitor result', () => {
      const result = {
        detected: true,
        confidence: 0.75,
        competitors: ['Competitor A', 'Competitor B'],
        context: 'Customer comparing us to competitors',
      };

      const parsed = competitorSchema.parse(result);
      expect(parsed.detected).toBe(true);
      expect(parsed.competitors).toHaveLength(2);
    });

    it('should work without competitors list', () => {
      const result = {
        detected: false,
        confidence: 0.1,
      };

      const parsed = competitorSchema.parse(result);
      expect(parsed.detected).toBe(false);
      expect(parsed.competitors).toBeUndefined();
    });
  });

  describe('signatureSchema', () => {
    it('should validate signature result', () => {
      const result = {
        name: 'John Doe',
        title: 'CEO',
        email: 'john@example.com',
        phone: '+1-555-1234',
      };

      const parsed = signatureSchema.parse(result);
      expect(parsed.name).toBe('John Doe');
      expect(parsed.email).toBe('john@example.com');
    });

    it('should accept a malformed email without rejecting the analysis', () => {
      // Intentionally no .email() validation: a malformed extraction must not
      // reject the entire (batched) analysis result.
      const result = {
        email: 'john [at] acme.com',
      };

      const parsed = signatureSchema.parse(result);
      expect(parsed.email).toBe('john [at] acme.com');
    });

    it('should allow all fields to be optional', () => {
      const result = {};

      const parsed = signatureSchema.parse(result);
      expect(parsed).toEqual({
        name: undefined,
        title: undefined,
        company: undefined,
        email: undefined,
        phone: undefined,
        mobile: undefined,
        address: undefined,
        website: undefined,
        linkedin: undefined,
        x: undefined,
        linktree: undefined,
      });
    });

    it('should normalize null and placeholder strings to undefined', () => {
      // Module instructions tell the model to return null for absent fields,
      // and Gemini structured output often emits "" instead — both rejected
      // the whole analysis before (the June 2026 retry-storm root cause).
      const result = {
        name: null,
        title: '',
        company: 'null',
        email: '',
        phone: 'N/A',
        website: '  ',
      };

      const parsed = signatureSchema.parse(result);
      expect(parsed.name).toBeUndefined();
      expect(parsed.title).toBeUndefined();
      expect(parsed.company).toBeUndefined();
      expect(parsed.email).toBeUndefined();
      expect(parsed.phone).toBeUndefined();
      expect(parsed.website).toBeUndefined();
    });

    it('should accept null for optional fields across analysis schemas', () => {
      expect(
        escalationSchema.parse({ detected: false, confidence: 0.9, reason: null, urgency: null })
      ).toMatchObject({ detected: false, confidence: 0.9 });
      expect(
        upsellSchema.parse({ detected: false, confidence: 0.9, opportunity: null, product: null })
      ).toMatchObject({ detected: false });
      expect(
        kudosSchema.parse({ detected: false, confidence: 0.9, message: null, category: null })
      ).toMatchObject({ detected: false });
      expect(
        competitorSchema.parse({ detected: false, confidence: 0.9, competitors: null, context: null })
      ).toMatchObject({ detected: false });
      expect(
        churnSchema.parse({ riskLevel: 'low', confidence: 0.9, indicators: [], reason: null })
      ).toMatchObject({ riskLevel: 'low' });
    });
  });

  describe('getAnalysisSchema', () => {
    it('should return correct schema for each analysis type', () => {
      expect(getAnalysisSchema('sentiment')).toBe(sentimentSchema);
      expect(getAnalysisSchema('escalation')).toBe(escalationSchema);
      expect(getAnalysisSchema('upsell')).toBe(upsellSchema);
      expect(getAnalysisSchema('churn')).toBe(churnSchema);
      expect(getAnalysisSchema('kudos')).toBe(kudosSchema);
      expect(getAnalysisSchema('competitor')).toBe(competitorSchema);
      expect(getAnalysisSchema('signature-extraction')).toBe(signatureSchema);
    });

    it('should throw error for unknown analysis type', () => {
      expect(() => getAnalysisSchema('unknown' as any)).toThrow('No schema found for analysis type: unknown');
    });
  });
});
