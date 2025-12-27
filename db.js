const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.resolve(__dirname, 'finance.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err.message);
    } else {
        console.log('Подключение к SQLite успешно.');
        initializeTables();
    }
});

function initializeTables() {
    db.serialize(() => {
        // --- 1. Таблица Пользователей (Whitelisting) ---
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            telegram_id INTEGER UNIQUE, 
            username TEXT, 
            first_name TEXT, 
            role TEXT DEFAULT 'user', -- 'admin' или 'user'
            is_approved INTEGER DEFAULT 0, -- 0 = ждет, 1 = принят
            created_at TEXT
        )`);

        // --- 2. Основные таблицы (Обновляем структуру) ---
        
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount REAL, category TEXT, tag TEXT, comment TEXT, date TEXT, source_account TEXT, target_account TEXT, lesson_type TEXT, receipt_id INTEGER
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, balance REAL DEFAULT 0, is_deposit INTEGER DEFAULT 0, rate REAL DEFAULT 0, term_date TEXT, bank_name TEXT, start_date TEXT, UNIQUE(user_id, name)
        )`);

        // Добавляем user_id
        db.run(`CREATE TABLE IF NOT EXISTS processed_events (
            event_id TEXT PRIMARY KEY, user_id INTEGER, summary TEXT, date TEXT, status TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, student_name TEXT, subject TEXT, amount REAL, date TEXT, event_id TEXT, is_paid INTEGER DEFAULT 0
        )`);

        // Тут user_id не обязательна, так как item привязан к чеку/транзакции, у которой есть user_id
        db.run(`CREATE TABLE IF NOT EXISTS receipt_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER, item_name TEXT, quantity REAL, price REAL, shop_name TEXT, date TEXT
        )`);

        // Ранее забытая таблица чеков
        db.run(`CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, shop_name TEXT, shop_address TEXT, date TEXT, total_sum REAL, calculated_sum REAL, item_count INTEGER, discount REAL, raw_json TEXT, photo_file_id TEXT, created_at TEXT
        )`);

        // Добавляем user_id
        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, subject TEXT, parents TEXT, school TEXT, grade TEXT, teacher TEXT, phone TEXT, address TEXT, notes TEXT, parent_phone TEXT, lessons_per_week INTEGER DEFAULT 0, schedule_days TEXT DEFAULT ''
        )`);

        // Добавляем user_id
        db.run(`CREATE TABLE IF NOT EXISTS shopping_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, item_name TEXT, is_bought INTEGER DEFAULT 0, type TEXT DEFAULT 'buy', price_estimate REAL DEFAULT 0, created_at TEXT, completed_at TEXT, deleted_at TEXT, sort_order INTEGER DEFAULT 0
        )`);

        // Добавляем user_id
        db.run(`CREATE TABLE IF NOT EXISTS utility_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, date TEXT, service_name TEXT, value_read REAL, amount_paid REAL, comment TEXT
        )`);

        // Добавляем user_id
        db.run(`CREATE TABLE IF NOT EXISTS lesson_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, student_id INTEGER, student_name TEXT, date TEXT, status TEXT, reason TEXT, lost_income REAL DEFAULT 0
        )`);

        // Добавляем user_id
        db.run(`CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, text TEXT, is_done INTEGER DEFAULT 0, period TEXT DEFAULT 'urgent', created_at TEXT, completed_at TEXT, deleted_at TEXT
        )`);

        // Таблицы для обучения (ML) - делаем их персональными
        db.run(`CREATE TABLE IF NOT EXISTS product_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, raw_name TEXT UNIQUE, category TEXT
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, keyword TEXT UNIQUE, category TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, type TEXT, created_at TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS health_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            user_id INTEGER, 
            date TEXT, 
            steps INTEGER, 
            weight REAL,
            created_at TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS english_words (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            user_id INTEGER, 
            word TEXT, 
            translation TEXT, 
            definition TEXT, 
            example TEXT,
            level TEXT DEFAULT 'B1-B2',
            date TEXT
        )`);

        // Таблица настроек (Ключ - Значение)
        db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
        )`);
    
        // Заполним дефолтной ценой урока, если нет
        db.get("SELECT key FROM settings WHERE key = 'lesson_price'", (err, row) => {
            if (!row) db.run("INSERT INTO settings (key, value) VALUES ('lesson_price', '4000')");
        });
        // Миграция для модулей (Permissions)
        db.run("ALTER TABLE users ADD COLUMN modules TEXT DEFAULT 'finance'", () => {});


        // --- 3. МИГРАЦИЯ ДАННЫХ (Добавляем user_id везде, где его нет) ---

        const tablesNeedingUserId = [
            'processed_events', 'students', 'shopping_list', 
            'utility_readings', 'lesson_history', 'todos', 
            'product_mappings', 'keywords', 'categories'
        ];

        tablesNeedingUserId.forEach(table => {
            // 1. Пытаемся добавить колонку user_id
            db.run(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER`, (err) => {
                if (!err) {
                    console.log(`✅ Migrated: Added user_id to ${table}`);
                    
                    // 2. Если колонка успешно добавлена, значит это старые данные.
                    // Нужно присвоить их ТЕБЕ (Админу). 
                    // Мы возьмем твой ID из таблицы transactions (так как там он точно есть).
                    const sqlFix = `UPDATE ${table} SET user_id = (SELECT user_id FROM transactions LIMIT 1) WHERE user_id IS NULL`;
                    
                    db.run(sqlFix, (updateErr) => {
                        if (!updateErr) console.log(`🔄 Data fixed: Assigned rows in ${table} to main user.`);
                    });
                }
            });
        });
        
        // Отдельная миграция для shopping_list (твоя прошлая ошибка)
        const shopCols = ["is_bought INTEGER DEFAULT 0", "type TEXT DEFAULT 'buy'", "created_at TEXT", "completed_at TEXT", "deleted_at TEXT", "sort_order INTEGER DEFAULT 0"];
        shopCols.forEach(col => {
            db.run(`ALTER TABLE shopping_list ADD COLUMN ${col}`, () => {});
        });

        // Миграция для todos
        const todoCols = ["period TEXT DEFAULT 'urgent'", "created_at TEXT", "completed_at TEXT", "deleted_at TEXT"];
        todoCols.forEach(col => {
            db.run(`ALTER TABLE todos ADD COLUMN ${col}`, () => {});
        });
        
        // Миграция для students
        db.run(`ALTER TABLE students ADD COLUMN schedule_days TEXT DEFAULT ''`, () => {});
        
        // Миграция для utility_readings (comment)
        db.run(`ALTER TABLE utility_readings ADD COLUMN comment TEXT`, () => {});
    });
}

// Обертки
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(e) { e ? reject(e) : resolve(this) }));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, r) => e ? reject(e) : resolve(r)));
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, r) => e ? reject(e) : resolve(r)));

// --- БИЗНЕС-ЛОГИКА ---

// Счета
async function ensureMainAccount(userId) {
    try { await dbRun('INSERT OR IGNORE INTO accounts (user_id, name, balance) VALUES (?, ?, ?)', [userId, 'Основной', 0]); } catch (e) {}
}

async function getBalances(userId) {
    const accountsList = await dbAll('SELECT name, is_deposit, rate, term_date, bank_name, start_date FROM accounts WHERE user_id = ?', [userId]);
    const balances = {};
    accountsList.forEach(a => balances[a.name] = 0);
    if (!balances['Основной']) balances['Основной'] = 0;

    const transactions = await dbAll('SELECT type, amount, source_account, target_account FROM transactions WHERE user_id = ?', [userId]);
    transactions.forEach(t => {
        if (t.type === 'income' && t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
        else if (t.type === 'expense' && t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
        else if (t.type === 'transfer') {
            if (t.source_account) balances[t.source_account] = (balances[t.source_account] || 0) - t.amount;
            if (t.target_account) balances[t.target_account] = (balances[t.target_account] || 0) + t.amount;
        }
    });
    return { balances, accountsList };
}

// Транзакции
async function addTransaction(data) {
    const { 
        userId, type, amount, category, tag, comment, 
        sourceAccount, targetAccount, lesson_type,
        receipt_id = null 
        // date отсюда убрали, чтобы не мешался
    } = data;

    // Создаем переменную txDate (которую ты используешь в массиве ниже)
    // Берем либо дату из объекта data, либо текущую
    const txDate = data.date || new Date().toISOString();

    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, category, tag, comment, source_account, target_account, lesson_type, receipt_id, date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [
                userId, type, amount, category, tag, comment, 
                sourceAccount, targetAccount, lesson_type, 
                receipt_id, 
                txDate // <--- Теперь эта переменная существует и она правильная
            ], 
            function (err) {
                if (err) return reject(err);
                // Тут у тебя должен быть вызов updateBalance, не забудь его раскомментить в реальном коде
                resolve({ lastID: this.lastID });
            }
        );
    });
}

// Статистика
async function getPeriodStats(userId, startDate) {
    const rows = await dbAll(`SELECT type, amount FROM transactions WHERE user_id = ? AND type IN ('income', 'expense') AND date >= ?`, [userId, startDate]);
    let income = 0, expense = 0;
    rows.forEach(t => {
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
    });
    return { income, expense };
}

async function getCategoryStats(userId, startDate) {
    const rows = await dbAll(`SELECT category, amount FROM transactions WHERE user_id = ? AND type = 'expense' AND date >= ?`, [userId, startDate]);
    const stats = {};
    rows.forEach(r => {
        stats[r.category] = (stats[r.category] || 0) + r.amount;
    });
    return stats;
}

// Календарь и Долги
async function isEventProcessed(eventId) {
    const row = await dbGet('SELECT event_id FROM processed_events WHERE event_id = ?', [eventId]);
    return !!row;
}
async function markEventProcessed(eventId, summary, status) {
    const date = new Date().toISOString();
    await dbRun('INSERT OR REPLACE INTO processed_events (event_id, summary, date, status) VALUES (?, ?, ?, ?)', [eventId, summary, date, status]);
}
async function addDebt(userId, studentName, subject, amount, eventId) {
    const date = new Date().toISOString();
    await dbRun('INSERT INTO debts (user_id, student_name, subject, amount, date, event_id) VALUES (?, ?, ?, ?, ?, ?)', 
        [userId, studentName, subject, amount, date, eventId]);
}
async function getDebts(userId) {
    return dbAll('SELECT * FROM debts WHERE user_id = ? AND is_paid = 0', [userId]);
}

// Чеки и Категоризация
async function getProductCategory(rawName) {
    const cleanName = rawName.trim(); 
    const row = await dbGet('SELECT category FROM product_mappings WHERE raw_name = ?', [cleanName]);
    return row ? row.category : null;
}
async function learnProductCategory(rawName, category) {
    const cleanName = rawName.trim();
    await dbRun('INSERT OR REPLACE INTO product_mappings (raw_name, category) VALUES (?, ?)', [cleanName, category]);
}
async function saveReceiptItems(transactionId, shopName, items, dateStr) {
    const date = dateStr || new Date().toISOString();
    for (const item of items) {
        await dbRun(
            `INSERT INTO receipt_items (transaction_id, item_name, price, quantity, shop_name, date) VALUES (?, ?, ?, ?, ?, ?)`,
            [transactionId, item.name, item.price, 1, shopName, date]
        );
    }
}
async function getCategoryByComment(comment) {
    if (!comment) return null;
    const cleanComment = comment.trim().toLowerCase();
    const row = await dbGet('SELECT category FROM keywords WHERE keyword = ?', [cleanComment]);
    return row ? row.category : null;
}
async function learnKeyword(comment, category) {
    if (!comment) return;
    const cleanComment = comment.trim().toLowerCase();
    if (cleanComment.length > 50) return;
    await dbRun('INSERT OR REPLACE INTO keywords (keyword, category) VALUES (?, ?)', [cleanComment, category]);
}
async function wasInterestPaidThisMonth(userId, accountName) {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); 
    const row = await dbGet(
        `SELECT id FROM transactions WHERE user_id = ? AND category = 'Проценты' AND target_account = ? AND date LIKE ?`, 
        [userId, accountName, `${currentMonth}%`]
    );
    return !!row;
}

// --- УЧЕНИКИ ---
async function getStudents(userId) {
    return dbAll('SELECT * FROM students WHERE user_id = ? ORDER BY name ASC', [userId]);
}
async function addStudent(userId, data) { // <--- Добавили userId
    const { name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week } = data;
    return dbRun(
        `INSERT INTO students (user_id, name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week || 0]
    );
}
async function updateStudent(data) {
    const { id, name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week, schedule_days } = data;
    return dbRun(
        `UPDATE students SET name=?, subject=?, parents=?, school=?, grade=?, teacher=?, phone=?, address=?, notes=?, parent_phone=?, lessons_per_week=?, schedule_days=?
         WHERE id=?`,
        [name, subject, parents, school, grade, teacher, phone, address, notes, parent_phone, lessons_per_week || 0, schedule_days || '', id]
    );
}
async function deleteStudent(id) {
    return dbRun('DELETE FROM students WHERE id = ?', [id]);
}
async function getStudentStats(userId, studentName) { // <--- Добавили userId
    return dbAll(
        `SELECT * FROM transactions WHERE user_id = ? AND type = 'income' AND tag = ? ORDER BY date DESC`, 
        [userId, `Ученик: ${studentName}`]
    );
}

// --- СПИСОК ПОКУПОК ---

async function getShoppingList(userId) { // <--- Добавили userId
    return new Promise((resolve, reject) => {
        // Фильтруем по user_id
        db.all(
            "SELECT *, item_name AS title FROM shopping_list WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id DESC", 
            [userId], 
            (err, rows) => {
                if (err) reject(err);
                else {
                    const fixedRows = rows.map(r => ({
                        ...r,
                        title: r.title || r.item_name, 
                        is_bought: r.is_bought, 
                        is_done: r.is_bought,           
                        checked: !!r.is_bought,       
                        status: r.is_bought ? 'bought' : 'active' 
                    }));
                    resolve(fixedRows);
                }
            }
        );
    });
}

// Функция принимает объект, так как сервер шлет объект data
async function addShoppingItem(userId, data) { // <--- Добавили userId первым аргументом
    const title = data.title || data.text || data.item_name; 
    const type = data.type || 'buy';
    const price = data.price_estimate || 0;

    if (!title) return;

    const now = new Date().toISOString();
    return dbRun(
        'INSERT INTO shopping_list (user_id, item_name, is_bought, type, price_estimate, created_at) VALUES (?, ?, 0, ?, ?, ?)', 
        [userId, title, type, price, now]
    );
}

async function updateShoppingStatus(id, isBought) {
    const now = new Date().toISOString();
    const completedAt = isBought ? now : null;
    
    // Принудительно приводим к числу (0 или 1), чтобы SQLite не тупил
    const val = isBought ? 1 : 0;

    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE shopping_list SET is_bought = ?, completed_at = ? WHERE id = ?', 
            [val, completedAt, id],
            function (err) {
                if (err) {
                    console.error('❌ DB Update Error:', err);
                    reject(err);
                } else {
                    console.log(`✅ Updated ID ${id}: set is_bought = ${val}, changed: ${this.changes}`);
                    resolve({ id: this.lastID, changes: this.changes });
                }
            }
        );
    });
}

