# Быстрый старт с OAuth2 для Google Sheets

## 🚀 Ваша конфигурация

У вас есть OAuth2 Client JSON:
```json
{
  "web": {
    "client_id": "456652326774-dulvmto2trdsb12cdpojddp8mn8ogqj7.apps.googleusercontent.com",
    "client_secret": "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",
    "project_id": "shopify-fwn-app",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs"
  }
}
```

## ⚡ Быстрая настройка

### 1. Настройте переменные окружения

Добавьте в `.env`:

```env
GOOGLE_OAUTH_CONFIG='{"web":{"client_id":"456652326774-dulvmto2trdsb12cdpojddp8mn8ogqj7.apps.googleusercontent.com","client_secret":"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","project_id":"shopify-fwn-app","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs"}}'
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/auth/google/callback
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here
```

### 2. Настройте Google Cloud Console

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Выберите проект `shopify-fwn-app`
3. Перейдите в "APIs & Services" > "Credentials"
4. Найдите OAuth 2.0 Client с ID `456652326774-dulvmto2trdsb12cdpojddp8mn8ogqj7.apps.googleusercontent.com`
5. Добавьте в "Authorized redirect URIs":
   ```
   http://localhost:3000/auth/google/callback
   ```

### 3. Убедитесь что Google Sheets API включен

В Google Cloud Console:
- "APIs & Services" > "Library"
- Найдите "Google Sheets API"
- Нажмите "Enable" если не включен

## 🧪 Тестирование

### Консольный тест:
```bash
npm run test:google-sheets-oauth
```

### Веб-авторизация:
1. Запустите приложение: `npm run dev`
2. Перейдите на: `http://localhost:3000/auth/google`
3. Авторизуйтесь через Google
4. Попадете на: `http://localhost:3000/auth/google/callback`

## 💻 Использование в коде

### Инициализация:
```typescript
import { getGoogleSheetsOAuth2Service, OAuth2Helper } from '~/services/googleSheetsOAuth.server';

const config = OAuth2Helper.createConfigFromJSON(process.env.GOOGLE_OAUTH_CONFIG);
const sheetsService = getGoogleSheetsOAuth2Service(config);
```

### Авторизация:
```typescript
// 1. Перенаправить пользователя на авторизацию
const authUrl = sheetsService.generateAuthUrl();
return redirect(authUrl);

// 2. Обработать callback
const tokens = await sheetsService.getTokensFromCode(code);
sheetsService.setCredentials(tokens);

// 3. Сохранить токены для пользователя
await OAuth2Helper.saveTokens(userId, tokens);
```

### Работа с данными:
```typescript
// Чтение
const data = await sheetsService.readData({
  spreadsheetId: 'your_id',
  range: 'Sheet1!A1:E10'
});

// Запись
await sheetsService.writeData('your_id', {
  range: 'Sheet1!A1:B2',
  values: [['Header 1', 'Header 2'], ['Value 1', 'Value 2']]
});

// Добавление
await sheetsService.appendData('your_id', 'Sheet1!A:B', [
  ['New Row', 'New Value']
]);
```

## 🔄 Автоматическое обновление токенов

Сервис автоматически обновляет токены при необходимости:

```typescript
// Сервис автоматически проверит и обновит токен если нужно
const data = await sheetsService.readData(params);
```

## 📋 Что дальше?

1. ✅ Настройте redirect URI в Google Cloud Console
2. ✅ Запустите тест: `npm run test:google-sheets-oauth`
3. ✅ Создайте тестовую таблицу в Google Sheets
4. ✅ Попробуйте веб-авторизацию: `/auth/google`
5. ✅ Интегрируйте в ваше приложение

## 🆘 Поддержка

Если возникают проблемы:
- Проверьте настройки в Google Cloud Console
- Убедитесь что redirect URI правильный
- Проверьте что Google Sheets API включен
- Посмотрите полную документацию в `GOOGLE_SHEETS_SETUP.md`

## 🎯 Преимущества OAuth2

- ✅ Полный доступ к таблицам пользователя
- ✅ Безопасная авторизация через Google
- ✅ Автоматическое обновление токенов
- ✅ Работа с любыми таблицами пользователя
- ✅ Чтение и запись данных
- ✅ Создание новых листов

