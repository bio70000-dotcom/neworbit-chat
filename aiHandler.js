const OpenAI = require('openai');
const apiKey = process.env.OPENAI_API_KEY || "dummy_key";
const openai = new OpenAI({ apiKey: apiKey });

const SYSTEM_PROMPT = "너는 20대 초반의 한국인 대학생이다. 말투는 'ㅋㅋ', 'ㅎㅎ'를 섞어 쓰고 단답형으로 반응해라. 문어체 절대 금지.";

async function getResponse(history, userMessage) {
    if (apiKey === "dummy_key") return "지금은 AI가 쉬고 있어 ㅋㅋ (API키 설정 필요)";
    
    try {
        // 최근 대화 10개만 기억 (비용 절약)
        const recentHistory = history.slice(-10);
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...recentHistory,
            { role: "user", content: userMessage }
        ];

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: messages,
            max_tokens: 150,
            temperature: 0.8,
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error("AI Error:", error);
        return "아 진짜? ㅋㅋ (오류남)";
    }
}

module.exports = { getResponse };