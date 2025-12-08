// Test Google Sheets service
// Run: npx tsx test-google-sheets.ts

// Load .env file (same as notify.ts)
async function loadDotEnvIfPresent() {
  try {
    const { readFileSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const envPath = join(process.cwd(), ".env");
    
    console.log(`🔍 Looking for .env file: ${envPath}`);
    
    if (existsSync(envPath)) {
      console.log('✅ .env file found');
      const content = readFileSync(envPath, "utf8");
      console.log(`📄 File size: ${content.length} characters`);
      
      let loadedVars = 0;
      for (const line of content.split(/\r?\n/)) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) continue;
        
        const m = trimmedLine.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)$/i);
        if (!m) {
          console.log(`⚠️ Could not parse line: "${trimmedLine}"`);
          continue;
        }
        
        const key = m[1];
        let val = m[2];
        
        // Remove quotes if present
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        
        // Always load from .env, overriding system env
        process.env[key] = val;
        loadedVars++;
        console.log(`📝 Loaded: ${key} = ${key.includes('CONFIG') ? val.substring(0, 30) + '...' : val}`);
      }
      
      console.log(`✅ Loaded ${loadedVars} variables from .env file\n`);
    } else {
      console.log('❌ .env file not found');
    }
  } catch (error: any) {
    console.error('❌ Error loading .env file:', error.message);
  }
}

import { getGoogleSheetsService } from './app/services/googleSheets.server';

async function testGoogleSheetsService() {
  console.log('🚀 Testing Google Sheets service...\n');

  // Загружаем переменные окружения
  await loadDotEnvIfPresent();

  // Проверяем переменные окружения
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const oauthConfig = process.env.GOOGLE_OAUTH_CONFIG;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  console.log('🔍 Checking environment variables:');
  console.log(`   API Key: ${apiKey ? '✅ Set' : '❌ Not set'}`);
  console.log(`   OAuth Config: ${oauthConfig ? '✅ Set' : '❌ Not set'}`);
  console.log(`   Spreadsheet ID: ${spreadsheetId ? '✅ Set' : '❌ Not set'}`);
  console.log();

  if (!apiKey && !oauthConfig) {
    console.error('❌ Missing both GOOGLE_SHEETS_API_KEY and GOOGLE_OAUTH_CONFIG');
    console.log('💡 Add to .env file either:');
    console.log('GOOGLE_SHEETS_API_KEY=your_api_key_here');
    console.log('OR');
    console.log('GOOGLE_OAUTH_CONFIG=\'{"web":{"client_id":"...","client_secret":"...","project_id":"..."}}\'');
    return;
  }

  if (!spreadsheetId) {
    console.error('❌ Missing GOOGLE_SHEETS_SPREADSHEET_ID environment variable');
    console.log('💡 Add to .env file:');
    console.log('GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here');
    return;
  }

  // Для этого простого теста используем API ключ
  if (!apiKey) {
    console.error('❌ This test requires GOOGLE_SHEETS_API_KEY');
    console.log('💡 For API key testing, add to .env file:');
    console.log('GOOGLE_SHEETS_API_KEY=your_api_key_here');
    return;
  }

  console.log(`🔑 Using API key: ${apiKey.substring(0, 10)}...`);
  console.log(`📊 Using spreadsheet: ${spreadsheetId}\n`);

  try {
    const service = getGoogleSheetsService(apiKey);

    // Test 1: Connection test
    console.log('1️⃣ Testing connection...');
    const connectionTest = await service.testConnection(spreadsheetId);
    
    console.log(`📖 Can read: ${connectionTest.canRead ? '✅ Yes' : '❌ No'}`);
    console.log(`📝 Message: ${connectionTest.message}`);
    
    if (connectionTest.info) {
      console.log(`📊 Spreadsheet: "${connectionTest.info.title}"`);
      console.log(`📄 Sheets: ${connectionTest.info.sheets}`);
    }
    
    if (!connectionTest.canRead) {
      console.log('\n❌ Cannot continue testing without read access');
      console.log('💡 Make sure:');
      console.log('  - Spreadsheet is publicly accessible');
      console.log('  - API key is valid');
      console.log('  - Google Sheets API is enabled');
      return;
    }
    console.log();

    // Test 2: Read data
    console.log('2️⃣ Reading data from Sheet1!A1:E10...');
    const data = await service.readData(spreadsheetId, 'Sheet1!A1:E10');
    
    if (data && data.values && data.values.length > 0) {
      console.log('✅ Data read successfully:');
      data.values.forEach((row, index) => {
        if (index < 5) { // Show only first 5 rows
          console.log(`   Row ${index + 1}: ${row.join(' | ')}`);
        }
      });
      if (data.values.length > 5) {
        console.log(`   ... and ${data.values.length - 5} more rows`);
      }
    } else {
      console.log('ℹ️ No data found in the specified range');
    }
    console.log();

    // Test 3: Read different range
    console.log('3️⃣ Reading first column (A:A)...');
    const columnData = await service.readData(spreadsheetId, 'A:A');
    
    if (columnData && columnData.values) {
      const nonEmptyRows = columnData.values.filter(row => row.length > 0 && row[0] !== '');
      console.log(`✅ Found ${nonEmptyRows.length} non-empty rows in column A`);
    }

    console.log('\n🎉 All tests completed successfully!');
    console.log('📖 See documentation for more examples');

  } catch (error: any) {
    console.error('\n❌ Error during testing:', error.message);
    console.log('\n🔍 Possible issues:');
    console.log('  - Invalid API key');
    console.log('  - Invalid spreadsheet ID');
    console.log('  - Spreadsheet not publicly accessible');
    console.log('  - Google Sheets API not enabled');
    console.log('  - Network connectivity issues');
  }
}

// Run tests
if (import.meta.url === `file://${process.argv[1]}`) {
  testGoogleSheetsService().catch(console.error);
}
