// Простой мок для Google Sheets сервиса
export function createMockSheetsService() {
  return {
    // Мок для чтения данных
    readData: async (spreadsheetId: string, range: string) => {
      console.log("🔍 Мок: читаем данные из", spreadsheetId);
      // G - (new CMP)
      // H - (quantite ancien)
      // I - (nouveau quantit)
      // J - (unit price)
      // K - (new unit price)
      // L - (total shipping fee)
      return {
        values: [
          [
            "FWN-LEMON",
            "brand",
            "name",
            "ICE-LEMON",
            "Supplier",
            1.1,
            230,
            100,
            3.2,
            4.5,
            230,
          ],
          [
            "FWN-PEACH",
            "brand",
            "name",
            "ICE-PEACH",
            "Supplier",
            2.9,
            190,
            50,
            3.2,
            230,
            3.3,
          ],
        ],
      };
    },

    updateData: async (
      spreadsheetId: string,
      range: string,
      values: any[][]
    ) => {
      console.log("✏️ Мок: обновляем данные", { spreadsheetId, range, values });
      return { updatedCells: values.length };
    },
  };
}
