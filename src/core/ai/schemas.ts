import { z } from 'zod';

export const AiScalpDecisionSchema = z.object({
  action: z.enum(['BUY', 'WAIT', 'AVOID']),
  confidence: z.number().min(0).max(100),
  takeProfitPct: z.number().min(1).max(500),
  stopLossPct: z.number().min(0.5).max(30),
  suggestedAllocEth: z.number().min(0.001).max(10),
  timeframeMinutes: z.number().min(1).max(120),
  riskRewardRatio: z.number().min(0.5),
  reasoning: z.string(),
  signalsDetected: z.array(z.string()).default([]),
});

export type AiScalpDecision = z.infer<typeof AiScalpDecisionSchema>;

export const DEFAULT_AVOID_DECISION: AiScalpDecision = {
  action: 'AVOID',
  confidence: 0,
  takeProfitPct: 10,
  stopLossPct: 5,
  suggestedAllocEth: 0,
  timeframeMinutes: 15,
  riskRewardRatio: 2.0,
  reasoning: 'Invalid or inconclusive AI decision format.',
  signalsDetected: [],
};

export function parseAiResponse(rawText: string): AiScalpDecision {
  try {
    // Extract JSON block if surrounded by markdown code fences
    let jsonString = rawText.trim();
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch && jsonMatch[1]) {
      jsonString = jsonMatch[1].trim();
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
