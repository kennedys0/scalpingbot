import { describe, it, expect, vi } from 'vitest';
import { AiScalpDecisionSchema, parseAiResponse } from '../src/core/ai/schemas.js';
import { buildScalpSystemPrompt, buildScalpUserPrompt, buildAuditorSystemPrompt } from '../src/core/ai/prompt.js';
import { AiScalpEngine } from '../src/core/ai/client.js';

describe('Dual AI Decision Engine', () => {
  it('validates a correct structured AI response', () => {
    const rawJson = JSON.stringify({
      action: 'BUY',
      confidence: 85,
      takeProfitPct: 15.0,
      stopLossPct: 5.5,
      suggestedAllocEth: 0.02,
      timeframeMinutes: 15,
      riskRewardRatio: 2.7,
      reasoning: 'Strong volume delta surge and buy ratio at 76%.',
      signalsDetected: ['Volume Surge 3x', 'Positive CVD'],
    });

    const parsed = parseAiResponse(rawJson);
    expect(parsed.action).toBe('BUY');
    expect(parsed.confidence).toBe(85);
    expect(parsed.takeProfitPct).toBe(15.0);
    expect(parsed.stopLossPct).toBe(5.5);
    expect(parsed.riskRewardRatio).toBe(2.7);
  });

  it('rejects malformed or invalid AI response gracefully with fallback', () => {
    const invalidJson = '{"action": "INVALID_ACTION"}';
    const fallback = parseAiResponse(invalidJson);
    expect(fallback.action).toBe('AVOID');
    expect(fallback.confidence).toBe(0);
  });

  it('correctly parses AVOID/WAIT decisions with 0 values for TP, SL, and allocations', () => {
    const avoidJson = JSON.stringify({
      action: 'AVOID',
      confidence: 90,
      takeProfitPct: 0,
      stopLossPct: 0,
      suggestedAllocEth: 0,
      timeframeMinutes: 0,
      riskRewardRatio: 0,
      reasoning: 'Distribution detected, severe sell pressure and low liquidity.',
      signalsDetected: ['Sell Pressure', 'Low Liquidity'],
    });

    const parsed = parseAiResponse(avoidJson);
    expect(parsed.action).toBe('AVOID');
    expect(parsed.confidence).toBe(90);
    expect(parsed.takeProfitPct).toBe(0);
    expect(parsed.stopLossPct).toBe(0);
    expect(parsed.suggestedAllocEth).toBe(0);
    expect(parsed.timeframeMinutes).toBe(0);
    expect(parsed.riskRewardRatio).toBe(0);
    expect(parsed.reasoning).toBe('Distribution detected, severe sell pressure and low liquidity.');
    expect(parsed.signalsDetected).toContain('Sell Pressure');
  });

  it('handles percentage strings and currency symbols in numeric fields', () => {
    const rawJson = `Here is my analysis:
    \`\`\`json
    {
      "action": "buy",
      "confidence": "80%",
      "takeProfitPct": "15%",
      "stopLossPct": "5%",
      "suggestedAllocEth": "0.02",
      "timeframeMinutes": 15,
      "riskRewardRatio": "3.0",
      "reasoning": "Strong setup",
      "signalsDetected": "Bullish CVD"
    }
    \`\`\``;

    const parsed = parseAiResponse(rawJson);
    expect(parsed.action).toBe('BUY');
    expect(parsed.confidence).toBe(80);
    expect(parsed.takeProfitPct).toBe(15);
    expect(parsed.stopLossPct).toBe(5);
    expect(parsed.suggestedAllocEth).toBe(0.02);
    expect(parsed.signalsDetected).toEqual(['Bullish CVD']);
  });

  it('builds comprehensive system and user prompts with domain knowledge', () => {
    const systemPrompt = buildScalpSystemPrompt(8453);
    expect(systemPrompt).toContain('Base Chain Scalping Dynamics');
    expect(systemPrompt).toContain('Volume Delta');

    const userPrompt = buildScalpUserPrompt({
      tokenName: 'Degen Dog',
      tokenSymbol: 'DDOG',
      tokenAddress: '0x1234',
      chainName: 'Base',
      priceUsd: 0.045,
      metrics: {
        priceUsd: 0.045,
        priceChange5m: 5.2,
        priceChange1h: 18.0,
        volume5m: 25000,
        volume1h: 90000,
        buys5m: 60,
        sells5m: 20,
        buyPressureRatio5m: 0.75,
        volumeDelta5m: 12500,
        liquidityUsd: 45000,
        fdv: 300000,
        liquidityToFdvRatio: 0.15,
        isOrderFlowBullish: true,
        volatilityScore: 44,
      },
    });

    expect(userPrompt).toContain('DDOG');
    expect(userPrompt).toContain('0.75');
  });

  it('builds auditor system prompt in Bahasa Indonesia with strict risk rules', () => {
    const auditorPrompt = buildAuditorSystemPrompt(8453);
    expect(auditorPrompt).toContain('Auditor Risiko Kripto');
    expect(auditorPrompt).toContain('WAJIB BAHASA INDONESIA');
    expect(auditorPrompt).toContain('Perlindungan Modal');
    expect(auditorPrompt).toContain('Base Chain Scalping Dynamics');

    const auditorUserPrompt = buildScalpUserPrompt({
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      tokenAddress: '0x123',
      chainName: 'Base',
      priceUsd: 1.0,
      metrics: {} as any,
    }, 'auditor');

    expect(auditorUserPrompt).toContain('Lakukan audit risiko mikrostruktur');
    expect(auditorUserPrompt).toContain('Bahasa Indonesia');
  });

  it('evaluates scalp decision using configured AI client', async () => {
    const mockClient = new AiScalpEngine({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-chat',
      chainId: 8453,
    });

    // Mock the internal request
    vi.spyOn(mockClient as any, 'callLlmApi').mockResolvedValue(
      JSON.stringify({
        action: 'BUY',
        confidence: 88,
        takeProfitPct: 18.0,
        stopLossPct: 6.0,
        suggestedAllocEth: 0.03,
        timeframeMinutes: 20,
        riskRewardRatio: 3.0,
        reasoning: 'Explosive breakout on Base.',
        signalsDetected: ['High Buy Pressure', 'Clean Volume Delta'],
      })
    );

    const result = await mockClient.evaluateToken({
      tokenName: 'Test',
      tokenSymbol: 'TST',
      tokenAddress: '0xtest',
      chainName: 'Base',
      priceUsd: 1.0,
      metrics: {} as any,
    });

    expect(result.action).toBe('BUY');
    expect(result.confidence).toBe(88);
  });
});
