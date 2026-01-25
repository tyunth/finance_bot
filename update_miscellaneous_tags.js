const db = require('./db');
const config = require('./config');

// Функция для обновления тегов транзакций с тегом "Разное"
async function updateMiscellaneousTags() {
    try {
        console.log('🔍 Начало обработки транзакций с тегом "Разное"...');

        // Получаем все транзакции с тегом "Разное" и типом "expense"
        const transactions = await db.dbAll(`
            SELECT id, category FROM transactions
            WHERE tag = 'Разное' AND type = 'expense'
        `);

        console.log(`📊 Найдено ${transactions.length} транзакций с тегом "Разное"`);

        let updatedCount = 0;

        // Обрабатываем каждую транзакцию
        for (const tx of transactions) {
            // Получаем автотег для категории
            const autoTag = db.getAutoTag(tx.category);

            // Если автотег отличается от "Разное", обновляем
            if (autoTag !== 'Разное') {
                await db.dbRun(`
                    UPDATE transactions
                    SET tag = ?
                    WHERE id = ?
                `, [autoTag, tx.id]);

                updatedCount++;
                console.log(`✅ Обновлена транзакция #${tx.id}: ${tx.category} -> ${autoTag}`);
            }
        }

        console.log(`🎉 Готово! Обновлено ${updatedCount} из ${transactions.length} транзакций`);

        return updatedCount;
    } catch (error) {
        console.error('❌ Ошибка при обновлении тегов:', error);
        throw error;
    }
}

// Запускаем скрипт
updateMiscellaneousTags()
    .then(result => {
        console.log(`📈 Всего обновлено транзакций: ${result}`);
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Скрипт завершился с ошибкой:', error);
        process.exit(1);
    });