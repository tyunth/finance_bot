const db = require('../../db');
const config = require('../../config');
const gcal = require('../../calendar'); // Твой файл calendar.js в корне

async function checkLessons(bot, userId) {
    if (!userId) userId = config.ADMIN_ID;
    
    // Логгер (отправляет в консоль, можно расширить)
    const log = (msg) => console.log(`[Calendar] ${msg}`);

    try {
        const events = await gcal.getRecentLessons(log);
        if (!events || events.length === 0) return { count: 0, message: 'Событий нет' };

        // 1. Получаем список учеников для фильтрации
        const students = await db.getStudents(userId);
        const studentNames = students.map(s => s.name);
        const keywords = [...studentNames, 'Тест', 'Пробный', 'Урок', 'Занятие'];

        let foundCount = 0;

        for (const event of events) {
            // Проверка на дубли
            const processed = await db.isEventProcessed(event.id);
            if (processed) continue;

            const summary = event.summary;
            
            // Фильтр по ключевым словам (как в старом боте)
            const isRelevant = keywords.some(key => summary.toLowerCase().includes(key.toLowerCase()));
            if (!isRelevant) continue;

            const { studentName, subject } = gcal.parseLessonInfo(summary);
            const amount = config.LESSON_PRICE;

            // Отправляем сообщение
            await bot.telegram.sendMessage(userId, 
                `🔔 *Урок завершен:*\n${summary}\n👤 ${studentName}\n📚 ${subject}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: `💰 Оплачен (+${amount})`, callback_data: `cal_paid_${event.id}` }],
                        [{ text: `📝 В долг`, callback_data: `cal_debt_${event.id}` }],
                        [{ text: `❌ Отмена/Удалить`, callback_data: `cal_cancel_menu_${event.id}` }]
                    ]}
                }
            );
            
            // Помечаем как обработанное (pending), чтобы не спамить
            await db.markEventProcessed(event.id, summary, 'pending');
            foundCount++;
        }
        
        return { count: foundCount, message: `Найдено новых: ${foundCount}` };

    } catch (e) {
        console.error('Calendar Service Error:', e);
        return { count: 0, message: 'Ошибка: ' + e.message };
    }
}

module.exports = { checkLessons };
