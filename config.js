require('dotenv').config();

const CURRENCY = 'T';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const ADMIN_ID = parseInt(process.env.MY_USER_ID); 

// Настройки уроков
const LESSON_PRICE = 4000;
const KEYWORDS = ['Никита', 'Али', 'Дима', 'Удаленка', 'Го', 'Пробный урок', 'Тест','Алина','дома', 'Арина', 'Матвей', 'Инкара' ]; 

const FIXED_INCOME_AMOUNTS = {
    'Репетиторство': 4000,
    'Стипендия': 96600,
};

// Авто-категория по названию магазина (Заменил Продукты на Прочая еда)
const SHOP_MAPPINGS = {
    'Magnum': 'Прочая еда',
    'Small': 'Прочая еда',
    'Aimer': 'Прочая еда',
    'Северный': 'Прочая еда',
    'Fix Price': 'Хозтовары',
    'Аптека': 'Медицина',
    'Europharma': 'Медицина',
    'Биосфера': 'Медицина',
};

const AUTO_TAGS = {
    // Еда
    'Сладости': 'Еда', 'Мясо': 'Еда', 'Фрукты': 'Еда', 'Молочка': 'Еда', 'Снеки': 'Еда', 'Прочая еда': 'Еда', 'Алкоголь': 'Еда', 'Полуфабрикаты': 'Еда', 'Напитки': 'Еда',
    // Еда вне дома
    'Столовые/готовая еда': 'Еда вне дома', 'Кафе и рестораны': 'Еда вне дома', 'Доставки': 'Еда вне дома',
    // Товары/Разное/Крупное
    'Одежда': 'Товары', 'Обувь': 'Товары', 'Подарки': 'Разное', 'Другое': 'Разное', 'Техника': 'Крупное',
    // Хозтовары
    'Бытовая химия': 'Хозтовары', 'Хозтовары': 'Хозтовары',
    // Транспорт
    'Транспорт': 'Транспорт', 'Такси': 'Транспорт',
    // Досуг
    'Развлечения': 'Досуг',
    // Обязательные/Финансы
    'Подписки': 'Обязательные', 'Кредиты': 'Обязательные', 'Налоги': 'Обязательные', 'Коммуналка': 'Обязательные', 'Интернет': 'Обязательные',
    // Редкие/Крупные
    'Путешествия': 'Крупное',
    // Услуги
    'Медицина': 'Здоровье', 'Услуги': 'Услуги',
};

const EXPENSE_CATEGORIES = [
    ['Сладости', 'Мясо', 'Фрукты'], ['Молочка', 'Снеки', 'Прочая еда'],
    ['Столовые/готовая еда', 'Кафе и рестораны', 'Доставки'], 
	['Алкоголь','Полуфабрикаты','Напитки'],
    ['Одежда', 'Обувь', 'Подарки'], ['Другое'],
    ['Бытовая химия', 'Хозтовары'],
    ['Транспорт', 'Такси'], ['Развлечения'],
    ['Техника', 'Путешествия'],
    ['Подписки', 'Кредиты', 'Налоги'], ['Коммуналка', 'Интернет'],
    ['Медицина', 'Услуги']
];

const INCOME_CATEGORIES = [
    [`Стипендия (${FIXED_INCOME_AMOUNTS['Стипендия']} ${CURRENCY})`, `Репетиторство (${FIXED_INCOME_AMOUNTS['Репетиторство']} ${CURRENCY})`],
    ['Зарплата', 'Другое (Доход)'],
];

const STATE = {
    AWAITING_EXPENSE_AMOUNT: 'AWAITING_EXPENSE_AMOUNT',
    AWAITING_EXPENSE_COMMENT: 'AWAITING_EXPENSE_COMMENT',
    
    AWAITING_INCOME_AMOUNT: 'AWAITING_INCOME_AMOUNT',
    AWAITING_INCOME_COMMENT: 'AWAITING_INCOME_COMMENT',
    
    AWAITING_CATEGORY: 'AWAITING_CATEGORY',
    
    AWAITING_TRANSFER_SOURCE: 'AWAITING_TRANSFER_SOURCE',
    AWAITING_TRANSFER_TARGET: 'AWAITING_TRANSFER_TARGET',
    AWAITING_TRANSFER_AMOUNT: 'AWAITING_TRANSFER_AMOUNT',

    EDIT_AWAITING_AMOUNT: 'EDIT_AWAITING_AMOUNT',
    EDIT_AWAITING_COMMENT: 'EDIT_AWAITING_COMMENT',
    EDIT_AWAITING_CATEGORY: 'EDIT_AWAITING_CATEGORY',

    AWAITING_DEPOSIT_NAME: 'AWAITING_DEPOSIT_NAME',
	AWAITING_DEPOSIT_AMOUNT: 'AWAITING_DEPOSIT_AMOUNT',
    AWAITING_DEPOSIT_BANK: 'AWAITING_DEPOSIT_BANK', 
    AWAITING_DEPOSIT_RATE: 'AWAITING_DEPOSIT_RATE',
    AWAITING_DEPOSIT_TERM: 'AWAITING_DEPOSIT_TERM',
    
    AWAITING_DEPOSIT_DELETION: 'AWAITING_DEPOSIT_DELETION'
};

module.exports = {
    CURRENCY,
    CALENDAR_ID,
    ADMIN_ID,
    LESSON_PRICE,
    KEYWORDS,
    FIXED_INCOME_AMOUNTS,
    SHOP_MAPPINGS,
    AUTO_TAGS,
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    STATE
};
