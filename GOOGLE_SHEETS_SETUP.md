# Настройка Google Sheets сервиса

## Установка зависимостей

**ОБЯЗАТЕЛЬНО:** Установите необходимые зависимости:

```bash
npm install googleapis
```

Зависимость `googleapis` включает все необходимые типы TypeScript, поэтому дополнительные пакеты типов не требуются.

## Настройка Google Cloud Console

1. **Создайте проект в Google Cloud Console**
   - Перейдите на [Google Cloud Console](https://console.cloud.google.com/)
   - Создайте новый проект или выберите существующий

2. **Включите Google Sheets API**
   - В консоли перейдите в "APIs & Services" > "Library"
   - Найдите "Google Sheets API" и включите его

3. **Создайте API ключ (простой способ) ИЛИ Service Account (полный доступ)**

   ### Вариант A: Простой API ключ (только чтение публичных таблиц)
   - Перейдите в "APIs & Services" > "Credentials"
   - Нажмите "Create Credentials" > "API Key"
   - Скопируйте созданный API ключ
   - Ограничьте ключ только Google Sheets API для безопасности

   ### Вариант B: OAuth2 Client (веб-приложение с пользовательской авторизацией)
   - Перейдите в "APIs & Services" > "Credentials"
   - Нажмите "Create Credentials" > "OAuth 2.0 Client IDs"
   - Выберите "Web application"
   - Добавьте redirect URI: `http://localhost:3000/auth/google/callback`
   - Скачайте JSON файл с ключами

   ### Вариант C: Service Account (полный доступ без пользователя)
   - Перейдите в "APIs & Services" > "Credentials"
   - Нажмите "Create Credentials" > "Service Account"
   - Заполните название и описание
   - Скачайте JSON файл с ключами

4. **Настройте доступ к таблице**

   ### Для API ключа:
   - Откройте вашу Google Sheets таблицу
   - Нажмите "Share" > "Change to anyone with the link"
   - Установите права "Viewer" (для чтения) или "Editor" (для записи)
   - Скопируйте ID таблицы из URL (часть между /d/ и /edit)

   ### Для OAuth2 Client:
   - Пользователь авторизуется через Google и получает доступ к своим таблицам
   - Не требует предварительной настройки доступа к конкретным таблицам
   - Пользователь сам выбирает, к каким таблицам предоставить доступ

   ### Для Service Account:
   - Откройте вашу Google Sheets таблицу
   - Нажмите "Share" и добавьте email Service Account с правами Editor
   - Скопируйте ID таблицы из URL (часть между /d/ и /edit)

## Переменные окружения

### Для простого API ключа (рекомендуется для начала)

Добавьте в ваш `.env` файл:

```env
# Google Sheets API Configuration (простой API ключ)
GOOGLE_SHEETS_API_KEY=your_api_key_here
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here

# Опциональные настройки
GOOGLE_SHEETS_ENABLE_SYNC=true
GOOGLE_SHEETS_AUTO_CREATE_REPORTS=true
```

### Для OAuth2 Client (веб-приложение с пользовательской авторизацией)

Добавьте в ваш `.env` файл:

```env
# Google Sheets OAuth2 Configuration
GOOGLE_OAUTH_CONFIG='{"web":{"client_id":"456652326774-dulvmto2trdsb12cdpojddp8mn8ogqj7.apps.googleusercontent.com","client_secret":"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","project_id":"shopify-fwn-app","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs"}}'
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/auth/google/callback
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here

# Опциональные настройки
GOOGLE_SHEETS_ENABLE_SYNC=true
GOOGLE_SHEETS_AUTO_CREATE_REPORTS=true
```

### Для Service Account (полный функционал)

Добавьте в ваш `.env` файл:

```env
# Google Sheets API Configuration (Service Account)
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here

# Service Account настройки (из JSON файла)
GOOGLE_SHEETS_TYPE=service_account
GOOGLE_SHEETS_PROJECT_ID=your_project_id
GOOGLE_SHEETS_PRIVATE_KEY_ID=your_private_key_id
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key_here\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_CLIENT_EMAIL=your_service_account@your_project.iam.gserviceaccount.com
GOOGLE_SHEETS_CLIENT_ID=your_client_id
GOOGLE_SHEETS_AUTH_URI=https://accounts.google.com/o/oauth2/auth
GOOGLE_SHEETS_TOKEN_URI=https://oauth2.googleapis.com/token
GOOGLE_SHEETS_AUTH_PROVIDER_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
GOOGLE_SHEETS_CLIENT_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/your_service_account%40your_project.iam.gserviceaccount.com

# Опциональные настройки
GOOGLE_SHEETS_ENABLE_SYNC=true
GOOGLE_SHEETS_AUTO_CREATE_REPORTS=true
```

## Основное использование

### Выбор сервиса

#### Для простого API ключа (только чтение публичных таблиц):

```typescript
import { getGoogleSheetsSimpleService } from '~/services/googleSheetsSimple.server';

const sheetsService = getGoogleSheetsSimpleService();
```

#### Для OAuth2 Client (веб-приложение с авторизацией пользователя):

```typescript
import { getGoogleSheetsOAuth2Service, OAuth2Helper } from '~/services/googleSheetsOAuth.server';

// Создание сервиса
const config = OAuth2Helper.createConfigFromJSON(process.env.GOOGLE_OAUTH_CONFIG);
const sheetsService = getGoogleSheetsOAuth2Service(config);

// Авторизация пользователя (в веб-приложении)
const authUrl = sheetsService.generateAuthUrl();
// Перенаправить пользователя на authUrl

// После получения кода от Google
const tokens = await sheetsService.getTokensFromCode(code);
sheetsService.setCredentials(tokens);
```

#### Для Service Account (полный функционал):

```typescript
import { getGoogleSheetsService } from '~/services/googleSheets.server';

const sheetsService = getGoogleSheetsService();
```

### Инициализация сервиса

### Чтение данных

```typescript
// Чтение диапазона ячеек
const data = await sheetsService.readData({
  spreadsheetId: 'your_spreadsheet_id',
  range: 'Sheet1!A1:E10'
});

console.log(data.values); // Двумерный массив данных
```

### Запись данных

```typescript
// Перезапись данных в диапазоне
await sheetsService.writeData('spreadsheet_id', {
  range: 'Sheet1!A1:C3',
  values: [
    ['Заголовок 1', 'Заголовок 2', 'Заголовок 3'],
    ['Значение 1', 'Значение 2', 'Значение 3'],
    ['Значение 4', 'Значение 5', 'Значение 6']
  ]
});
```

### Добавление данных

```typescript
// Добавление строк в конец таблицы
await sheetsService.appendData(
  'spreadsheet_id',
  'Sheet1!A:C',
  [
    ['Новая строка 1', 'Новая строка 2', 'Новая строка 3']
  ]
);
```

### Пакетное обновление

```typescript
// Обновление нескольких диапазонов одновременно
await sheetsService.batchUpdate('spreadsheet_id', {
  ranges: [
    {
      range: 'Sheet1!A1:B2',
      values: [['A1', 'B1'], ['A2', 'B2']]
    },
    {
      range: 'Sheet1!D1:E2',
      values: [['D1', 'E1'], ['D2', 'E2']]
    }
  ]
});
```

## Интеграция с существующими сервисами

### Синхронизация данных счетов

```typescript
import { syncInvoiceToSheets } from '~/services/googleSheetsExamples';

// После парсинга PDF счета
const invoiceData = {
  supplierName: 'Supplier Name',
  items: [
    { name: 'Product 1', quantity: 5, price: 10.50, total: 52.50 },
    { name: 'Product 2', quantity: 2, price: 25.00, total: 50.00 }
  ],
  totalAmount: 102.50,
  parseDate: new Date().toISOString(),
  success: true
};

await syncInvoiceToSheets(process.env.GOOGLE_SHEETS_SPREADSHEET_ID!, invoiceData);
```

### Создание отчетов

```typescript
import { generateSupplierReport } from '~/services/googleSheetsExamples';

// Создание отчета по поставщикам
await generateSupplierReport(process.env.GOOGLE_SHEETS_SPREADSHEET_ID!);
```

## Утилиты для работы с диапазонами

```typescript
import { SheetsUtils } from '~/services/googleSheets.server';

// Создание диапазона A1 нотацией
const range = SheetsUtils.createRange('Sheet1', 1, 1, 10, 5); // "Sheet1!A1:E10"

// Парсинг диапазона
const parsed = SheetsUtils.parseRange('Sheet1!A1:E10');
// { sheetName: 'Sheet1', startRow: 1, startCol: 1, endRow: 10, endCol: 5 }

// Преобразование номера столбца в букву
const letter = SheetsUtils.columnNumberToLetter(27); // "AA"

// Преобразование буквы в номер
const number = SheetsUtils.columnLetterToNumber('AA'); // 27
```

## Обработка ошибок

```typescript
try {
  const data = await sheetsService.readData({
    spreadsheetId: 'invalid_id',
    range: 'Sheet1!A1:B2'
  });
} catch (error) {
  console.error('Ошибка при работе с Google Sheets:', error.message);
  // Обработка ошибки...
}
```

## Рекомендуемая структура таблицы

Создайте следующие листы в вашей Google Sheets таблице:

1. **InvoiceSummary** - Сводная информация о счетах
   - Колонки: Дата | Поставщик | Сумма | Количество товаров | Статус

2. **InvoiceDetails** - Детальная информация о товарах
   - Колонки: Дата | Поставщик | Товар | Количество | Цена | Сумма

3. **Products** - Каталог товаров
   - Колонки: Название | Артикул | Цена | Количество | Поставщик | Категория

4. **Reports** - Различные отчеты
   - Динамически создаваемые отчеты

## Безопасность

- Никогда не коммитьте файлы с ключами API в репозиторий
- Храните переменные окружения в безопасном месте
- Регулярно ротируйте ключи Service Account
- Ограничьте права доступа Service Account только необходимыми разрешениями

## Тестирование

### Тест с простым API ключом:

```bash
npm run test:google-sheets-simple
```

### Тест с OAuth2:

```bash
npm run test:google-sheets-oauth
```

Для полной OAuth2 авторизации в веб-приложении:
- Перейдите на `/auth/google` для начала авторизации
- После успешной авторизации вы попадете на `/auth/google/callback`

### Тест с Service Account:

```bash
npm run test:google-sheets
```

## Ограничения API

### Простой API ключ:
- ✅ Чтение публично доступных таблиц
- ❌ Запись данных (требует Service Account или OAuth2)
- ❌ Создание новых листов
- ❌ Доступ к приватным таблицам

### Service Account:
- ✅ Полный доступ к расшаренным таблицам
- ✅ Чтение и запись данных
- ✅ Создание новых листов
- ✅ Пакетные операции

### Общие ограничения:
- Google Sheets API имеет лимиты на количество запросов
- Максимальный размер одного запроса: 4MB
- Рекомендуется использовать пакетные операции для больших объемов данных
- При превышении лимитов используйте exponential backoff для повторных попыток
