const vision = require('@google-cloud/vision');
const path = require('path');

const KEY_FILE = path.resolve(__dirname, 'google_key.json');

const client = new vision.ImageAnnotatorClient({
    keyFilename: KEY_FILE
});

function cleanAddress(rawAddress) {
    let clean = rawAddress.replace(/^.*(?:обл\.|г\.|город|Казахстан|Северо-Казахстанская).*?(?:,|\s{2,}|(?=\s[А-ЯA-Z0-9]))/i, '');
    clean = clean.replace(/^[\s,]+/, '');
    return clean.trim() || rawAddress;
}

function rebuildLinesFromBlocks(detections) {
    const words = detections.slice(1);
    words.sort((a, b) => a.boundingPoly.vertices[0].y - b.boundingPoly.vertices[0].y);

    const lines = [];
    let currentLine = [];
    let currentY = -1;
    const Y_TOLERANCE = 20; 

    words.forEach(word => {
        const y = word.boundingPoly.vertices[0].y;
        if (currentY === -1) {
            currentY = y;
            currentLine.push(word);
        } else if (Math.abs(y - currentY) < Y_TOLERANCE) {
            currentLine.push(word);
        } else {
            currentLine.sort((a, b) => a.boundingPoly.vertices[0].x - b.boundingPoly.vertices[0].x);
            lines.push(currentLine.map(w => w.description).join(' '));
            currentLine = [word];
            currentY = y;
        }
    });

    if (currentLine.length > 0) {
        currentLine.sort((a, b) => a.boundingPoly.vertices[0].x - b.boundingPoly.vertices[0].x);
        lines.push(currentLine.map(w => w.description).join(' '));
    }

    return lines;
}

/**
 * Пытается разбить "склеенное" число (например, 2245224 -> 2245).
 */
function trySplitNumber(val, raw) {
    // Порог 100 000
    if (val < 100000) return val;

    const s = val.toString();
    
    // 1. Проверка на точный повтор (240240 -> 240, 22452245 -> 2245)
    if (s.length % 2 === 0) {
        const half = s.length / 2;
        const p1 = s.substring(0, half);
        const p2 = s.substring(half);
        // Если половинки совпадают, берем одну
        if (p1 === p2) return parseFloat(p1);
    }
    
    // 2. Проверка на "липкий хвост" (2245224 -> 2245)
    // Актуально для больших чисел
    if (val > 10000) {
        const mid = Math.ceil(s.length / 2);
        const p1 = s.substring(0, mid);
        const p2 = s.substring(mid);    
        // Если первая часть начинается со второй (2245 начинается с 224) - это наш клиент
        if (p1.startsWith(p2) || Math.abs(parseFloat(p1) - parseFloat(p2)) < 5) {
            return parseFloat(p1);
        }
    }

    // Если число не большое, но сырая строка имеет пробел (312 624)
    // Это обрабатывается в findNumberCandidates, но на всякий случай тут тоже можно проверить
    if (raw && raw.includes(' ')) {
        const parts = raw.split(' ');
        // Если части похожи (312 и 624 - нет, но 240 и 240 - да)
        // Или если последняя часть выглядит адекватно как цена
        const lastPart = parseFloat(parts[parts.length - 1].replace(',', '.'));
        if (!isNaN(lastPart)) return lastPart;
    }

    return val;
}

/**
 * Ищет все числа в строке.
 */
function findNumberCandidates(text) {
    const candidates = [];
    
    // 1. Числа с разделителями (строго 3 цифры)
    const spacedMatches = text.matchAll(/(\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?)/g);
    for (const m of spacedMatches) {
        const raw = m[0];
        const val = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
        if (!isNaN(val)) candidates.push(trySplitNumber(val, raw));
    }
    
    // 2. Отдельные токены
    const tokens = text.match(/[\d]+(?:[.,]\d+)?/g);
    if (tokens) {
        tokens.forEach(t => {
            const val = parseFloat(t.replace(',', '.'));
            if (!isNaN(val)) candidates.push(trySplitNumber(val, t));
        });
    }
    return candidates;
}

