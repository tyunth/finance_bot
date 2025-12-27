const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Инициализация (если ключ в ENV)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT_RECEIPT = `
    Ты — профессиональный бухгалтерский AI. Твоя задача — оцифровать чек с изображения.
    
    ВХОДНЫЕ ДАННЫЕ:
    1. Список доступных категорий пользователя: [{{CATEGORIES}}].
    
    ИНСТРУКЦИИ:
    1. Магазин: Найди название и Адрес (улица, дом). Если адреса нет, оставь пустым.
    2. Товары: Извлеки каждую позицию.
       - Для каждого товара выбери ЛУЧШУЮ категорию из списка.
       - Если товар (например, "Бананы") однозначно относится к категории (например, "Продукты" или "Фрукты"), используй её.
       - Если подходящей категории нет, используй "Другое".
    3. Математика (ВАЖНО):
       - total_sum: Итоговая сумма, написанная внизу чека.
       - calculated_sum: Просуммируй стоимость всех найденных тобой позиций.
       - Если скидка указана отдельной строкой, НЕ включай её в позиции, но укажи в поле discount.
    
    ВЕРНИ ТОЛЬКО JSON В ТАКОМ ФОРМАТЕ:
    {
      "shop": { "name": "Название", "address": "Адрес или null" },
      "date": "YYYY-MM-DD",
      "items": [
        { "name": "Название товара", "price": 1000, "qty": 1, "sum": 1000, "category": "Категория" }
      ],
      "meta": {
        "total_receipt": 0,    // Сумма из чека
        "total_calculated": 0, // Твоя сумма (price * qty для всех)
        "discount": 0          // Скидка если есть
      }
    }
`;

// Хелпер для картинки
function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString("base64"),
            mimeType
        },
    };
}

async function parseReceipt(imageBuffer, categories) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" } 
    });

    const categoriesStr = categories.join(', ');
    const prompt = SYSTEM_PROMPT_RECEIPT.replace('{{CATEGORIES}}', categoriesStr);

    try {
        const imagePart = fileToGenerativePart(imageBuffer, "image/jpeg");
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        return JSON.parse(response.text());
    } catch (error) {
        console.error("AI Receipt Error:", error);
        return null;
    }
}

module.exports = { parseReceipt };
