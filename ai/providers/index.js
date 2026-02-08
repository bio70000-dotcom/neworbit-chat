const { generateOpenAI } = require('./openaiProvider');
const { generateClova } = require('./clovaProvider');
const { generateGemini } = require('./geminiProvider');

async function generateReply(provider, params) {
  if (!provider || !provider.type) {
    throw new Error('provider.type is required');
  }
  const base = {
    model: provider.model,
    messages: params.messages,
    maxTokens: Math.min(Math.max(provider.maxTokens ?? 180, 16), 512),
    temperature: Math.min(Math.max(provider.temperature ?? 0.7, 0), 1),
    timeoutMs: params.timeoutMs ?? 4500
  };

  if (provider.type === 'openai') return await generateOpenAI(base);
  if (provider.type === 'clova') return await generateClova(base);
  if (provider.type === 'gemini') return await generateGemini(base);
  throw new Error(`Unknown provider type: ${provider.type}`);
}

module.exports = { generateReply };