/**
 * Специализированная функция для парсинга скриншотов чеков Magnum.
 * Использует логику, основанную на формуле (X x 1), которая ранее работала.
 */
function parseMagnumReceipt(lines, reconstructedText) {
    console.log('--- ЗАПУЩЕН parseMagnumReceipt (Старая логика) ---'); 
    const linesStr = lines.join('\n');

    // ... (1, 2, 3, 4 - Магазин, Адрес, Дата, Итого: остаются без изменений) ...

    // 1. Магазин, Адрес, Дата, Итого... (Остаются без изменений)
    const shopNameMatch = linesStr.match(/Magnum - (.*)/i);
    const shopName = shopNameMatch ? `Magnum - ${shopNameMatch[1].trim()}` : 'Magnum Super';

    let address = 'Неизвестный адрес';
    const addressLine = lines.find(l => l.match(/г\.\s*ПЕТРОПАВЛОВСК/i));
    if (addressLine) {
        const addressStartIndex = lines.indexOf(addressLine);
        const addressLines = lines.slice(addressStartIndex, addressStartIndex + 2); 
        address = cleanAddress(addressLines.join(' ')); // Предполагается, что cleanAddress доступен
    }

    let date = new Date().toISOString();
    const dateLineMatch = linesStr.match(/(\d{2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4})\s*г\.\s*в\s*(\d{2}:\d{2})/i);
    if (dateLineMatch) {
        const dateStr = `${dateLineMatch[1]} ${dateLineMatch[2]}`;
        const parts = dateStr.split(/\s+/);
        const monthMap = { 'января': 'January', 'февраля': 'February', 'марта': 'March', 'апреля': 'April', 'мая': 'May', 'июня': 'June', 'июля': 'July', 'августа': 'August', 'сентября': 'September', 'октября': 'October', 'ноября': 'November', 'декабря': 'December' };
        const day = parts[0];
        const monthRu = parts[1];
        const year = parts[2];
        const time = parts[4];

        if (monthMap[monthRu.toLowerCase()]) {
            const dateObj = new Date(`${monthMap[monthRu.toLowerCase()]} ${day}, ${year} ${time}`);
            if (!isNaN(dateObj.getTime())) date = dateObj.toISOString();
        }
    }

    let receiptTotal = 0;
    const totalMatch = linesStr.match(/Покупка\s*на\s*сумму\s*(\d+)\s*тг/i);
    if (totalMatch) {
        receiptTotal = parseFloat(totalMatch[1]);
    } else {
        const totalLineMatch = linesStr.match(/Итого:\s*(\d+)\s*тг/i);
        if (totalLineMatch) receiptTotal = parseFloat(totalLineMatch[1]);
    }


    // 5. Товары (ВОССТАНОВЛЕННАЯ ЛОГИКА)
    const startItemsLine = lines.findIndex(l => l.match(/Состав\s*чека/i));
    const endItemsLine = lines.findIndex(l => l.match(/Итого:/i));

    if (startItemsLine === -1 || endItemsLine === -1 || startItemsLine >= endItemsLine) {
        return { error: 'Не найдена зона покупок (Состав чека / Итого)', rawText: reconstructedText };
    }

    const itemLines = lines.slice(startItemsLine + 1, endItemsLine);

    // --- Логика из вашего старого рабочего кода ---
    const blocks = [];
    
    // В чеках Magnum нет нумерации, поэтому всегда currentBlock будет null 
    // и сработает else
    itemLines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) return;
        
        // Паттерн: [Кол-во] x [Ед.цена] или [Кол-во] x 1 [Имя] [Цена] тг
        // Мы ищем: (Число x 1) или (Число тг)
        
        // В чеке Magnum товар всегда завершается паттерном: [Продолжение имени] [Цена] тг
        const priceMatch = trimmedLine.match(/(\d+)\s*тг/i);
        const qtyMatch = trimmedLine.match(/(\d+)\s*[xх*]\s*\d+\s*$/i);
        
        if (priceMatch) {
            // Найдена цена - это конец блока.
            const price = parseFloat(priceMatch[1]);
            const namePart = trimmedLine.substring(0, trimmedLine.indexOf(priceMatch[0])).trim();
            
            // Если есть предыдущий блок, это его продолжение
            if (blocks.length > 0) {
                const prevBlock = blocks[blocks.length - 1];
                prevBlock.rawLines.push(trimmedLine);
                // Если предыдущий блок еще не имеет цены, это его цена
                if (!prevBlock.price) {
                     prevBlock.price = price;
                }
            } else {
                // Это первый блок, цена и имя в одной строке
                blocks.push({ name: namePart, rawLines: [trimmedLine], price: price });
            }
        } else if (qtyMatch) {
             // Найдено только количество - это начало нового блока
            const namePart = trimmedLine.substring(0, trimmedLine.indexOf(qtyMatch[0])).trim();
            blocks.push({ name: namePart, rawLines: [trimmedLine], price: 0 }); // price пока 0
        } else if (blocks.length > 0) {
            // Продолжение имени предыдущего блока
            blocks[blocks.length - 1].rawLines.push(trimmedLine);
        }
    });
    // --- Конец старой логики ---

    const items = [];
    let totalSum = 0;

    // --- Парсинг блоков ---
    for (let bIndex = 0; bIndex < blocks.length; bIndex++) {
        const block = blocks[bIndex];
        let finalPrice = block.price || 0;
        let finalName = block.name;

        // Если цена не была найдена в цикле, ищем ее сейчас (например, если она была в последней строке)
        if (finalPrice === 0) {
            const blockText = block.rawLines.join(' ');
            const priceMatch = blockText.match(/(\d+)\s*тг/i);
            if (priceMatch) {
                finalPrice = parseFloat(priceMatch[1]);
            }
        }

        // Собираем полное имя из всех строк, убирая цены и кол-ва
        const fullText = block.rawLines.join(' ');
        
        // Удаляем все цены и кол-ва из полного текста, чтобы оставить чистое имя
        let cleanName = fullText;
        if (finalPrice > 0) {
             // Удаляем паттерн "X тг" и "X x 1"
            cleanName = cleanName.replace(new RegExp(finalPrice + '\\s*тг', 'i'), '')
                                 .replace(/(\d+)\s*[xх*]\s*\d+\s*/i, '')
                                 .trim();
        }
        
        // Если имя блока было найдено (start of line) и оно длиннее, чем то, что получилось после очистки, используем его
        if (finalName.length > cleanName.length) {
            finalName = finalName + ' ' + cleanName;
        } else {
             finalName = cleanName;
        }
        
        finalName = finalName.replace(/\s+/g, ' '); // Очистка пробелов
        
        if (finalPrice > 0) {
            items.push({ name: finalName, price: finalPrice });
            totalSum += finalPrice;
            console.log(`[Magnum Parser] Товар добавлен (старый): ${finalName} (${finalPrice} тг)`);
        }
    }
    // --- Конец парсинга блоков ---


    // Проверка расхождений суммы
    let isTotalMismatch = false;
    let totalWarning = '';
    if (receiptTotal > 0 && Math.abs(totalSum - receiptTotal) > 1) {
        isTotalMismatch = true;
        totalWarning = `⚠️ Сумма товаров (${totalSum}) не совпадает с ИТОГО (${receiptTotal}). Проверьте чек!`;
    }

    if (items.length === 0) {
        console.error('[Magnum Parser] Товары не были найдены, даже со старой логикой.');
        return { error: 'Товары не найдены или ошибка', rawText: reconstructedText };
    }


    return { 
        shopName, address, date, items, total: totalSum, receiptTotalFromCheck: receiptTotal, rawText: reconstructedText,
        isTotalMismatch, totalWarning 
    };
}


