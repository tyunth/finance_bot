const vision = require('@google-cloud/vision');
const path = require('path');
const config = require('./config');

const KEY_FILE = path.resolve(__dirname, 'google_key.json');

// Клиент Vision API
const client = new vision.ImageAnnotatorClient({
    keyFilename: KEY_FILE
});

/**
 * Парсит текст чека и извлекает товары и цены.
 * @param {Buffer} imageBuffer - Бинарные данные картинки
 */
async function parseReceipt(imageBuffer) {
    try {
        // 1. Отправляем в Google Vision
        const [result] = await client.textDetection(imageBuffer);
        const detections = result.textAnnotations;

        if (!detections || detections.length === 0) {
            return { error: 'Текст не найден' };
        }

        // detections[0].description содержит весь текст целиком
        const fullText = detections[0].description;
        const lines = fullText.split('\n');

        // 2. Анализ текста
        const items = [];
        let shopName = null;
        let totalSum = 0;

        // Регулярка для поиска цены в конце строки (например: "540.00", "1 200,00", "500")
        // Ищет число с точкой/запятой в конце строки, возможно с символом валюты (T, ₸)
        const priceRegex = /([\d\s]+[.,]?\d{0,2})\s*([T₸])?$/;
        
        // Регулярка для исключения мусорных строк (дата, итог, ндс)
        const ignoreRegex = /(итог|сумма|карта|наличными|ндс|фискальный|чек|сдача|total|sum)/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.length < 3) continue;

            // Попытка найти магазин (обычно первая значимая строка, не являющаяся заголовком чека)
            if (!shopName && !line.match(/фискальный|чек|продажа|добро пожаловать/i)) {
                shopName = line;
                continue;
            }

            // Пропускаем служебные строки
            if (line.match(ignoreRegex)) continue;

            // Ищем цену
            const match = line.match(priceRegex);
            if (match) {
                // Чистим цену (убираем пробелы, меняем запятую на точку)
                const priceStr = match[1].replace(/\s/g, '').replace(',', '.');
                const price = parseFloat(priceStr);

                // Имя товара - всё, что до цены
                let name = line.replace(match[0], '').trim();

                // Фильтр: слишком короткое имя или неадекватная цена
                if (name.length > 2 && price > 0 && price < 1000000) {
                    items.push({ name, price });
                    totalSum += price;
                }
            }
        }

        return {
            shopName: shopName || 'Неизвестный магазин',
            items: items,
            total: totalSum
        };

    } catch (e) {
        console.error('Ошибка OCR:', e);
        return { error: e.message };
    }
}

module.exports = {
    parseReceipt
};