async function deleteShoppingItem(id) {
    const now = new Date().toISOString();
    return dbRun('UPDATE shopping_list SET deleted_at = ? WHERE id = ?', [now, id]);
}

async function reorderShoppingList(ids) {
    const promises = ids.map((id, index) => {
        return dbRun("UPDATE shopping_list SET sort_order = ? WHERE id = ?", [index, id]);
    });
    return Promise.all(promises);
}

// --- КОММУНАЛКА ---
async function getUtilityReadings(userId) {
    return dbAll("SELECT * FROM utility_readings WHERE user_id = ? ORDER BY date DESC", [userId]);
}
async function addUtilityReading(userId, data) { // <--- Добавили userId
    const { date, service, reading, amount, comment } = data;
    return dbRun(
        `INSERT INTO utility_readings (user_id, date, service, reading, amount, comment) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, date, service, reading || 0, amount, comment]
    );
}
async function deleteUtilityReading(id) {
    return dbRun("DELETE FROM utility_readings WHERE id = ?", [id]);
}

// --- ПРОЧЕЕ ---
async function getLessonCount(userId, monthStr) {
    const result = await dbGet(
        `SELECT COUNT(*) as count FROM transactions 
         WHERE user_id = ? AND type = 'income' AND category = 'Репетиторство' AND date LIKE ?`, 
        [userId, `${monthStr}%`]
    );
    return result ? result.count : 0;
}

async function payDebt(debtId) {
    const debt = await dbGet('SELECT * FROM debts WHERE id = ?', [debtId]);
    if (!debt) throw new Error('Долг не найден');
    await addTransaction({
        userId: debt.user_id,
        type: 'income',
        amount: debt.amount,
        category: 'Репетиторство',
        tag: `Ученик: ${debt.student_name}`,
        comment: `Оплата долга (${debt.subject}) от ${debt.date.slice(0, 10)}`,
        sourceAccount: null,
        targetAccount: 'Основной'
    });
    await dbRun('UPDATE debts SET is_paid = 1 WHERE id = ?', [debtId]);
    return true;
}

// --- СПИСОК ДЕЛ (TO-DO) ---
async function getTodos(userId) { // <--- Добавили userId
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM todos WHERE user_id = ? AND deleted_at IS NULL", [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function addTodo(userId, text, period) { // <--- Добавили userId
    const p = period || 'urgent';
    const now = new Date().toISOString();
    return dbRun(
        'INSERT INTO todos (user_id, text, is_done, period, created_at) VALUES (?, ?, 0, ?, ?)', 
        [userId, text, p, now]
    );
}

async function toggleTodo(id, isDone) {
    const now = new Date().toISOString();
    const completedAt = isDone ? now : null;
    return dbRun(
        'UPDATE todos SET is_done = ?, completed_at = ? WHERE id = ?', 
        [isDone, completedAt, id]
    );
}

async function deleteTodo(id) {
    const now = new Date().toISOString();
    return dbRun('UPDATE todos SET deleted_at = ? WHERE id = ?', [now, id]);
}

// --- ИСТОРИЯ УРОКОВ ---
async function addLessonHistory(data) {
    const { studentId, studentName, date, status, reason, lostIncome } = data;
    return dbRun(
        `INSERT INTO lesson_history (student_id, student_name, date, status, reason, lost_income) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [studentId, studentName, date, status, reason, lostIncome || 0]
    );
}