async function parseReceipt(imageBuffer) {
	console.log('--- Начат парсинг (parseReceipt) ---'); // <-- Новый лог
    try {
        const [result] = await client.textDetection(imageBuffer);
        const detections = result.textAnnotations;
        if (!detections || detections.length === 0) return { error: 'Текст не найден' };

        const lines = rebuildLinesFromBlocks(detections);
        const reconstructedText = lines.join('\n');
		
		const isMagnum = lines.some(l => l.match(/Magnum\s*(?:Super)?/i));
        
        if (isMagnum) {
			console.log('*** Обнаружен Magnum! Переключение на parseMagnumReceipt. ***');
            // Если найден "Magnum", используем специализированный парсер
            return parseMagnumReceipt(lines, reconstructedText);
        }
		console.log('*** Magnum не обнаружен. Используется стандартный парсер. ***');
        // 1. Шапка
        let shopName = 'Неизвестный магазин';
        let address = '';
        const line0 = lines[0] || '';
        const line1 = lines[1] || '';
        const isLine0Address = line0.match(/обл\.|г\.|ул\.|мкр\./i);
        const isLine1Shop = line1.match(/ТОО|IP|ИП|LLP|TRADE/i);
        if (isLine0Address || isLine1Shop) { shopName = line1; address = line0; } else { shopName = line0; address = line1; }
        address = cleanAddress(address);

        // 2. Дата
        let date = new Date().toISOString(); 
        const dateLine = lines.find(l => l.match(/(?:Дата|Date|Время|Time|Күні)/i));
        if (dateLine) {
            const dateMatch = dateLine.match(/(\d{4}[-.]\d{2}[-.]\d{2})/) || dateLine.match(/(\d{2}[-.]\d{2}[-.]\d{4})/);
            if (dateMatch) {
                const d = new Date(dateMatch[0].replace(/\./g, '-'));
                if (!isNaN(d.getTime())) date = d.toISOString();
            }
        }

        // 3. Товары
		const startKeywords = /САТУ|ПРОДАЖА|SALE|Состав чека/i;  // Добавь |Состав чека
		const endKeywords = /ЖИЫНЫ|ИТОГО|TOTAL|Карта|Card|Наличными|Kaspi|Бонусов/i;  // Добавь |Бонусов для бонусных строк
        const startIndex = lines.findIndex(l => l.match(startKeywords));
        let endIndex = -1;
        if (startIndex !== -1) {
            for(let i = startIndex + 1; i < lines.length; i++) {
                if (lines[i].match(endKeywords)) { endIndex = i; break; }
            }
        }
        if (startIndex === -1 || endIndex === -1) return { error: 'Не найдена зона покупок', rawText: reconstructedText };

        // 4. Итого из чека
        let receiptTotal = 0;
        for(let i = endIndex; i < lines.length; i++) {
            const l = lines[i];
            if (l.match(/ИТОГО|Карта|Total/i)) {
                const nums = findNumberCandidates(l);
                if (nums.length > 0) {
                    const maxNum = Math.max(...nums);
                    if (maxNum > receiptTotal) receiptTotal = maxNum;
                }
            }
        }

        const itemLines = lines.slice(startIndex + 1, endIndex);
        const blocks = [];
        let currentBlock = null;

        itemLines.forEach(line => {
            if (line.match(/^\d+\.\s+/)) {
                if (currentBlock) blocks.push(currentBlock);
                currentBlock = { name: line.replace(/^\d+\.\s+/, '').trim(), rawLines: [] };
            } else {
                if (currentBlock) currentBlock.rawLines.push(line);
            }
        });
        if (currentBlock) blocks.push(currentBlock);

        const items = [];
        let totalSum = 0;

        for (let bIndex = 0; bIndex < blocks.length; bIndex++) {
            const block = blocks[bIndex];
            let finalPrice = 0;
            let found = false;
            let ignorePrice = -1; 
            
            const blockText = block.rawLines.join(' ');
            
            // --- Стратегия 1: Формула ---
            for (const l of block.rawLines) {
                const mathMatch = l.match(/^([\d.,]+)\s*[xх*]\s*([\d\s.,]+)/);
                if (mathMatch) {
                    const qty = parseFloat(mathMatch[1].replace(',', '.'));
                    
                    // "Сырая" цена
                    const rawPriceStr = mathMatch[2]; 
                    
                    // Разбиваем сырую цену на кандидатов!
                    const priceCandidates = findNumberCandidates(rawPriceStr);
                    
                    for (const unitPriceCandidate of priceCandidates) {
                        const expectedTotal = qty * unitPriceCandidate;
                        
                        // Ищем expectedTotal среди всех чисел блока (включая unitPriceCandidate, если qty=1)
                        const allNums = findNumberCandidates(blockText);
                        const matchTotal = allNums.find(n => Math.abs(n - expectedTotal) < 5);
                        
                        if (matchTotal) {
                            finalPrice = matchTotal;
                            found = true;
                            ignorePrice = unitPriceCandidate; 
                            break;
                        }
                        
                        // Если кол-во 1
                        if (Math.abs(qty - 1) < 0.01) {
                            finalPrice = unitPriceCandidate;
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }
            }

            // --- Стратегия 2: Дубликаты ---
            if (!found) {
                const allNums = findNumberCandidates(blockText);
                const counts = {};
                for (const num of allNums) counts[num] = (counts[num] || 0) + 1;
                const duplicates = Object.keys(counts)
                    .filter(n => counts[n] >= 2 && parseFloat(n) > 5)
                    .map(n => parseFloat(n))
                    .sort((a, b) => b - a);
                if (duplicates.length > 0) {
                    finalPrice = duplicates[0];
                    found = true;
                }
            }

            // --- Стратегия 3: Последнее число ---
            if (!found) {
                const orderedNums = [];
                const regex = /(\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)/g;
                let m;
                while ((m = regex.exec(blockText)) !== null) {
                     const val = parseFloat(m[0].replace(/\s/g, '').replace(',', '.'));
                     if (!isNaN(val)) orderedNums.push({ val, raw: m[0] });
                }
                
                if (orderedNums.length > 0) {
                    for (let i = orderedNums.length - 1; i >= 0; i--) {
                        const lastObj = orderedNums[i];
                        let candidate = trySplitNumber(lastObj.val, lastObj.raw);
                        
                        if (ignorePrice > 0 && Math.abs(candidate - ignorePrice) < 0.1) continue;
                        if (candidate > 5 && candidate < 1000000) {
                            finalPrice = candidate;
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (found && finalPrice > 0) {
                let cleanName = block.name;
                cleanName = cleanName.replace(new RegExp(finalPrice + '$'), '').trim();
                cleanName = cleanName.replace(/\s\d+([.,]\d+)?$/, '').trim();
                items.push({ name: cleanName, price: finalPrice });
                totalSum += finalPrice;
            }
        }

        // Проверка расхождений суммы
        let isTotalMismatch = false;
        let totalWarning = '';
        if (receiptTotal > 0 && Math.abs(totalSum - receiptTotal) > 1) {
            isTotalMismatch = true;
            totalWarning = `⚠️ Сумма товаров (${totalSum}) не совпадает с ИТОГО (${receiptTotal}). Проверьте чек!`;
        }

        return { 
            shopName, address, date, items, total: totalSum, receiptTotalFromCheck: receiptTotal, rawText: reconstructedText,
            isTotalMismatch, totalWarning 
        };
    } catch (e) {
        console.error('Ошибка OCR:', e);
        return { error: e.message };
    }
}
module.exports = { parseReceipt, parseMagnumReceipt }; // Измените на это