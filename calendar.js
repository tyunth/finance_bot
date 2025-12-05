const { google } = require('googleapis');
const path = require('path');
const config = require('./config');

const KEY_FILE = path.resolve(__dirname, 'google_key.json');

// Аутентификация
let auth;
try {
    auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/calendar'],
    });
} catch (e) {
    console.error("Ошибка инициализации Google Auth:", e.message);
}

const calendar = google.calendar({ version: 'v3', auth });

/**
 * Получает события календаря, которые закончились недавно (или сегодня).
 * @param {Function} logCallback - функция для отправки логов
 */
async function getRecentLessons(logCallback = console.log) {
    if (!auth) {
        logCallback('Ошибка: Google Auth не настроен (нет файла ключа?).');
        return [];
    }

    const now = new Date();
    // Ищем события за сегодня
    const timeMin = new Date(now);
    timeMin.setHours(0, 0, 0, 0);
    
    const timeMax = now.toISOString();

    try {
        logCallback(`Запрос к календарю... (${timeMin.toLocaleTimeString()} - ${now.toLocaleTimeString()})`);
        
        const response = await calendar.events.list({
            calendarId: config.CALENDAR_ID,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items || [];
        logCallback(`Найдено событий всего: ${events.length}`);
        
        // Фильтрация
        const relevantEvents = events.filter(event => {
            const summary = event.summary || '';
            
            // Проверка по ключевым словам
            const isRelevant = config.KEYWORDS.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
            
            if (!isRelevant) return false;
            
            // Проверка времени окончания
            const end = new Date(event.end.dateTime || event.end.date);
            const diffMinutes = (now - end) / (1000 * 60);
            
            if (diffMinutes < 30) {
                 logCallback(`-- Пропуск: "${summary}" (закончился ${Math.round(diffMinutes)} мин назад, ждем 30 мин)`);
                 return false;
            }

            logCallback(`++ Подходит: "${summary}"`);
            return true;
        });

        return relevantEvents;

    } catch (error) {
        logCallback(`Ошибка Google Calendar API: ${error.message}`);
        return [];
    }
}

/**
 * Удаляет событие из календаря.
 */
async function deleteEvent(eventId) {
    try {
        await calendar.events.delete({
            calendarId: config.CALENDAR_ID,
            eventId: eventId,
        });
        return true;
    } catch (error) {
        // Если событие уже удалено (404), считаем это успехом
        if (error.code === 404 || (error.errors && error.errors[0].reason === 'notFound')) {
            return true;
        }
        console.error('Ошибка удаления события:', error.message);
        return false;
    }
}

/**
 * Парсит название события для получения Имени и Предмета.
 */
function parseLessonInfo(summary) {
    const parts = summary.split(' ');
    const studentName = parts[0]; 
    
    let subject = 'Математика';
    if (summary.toLowerCase().includes('го')) {
        subject = 'Го';
    }
    
    return { studentName, subject };
}

module.exports = {
    getRecentLessons,
    deleteEvent,
    parseLessonInfo
};