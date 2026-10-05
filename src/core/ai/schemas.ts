import { z } from 'zod';

const numericPreprocessor = (val: unknown) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[%$,]/g, '').trim();
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return val;
};

export const AiScalpDecisionSchema = z.object({
  action: z.preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase().trim() : val),
    z.enum(['BUY', 'WAIT', 'AVOID'])
  ),
  confidence: z.preprocess(numericPreprocessor, z.number().min(0).max(100)),
  takeProfitPct: z.preprocess(numericPreprocessor, z.number().min(0).max(1000).default(0)),
  stopLossPct: z.preprocess(numericPreprocessor, z.number().min(0).max(100).default(0)),
  suggestedAllocEth: z.preprocess(numericPreprocessor, z.number().min(0).max(100).default(0)),
  timeframeMinutes: z.preprocess(numericPreprocessor, z.number().min(0).max(1440).default(0)),
  riskRewardRatio: z.preprocess(numericPreprocessor, z.number().min(0).default(0)),
  reasoning: z
    .preprocess((val) => (typeof val === 'string' ? val : ''), z.string())
    .default('No reasoning provided.'),
  signalsDetected: z
    .preprocess((val) => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') return [val];
      return [];
    }, z.array(z.string()))
    .default([]),
});

export type AiScalpDecision = z.infer<typeof AiScalpDecisionSchema>;

export const DEFAULT_AVOID_DECISION: AiScalpDecision = {
  action: 'AVOID',
  confidence: 0,
  takeProfitPct: 0,
  stopLossPct: 0,
  suggestedAllocEth: 0,
  timeframeMinutes: 0,
  riskRewardRatio: 0,
  reasoning: 'Invalid or inconclusive AI decision format.',
  signalsDetected: [],
};

export function parseAiResponse(rawText: string): AiScalpDecision {
  try {
    // Extract JSON block if surrounded by markdown code fences or extract outer JSON braces
    let jsonString = rawText.trim();
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch && jsonMatch[1]) {
      jsonString = jsonMatch[1].trim();
    } else {
      const braceMatch = rawText.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        jsonString = braceMatch[0].trim();
      }
    }

    const parsed = JSON.parse(jsonString);
    return AiScalpDecisionSchema.parse(parsed);
  } catch (error) {
    return {
      ...DEFAULT_AVOID_DECISION,
      reasoning: `AI response parsing failed: ${(error as Error).message}`,
    };
  }
}
