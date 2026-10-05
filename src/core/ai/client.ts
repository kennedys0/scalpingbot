import axios from 'axios';
import { AiScalpDecision, parseAiResponse, DEFAULT_AVOID_DECISION } from './schemas.js';
import { buildScalpSystemPrompt, buildScalpUserPrompt, ScalpCandidateInput } from './prompt.js';

export interface AiClientConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  chainId: number;
}

export class AiScalpEngine {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private chainId: number;

  constructor(config: AiClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
    this.model = config.model || (config.chainId === 8453 ? 'deepseek/deepseek-chat' : 'anthropic/claude-3.5-sonnet');
    this.chainId = config.chainId;
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
        timeout: 15000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response received from LLM');
    }

    return content;
  }

  public async evaluateToken(input: ScalpCandidateInput): Promise<AiScalpDecision> {
    try {
      const systemPrompt = buildScalpSystemPrompt(this.chainId);
      const userPrompt = buildScalpUserPrompt(input);

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