async function checkLessonHistoryExists(studentName, dateStr) {
    const row = await dbGet(
        `SELECT id FROM lesson_history WHERE student_name = ? AND date LIKE ?`, 
        [studentName, `${dateStr}%`]
    );
    return !!row;
}

async function createReceipt(userId, data, photoFileId) {
    const created = new Date().toISOString();
    
    // 1. Создаем запись чека
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO receipts (user_id, shop_name, shop_address, date, total_sum, calculated_sum, item_count, discount, raw_json, photo_file_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, 
                data.shop.name || 'Магазин', 
                data.shop.address || '', 
                data.date, 
                data.meta.total_receipt, 
                data.meta.total_calculated, 
                data.items.length, 
                data.meta.discount || 0, 
                JSON.stringify(data), 
                photoFileId, 
                created
            ],
            async function (err) {
                if (err) return reject(err);
                
                const receiptId = this.lastID;

                // 2. Создаем транзакции для каждого товара
                // (Используем нашу же функцию addTransaction, чтобы обновились балансы!)
                try {
                    for (const item of data.items) {
                        // Тут можно подключить getUserSettings, когда сделаем его
                        // Пока хардкод или передача извне, но упростим:
                        const tag = 'Покупка'; // Или передавай маппинг тегов сюда
                        
                        await addTransaction({
                            userId,
                            type: 'expense',
                            amount: item.sum,
                            category: item.category,
                            tag: tag,
                            comment: `${item.name} (${item.qty} шт)`,
                            sourceAccount: 'Основной', // Хардкод пока, потом параметризуем
                            targetAccount: null,
                            date: data.date,
                            receipt_id: receiptId // <--- ВОТ ОНО, СВЯЗЫВАНИЕ
                        });
                    }
                    resolve(receiptId);
                } catch (txErr) {
                    reject(txErr);
                }
            }
        );
    });
}

