export const CURRENCY = 'T';

export function formatCurrency(amount) {
    if (!amount && amount !== 0) return '0 ' + CURRENCY;
    return new Intl.NumberFormat('ru-RU').format(Math.round(amount)) + ' ' + CURRENCY;
}

export function formatPeriod(p) {
    if (p === 'urgent' || p === 'today') return 'Срочно';
    if (p === 'medium') return 'Средне';
    return 'Не к спеху';
}

// Хелпер для получения даты YYYY-MM-DD без сдвига часовых поясов
export function formatDateISO(dateObj) {
    const offset = dateObj.getTimezoneOffset() * 60000;
    return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
}
