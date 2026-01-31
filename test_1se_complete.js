const { checkVideoForToday, sendEveningReminder, uploadBlackVideo } = require('./modules/media/1se.bot');
const db = require('./db');

async function test1seService() {
    console.log('🧪 Тестируем модифицированный сервис 1С видео...');
    
    try {
        // Тест 1: Проверка функции checkVideoForToday
        console.log('\n1. Проверка функции checkVideoForToday...');
        const hasVideo = await checkVideoForToday(123456); // Тестовый ID
        console.log('✅ Функция checkVideoForToday работает, результат:', hasVideo);
        
        // Тест 2: Проверка существования черного видео
        console.log('\n2. Проверка существования черного видео...');
        const fs = require('fs');
        const path = require('path');
        const VIDEO_DIR = path.resolve(__dirname, 'media/1se');
        const BLACK_VIDEO_PATH = path.join(VIDEO_DIR, 'black_1sec.mp4');
        
        if (fs.existsSync(BLACK_VIDEO_PATH)) {
            console.log('✅ Черное видео найдено:', BLACK_VIDEO_PATH);
        } else {
            console.log('❌ Черное видео не найдено:', BLACK_VIDEO_PATH);
        }
        
        // Тест 3: Проверка структуры таблицы БД
        console.log('\n3. Проверка структуры таблицы one_second_videos...');
        const tableInfo = await db.dbAll("PRAGMA table_info(one_second_videos)");
        const hasAutomaticField = tableInfo.some(col => col.name === 'is_automatic');
        
        if (hasAutomaticField) {
            console.log('✅ Поле is_automatic добавлено в таблицу');
            console.log('Структура таблицы:', tableInfo.map(col => col.name));
        } else {
            console.log('❌ Поле is_automatic не найдено в таблице');
        }
        
        // Тест 4: Проверка cron-задач
        console.log('\n4. Проверка подключения cron-задач...');
        const cronManager = require('./jobs/cron.manager');