// Получить категории пользователя (возвращает простой массив строк)
async function getUserCategories(userId, type = 'expense') {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT name FROM categories WHERE user_id = ? AND type = ?", 
            [userId, type], 
            (err, rows) => {
                if (err) reject(err);
                // Превращаем [{name: 'Еда'}, {name: 'Дом'}] -> ['Еда', 'Дом']
                else resolve(rows.map(r => r.name)); 
            }
        );
    });
}

// (На будущее) Добавить новую категорию
async function addCategory(userId, name, type = 'expense') {
    return dbRun(
        "INSERT INTO categories (user_id, name, type, created_at) VALUES (?, ?, ?, ?)",
        [userId, name, type, new Date().toISOString()]
    );
}

// Получить последние удаленные элементы (Дела + Покупки)
async function getArchivedItems(userId, limit = 15) { // <--- userId
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT id, text AS title, 'todo' AS type, deleted_at FROM todos WHERE user_id = ? AND deleted_at IS NOT NULL
            UNION ALL
            SELECT id, item_name AS title, 'shop' AS type, deleted_at FROM shopping_list WHERE user_id = ? AND deleted_at IS NOT NULL
            ORDER BY deleted_at DESC LIMIT ?
        `;
        // Передаем userId дважды (для первого SELECT и для второго)
        db.all(sql, [userId, userId, limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Восстановить элемент
async function restoreItem(type, id) {
    if (type === 'todo') {
        // Убираем метку удаления
        return dbRun('UPDATE todos SET deleted_at = NULL WHERE id = ?', [id]);
    }
    if (type === 'shop') {
        // Восстанавливаем и сразу ставим статус "Не куплено" (is_bought = 0)
        return dbRun('UPDATE shopping_list SET deleted_at = NULL, is_bought = 0 WHERE id = ?', [id]);
    }
}

// --- УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ---

async function getUser(telegramId) {
    return dbGet('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
}

async function createUser(telegramId, username, firstName) {
    const now = new Date().toISOString();
    return dbRun(
        'INSERT INTO users (telegram_id, username, first_name, created_at, is_approved) VALUES (?, ?, ?, ?, 0)', 
        [telegramId, username || '', firstName || 'Unknown', now]
    );
}

async function approveUser(telegramId) {
    // Ставим is_approved = 1
    return dbRun('UPDATE users SET is_approved = 1 WHERE telegram_id = ?', [telegramId]);
}

async function addHealthRecord(userId, steps, weight) {
    const today = new Date().toISOString().split('T')[0]; // '2025-12-26'
    
    // Проверяем, есть ли уже запись за сегодня
    const existing = await dbGet('SELECT id FROM health_stats WHERE user_id = ? AND date = ?', [userId, today]);
    
    if (existing) {
        // Обновляем
        return dbRun('UPDATE health_stats SET steps = ?, weight = ? WHERE id = ?', [steps, weight, existing.id]);
    } else {
        // Создаем новую
        return dbRun(
            'INSERT INTO health_stats (user_id, date, steps, weight, created_at) VALUES (?, ?, ?, ?, ?)',
            [userId, today, steps, weight, new Date().toISOString()]
        );
    }
}

// --- УПРАВЛЕНИЕ ПРАВАМИ (МОДУЛИ) ---

async function getAllUsers() {
    return dbAll('SELECT id, telegram_id, first_name, username, role, modules FROM users ORDER BY id ASC');
}

function updateUserModules(telegramId, modules) {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET modules = ? WHERE telegram_id = ?', 
            [modules, telegramId], 
            (err) => {
                if (err) reject(err);
                else resolve(true);
            }
        );
    });
}

async function getUserModules(telegramId) {
    const user = await dbGet('SELECT modules, role FROM users WHERE telegram_id = ?', [telegramId]);
    if (!user) return ['finance']; // По умолчанию только финансы
    
    // Если админ - ему можно всё (или можно настроить 'all')
    if (user.role === 'admin') return ['all'];
    
    // Если поле пустое, даем базовый доступ
    if (!user.modules) return ['finance'];
    
    return user.modules.split(',');
}


async function addEnglishWord(userId, data) {
    const today = new Date().toISOString().split('T')[0];
    return dbRun(
        'INSERT INTO english_words (user_id, word, translation, definition, example, date) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, data.word, data.translation, data.definition, data.example, today]
    );
}


// Получить настройку (или дефолт)
function getSetting(key, defaultValue = null) {
    return new Promise((resolve, reject) => {
        db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.value : defaultValue);
        });
    });
}

// Сохранить настройку
function setSetting(key, value) {
    return new Promise((resolve, reject) => {
        // UPSERT (SQLite syntax: INSERT OR REPLACE)
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

// Получить все настройки разом
function getAllSettings() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM settings', [], (err, rows) => {
            if (err) reject(err);
            else {
                const out = {};
                rows.forEach(r => out[r.key] = r.value);
                resolve(out);
            }
        });
    });
}

// --- EXPORTS ---
module.exports = {
    db, dbRun, dbAll, dbGet,
    ensureMainAccount, addTransaction, getBalances, getPeriodStats, getCategoryStats,
    isEventProcessed, markEventProcessed, addDebt, getDebts,
    getProductCategory, learnProductCategory, saveReceiptItems,
    getCategoryByComment, learnKeyword, wasInterestPaidThisMonth,
    getStudents, addStudent, updateStudent, deleteStudent, getStudentStats,
    
    // Покупки
    getShoppingList, 
    addShoppingItem, 
    updateShoppingStatus, 
    deleteShoppingItem, 
    reorderShoppingList,

    getUtilityReadings, addUtilityReading, deleteUtilityReading, 
    getLessonCount, payDebt,
    getTodos, addTodo, toggleTodo, deleteTodo, 
    addLessonHistory, checkLessonHistoryExists, 
    createReceipt,
    getUserCategories, addCategory,
    getArchivedItems, restoreItem,
    getUser, createUser, approveUser,
    addHealthRecord,
    getAllUsers, updateUserModules, getUserModules,
    addEnglishWord,
    getSetting, setSetting, getAllSettings,
    DB_PATH
};
