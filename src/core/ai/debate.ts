import { AiScalpEngine } from './client.js';
import { ScalpCandidateInput } from './prompt.js';
import { AiScalpDecision } from './schemas.js';

export interface ConsensusDecision {
  action: 'BUY' | 'WAIT' | 'AVOID';
  consensusScore: number;
  takeProfitPct: number;
  stopLossPct: number;
  suggestedAllocEth: number;
  hunterReasoning: string;
  auditorReasoning: string;
  signalsDetected: string[];
  hunterVerdict?: AiScalpDecision;
  auditorVerdict?: AiScalpDecision;
}

export class DualAgentDebateEngine {
  private hunter: AiScalpEngine;
  private auditor: AiScalpEngine;
  private minConsensusScore: number;

  constructor(hunter: AiScalpEngine, auditor: AiScalpEngine, minConsensusScore: number = 78) {
    this.hunter = hunter;
    this.auditor = auditor;
    this.minConsensusScore = minConsensusScore;
  }

  public async debateToken(input: ScalpCandidateInput): Promise<ConsensusDecision> {
    // Run both AI evaluations concurrently with 30s timeout (both APIs max 35s, so 30s total debate timeout gives buffer)
    const DEBATE_TIMEOUT_MS = 30000;
    
    const debatePromise = Promise.all([
      this.hunter.evaluateToken(input, 'hunter'),
      this.auditor.evaluateToken(input, 'auditor'),
    ]);
    
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Debate engine timeout after 30s')), DEBATE_TIMEOUT_MS)
    );
    
    const [hunterVerdict, auditorVerdict] = await Promise.race([debatePromise, timeoutPromise]);

    // Average confidence score
    const consensusScore = Math.round((hunterVerdict.confidence + auditorVerdict.confidence) / 2);

    const safeSignals = Array.from(
      new Set([...(hunterVerdict.signalsDetected || []), ...(auditorVerdict.signalsDetected || [])])
    );

    // If Auditor flags AVOID or confidence < 60%, reject immediately!
    if (auditorVerdict.action === 'AVOID' || hunterVerdict.action === 'AVOID') {
      return {
        action: 'AVOID',
        consensusScore: Math.min(consensusScore, 50),
        takeProfitPct: 0,
        stopLossPct: 0,
        suggestedAllocEth: 0,
        hunterReasoning: hunterVerdict.reasoning,
        auditorReasoning: auditorVerdict.reasoning,
        signalsDetected: safeSignals,
        hunterVerdict,
        auditorVerdict,
      };
    }

    // Both agree on BUY and consensus meets threshold
    if (
      hunterVerdict.action === 'BUY' &&
      auditorVerdict.action === 'BUY' &&
      consensusScore >= this.minConsensusScore
    ) {
      // Conservative blend of TP and tightest SL
      const blendedTP = Math.min(hunterVerdict.takeProfitPct, auditorVerdict.takeProfitPct);
      const tightestSL = Math.min(hunterVerdict.stopLossPct, auditorVerdict.stopLossPct);
      const blendedAlloc = Math.min(hunterVerdict.suggestedAllocEth, auditorVerdict.suggestedAllocEth);

      return {
        action: 'BUY',
        consensusScore,
        takeProfitPct: blendedTP,
        stopLossPct: tightestSL,
        suggestedAllocEth: blendedAlloc,
        hunterReasoning: hunterVerdict.reasoning,
        auditorReasoning: auditorVerdict.reasoning,
        signalsDetected: safeSignals,
        hunterVerdict,
        auditorVerdict,
      };
    }

    return {
      action: 'WAIT',
      consensusScore,
      takeProfitPct: 0,
      stopLossPct: 0,
      suggestedAllocEth: 0,
      hunterReasoning: hunterVerdict.reasoning,
      auditorReasoning: auditorVerdict.reasoning,
      signalsDetected: safeSignals,
      hunterVerdict,
      auditorVerdict,
    };
  }
}
