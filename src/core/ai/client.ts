import axios from 'axios';
import { AiScalpDecision, parseAiResponse, DEFAULT_AVOID_DECISION } from './schemas.js';
import { buildScalpSystemPrompt, buildScalpUserPrompt, ScalpCandidateInput } from './prompt.js';

export interface AiClientConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  chainId: number;
  role?: 'hunter' | 'auditor';
  timeoutMs?: number;
}

export class AiScalpEngine {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private chainId: number;
  private timeoutMs: number;
  public role: 'hunter' | 'auditor';

  constructor(config: AiClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    this.model = config.model || (config.chainId === 8453 ? 'deepseek/deepseek-chat' : 'anthropic/claude-3.5-sonnet');
    this.chainId = config.chainId;
    this.role = config.role || 'auditor';
    this.timeoutMs = config.timeoutMs || 35000;
  }

  protected async callLlmApi(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error(`AI API Key is not configured for chain ${this.chainId}`);
    }

    const response = await axios.post(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2, // Low temperature for consistent quantitative analysis
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/scalping-bot',
          'X-Title': 'MultiChain AIScalper',
        },
        timeout: this.timeoutMs,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error('Empty or invalid response received from LLM');
    }

    // Validate it's valid JSON before returning
    try {
      JSON.parse(content);
    } catch (parseErr) {
      throw new Error(`LLM returned non-JSON content: ${content.substring(0, 100)}`);
    }

    return content;
  }

  public async evaluateToken(input: ScalpCandidateInput, roleOverride?: 'hunter' | 'auditor'): Promise<AiScalpDecision> {
    const activeRole = roleOverride || this.role;
    try {
      const systemPrompt = buildScalpSystemPrompt(this.chainId, activeRole);
      const userPrompt = buildScalpUserPrompt(input, activeRole);

      const rawLlmResponse = await this.callLlmApi(systemPrompt, userPrompt);
      return parseAiResponse(rawLlmResponse);
    } catch (error) {
      return {
        ...DEFAULT_AVOID_DECISION,
        reasoning: `AI evaluation error: ${(error as Error).message}`,
      };
    }
  }
}
