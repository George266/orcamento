export const DateUtils = {
    /**
     * Returns the Nth working day of a given month/year.
     * Considers Mon-Fri as working days. Does not account for holidays (needs a list).
     * @param {number} year - Full year (e.g. 2023)
     * @param {number} month - Month 0-11 (0=Jan)
     * @param {number} n - The Nth business day (default 5)
     * @returns {Date}
     */
    getBusinessDay: (year, month, n = 5) => {
        let date = new Date(year, month, 1);
        let count = 0;

        while (count < n) {
            const day = date.getDay();
            // 0=Sun, 6=Sat
            if (day !== 0 && day !== 6) {
                count++;
            }
            if (count < n) {
                date.setDate(date.getDate() + 1);
            }
        }
        return date;
    },

    /**
     * Checks if current date is past the 5th business day (or configured day)
     * of the current month.
     * @param {number} deadlineDay - The day number (for 'fixed_date') or the Nth business day (for 'business_day'). Default 5.
     * @param {'business_day' | 'fixed_date'} rule - The rule to determine the deadline. Default 'business_day'.
     * @returns {boolean}
     */
    isPastDeadline: (deadlineDay = 5, rule = 'business_day') => {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-11

        let deadlineDate;

        if (rule === 'fixed_date') {
            deadlineDate = new Date(year, month, deadlineDay);
            // If fixed date falls on weekend, maybe move to next Monday? 
            // For simplicity, let's stick to the exact date for now or strict rule.
        } else {
            deadlineDate = DateUtils.getBusinessDay(year, month, deadlineDay);
        }

        // Set to end of day to be permissive or start of next day?
        // Usually "until end of day X". So if Now > Day X 23:59...
        // Let's compare just dates for safety
        today.setHours(0, 0, 0, 0);
        deadlineDate.setHours(0, 0, 0, 0);

        return today > deadlineDate;
    },

    /**
     * Returns "Current Month" formatted as "MonthName YYYY" or "YYYY-MM"
     * @param {string} format - 'long' | 'iso'
     */
    getCurrentMonthLabel: (format = 'long') => {
        const now = new Date();
        const current = new Date(now.getFullYear(), now.getMonth(), 1);

        if (format === 'iso') {
            const m = (current.getMonth() + 1).toString().padStart(2, '0');
            return `${current.getFullYear()}-${m}`;
        }

        if (format === 'short') {
            const shortMonths = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
            const yy = current.getFullYear().toString().slice(-2);
            return `${shortMonths[current.getMonth()]}/${yy}`;
        }

        const monthNames = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        return `${monthNames[current.getMonth()]} ${current.getFullYear()}`;
    },

    /**
     * Returns "Previous Month" formatted as "MonthName YYYY" or "YYYY-MM"
     * @param {string} format - 'long' | 'iso'
     */
    getPreviousMonthLabel: (format = 'long') => {
        const now = new Date();
        // Go to first day of previous month
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        if (format === 'iso') {
            const m = (prev.getMonth() + 1).toString().padStart(2, '0');
            return `${prev.getFullYear()}-${m}`;
        }

        if (format === 'short') {
            const shortMonths = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
            const yy = prev.getFullYear().toString().slice(-2);
            return `${shortMonths[prev.getMonth()]}/${yy}`;
        }

        const monthNames = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        return `${monthNames[prev.getMonth()]} ${prev.getFullYear()}`;
    }
};
