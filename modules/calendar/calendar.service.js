const db = require('../../db');
const config = require('../../config');
const gcal = require('./calendar.driver'); // 🔥 Подключаем локальный драйвер

async function checkLessons(bot, userId) {
    if (!userId) userId = config.ADMIN_ID;
    const log = (msg) => console.log(`[Calendar] ${msg}`);

    try {
        const events = await gcal.getRecentLessons(log);
        if (!events || events.length === 0) return { count: 0, message: 'Событий нет' };

        const students = await db.getStudents(userId);
        const studentNames = students.map(s => s.name);
        const keywords = [...studentNames, 'Тест', 'Пробный', 'Урок', 'Занятие'];

        let foundCount = 0;

        for (const event of events) {
            const processed = await db.isEventProcessed(event.id);
            if (processed) continue;

            const summary = event.summary;
            const isRelevant = keywords.some(key => summary.toLowerCase().includes(key.toLowerCase()));
            if (!isRelevant) continue;

            const { studentName, subject } = gcal.parseLessonInfo(summary);
            const amount = await db.getSetting('lesson_price', 4000);

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
            
            await db.markEventProcessed(event.id, summary, 'pending');
            foundCount++;
        }
        
        return { count: foundCount, message: `Найдено новых: ${foundCount}` };

    } catch (e) {
        console.error('Calendar Service Error:', e);
        return { count: 0, message: 'Ошибка: ' + e.message };
    }
}

// --- НОВЫЕ МЕТОДЫ (Переехали из бота) ---

async function processPayment(userId, eventId, summary) {
    const { studentName, subject } = gcal.parseLessonInfo(summary);
    let lessonType = 'regular';
    if (summary.toLowerCase().includes('пробный')) lessonType = 'trial';
    
    await db.addTransaction({
        userId, 
        type: 'income', 
        amount: config.LESSON_PRICE, 
        category: 'Репетиторство',
        tag: `Ученик: ${studentName}`, 
        comment: `${subject} (${summary})`, 
        sourceAccount: null, 
        targetAccount: 'Основной',
        lesson_type: lessonType
    });
    
    await db.markEventProcessed(eventId, summary, 'paid');
    return studentName;
}

async function processDebt(userId, eventId, summary) {
    const { studentName, subject } = gcal.parseLessonInfo(summary);
    await db.addDebt(userId, studentName, subject, config.LESSON_PRICE, eventId);
    await db.markEventProcessed(eventId, summary, 'debt');
    return studentName;
}

async function processCancellation(userId, eventId, summary, reason) {
    const { studentName } = gcal.parseLessonInfo(summary);

    await db.addLessonHistory({
        userId,
        studentId: null, 
        studentName: studentName,
        date: new Date().toISOString(),
        status: `cancelled_${reason}`,
        reason: reason,
        lostIncome: config.LESSON_PRICE
    });

    await db.markEventProcessed(eventId, summary, 'cancelled');
    try { await gcal.deleteEvent(eventId); } catch(e) {}
    
    return studentName;
}

module.exports = { 
    checkLessons,
    processPayment,
    processDebt,
    processCancellation
};
