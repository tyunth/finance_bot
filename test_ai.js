const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;

async function getAvailableModels() {
    console.log("📡 Стучимся в Google API напрямую...");
    try {
        // Запрашиваем список всех доступных моделей
        const response = await axios.get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`
        );

        console.log("\n✅ СПИСОК ДОСТУПНЫХ МОДЕЛЕЙ:");
        const models = response.data.models;
        
        // Фильтруем только те, что умеют генерировать контент
        const chatModels = models.filter(m => m.supportedGenerationMethods.includes("generateContent"));
        
        chatModels.forEach(m => {
            console.log(`🔹 Имя: ${m.name}`);
            console.log(`   Версия: ${m.version}`);
            console.log(`   Копируй в ai.js это -> "${m.name.replace('models/', '')}"`);
            console.log("-".repeat(30));
        });

    } catch (error) {
        console.error("❌ ОШИБКА ЗАПРОСА:");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

getAvailableModels();
