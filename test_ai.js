const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testConnection() {
    console.log("📡 Пробуем соединиться с Google...");
    
    // Попытка 1: Используем самую старую и надежную модель
    const modelName = "gemini-pro"; 
    
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Привет! Ты работаешь?");
        const response = await result.response;
        console.log(`✅ Успех! Модель ${modelName} ответила:`, response.text());
    } catch (error) {
        console.error(`❌ Ошибка с моделью ${modelName}:`, error.message);
        console.log("🔍 Попробуй изменить имя модели в ai.js на 'gemini-1.5-flash-001' или 'gemini-1.0-pro'");
    }
}

testConnection();
