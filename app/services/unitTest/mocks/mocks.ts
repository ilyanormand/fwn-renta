export function createMockSheetsServiceWithBatch() {
  return {
    readData: async (spreadsheetId: string, range: string) => {
      return {
        values: [
          [
            "FWN-LEMON",
            "brand",
            "name",
            "ICE-LEMON",
            "Supplier",
            2.1, // oldCmp
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
            1.9, // oldCmp
            190,
            50,
            3.2,
            230,
            3.3,
          ],
          [
            "FWN-ORANGE",
            "brand",
            "name",
            "ICE-ORANGE",
            "Supplier",
            2.3, // oldCmp
            150,
            75,
            2.8,
            3.5,
            150,
          ],
          [
            "FWN-APPLE",
            "brand",
            "name",
            "ICE-APPLE",
            "Supplier",
            3.5, // oldCmp
            180,
            120,
            4.1,
            4.8,
            180,
          ],
          [
            "FWN-BERRY",
            "brand",
            "name",
            "ICE-BERRY",
            "Supplier",
            3.2, // oldCmp
            220,
            80,
            3.9,
            4.2,
            220,
          ],
          [
            "FWN-MANGO",
            "brand",
            "name",
            "ICE-MANGO",
            "Supplier",
            4.0, // oldCmp
            160,
            90,
            4.5,
            5.0,
            160,
          ],
          [
            "FWN-GRAPE",
            "brand",
            "name",
            "ICE-GRAPE",
            "Supplier",
            2.8, // oldCmp
            140,
            60,
            3.1,
            3.6,
            140,
          ],
          [
            "FWN-CHERRY",
            "brand",
            "name",
            "ICE-CHERRY",
            "Supplier",
            3.8, // oldCmp
            200,
            110,
            4.2,
            4.7,
            200,
          ],
          [
            "FWN-BANANA",
            "brand",
            "name",
            "ICE-BANANA",
            "Supplier",
            2.2, // oldCmp
            170,
            95,
            2.5,
            3.0,
            170,
          ],
          [
            "FWN-STRAWBERRY",
            "brand",
            "name",
            "ICE-STRAWBERRY",
            "Supplier",
            3.5, // oldCmp
            210,
            70,
            3.8,
            4.3,
            210,
          ],
        ],
      };
    },

    // Mock for updating data (old method - for backward compatibility)
    updateData: async (
      spreadsheetId: string,
      range: string,
      values: any[][]
    ) => {
      return {
        success: true,
        message: `Updated ${values.length} cells`,
        updatedCells: values.length,
      };
    },

    // Mock for batch update (new method - multiple updates at once)
    batchUpdate: async (
      spreadsheetId: string,
      updates: Array<{
        range: string;
        values: Array<Array<string | number | boolean>>;
      }>
    ) => {
      const totalCells = updates.reduce(
        (sum, update) =>
          sum + update.values.reduce((rowSum, row) => rowSum + row.length, 0),
        0
      );
      return {
        success: true,
        message: `Batch updated ${updates.length} ranges with ${totalCells} total cells`,
        updatedCells: totalCells,
      };
    },
  };
}
