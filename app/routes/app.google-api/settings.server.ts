import type { GoogleAPISettings } from "./types";

// Load settings from JSON file
export async function loadSettings(): Promise<GoogleAPISettings> {
  try {
    const fs = await import("fs");
    const { PATHS } = await import("../../utils/storage.server");
    const settingsPath = PATHS.GOOGLE_SETTINGS;

    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, "utf8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.log("Settings file not found, using defaults");
  }
  return {};
}

// Save settings to JSON file
export async function saveSettings(
  settings: GoogleAPISettings
): Promise<void> {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const { PATHS } = await import("../../utils/storage.server");
    const settingsPath = PATHS.GOOGLE_SETTINGS;

    // Ensure directory exists before writing
    const settingsDir = path.dirname(settingsPath);
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    const updatedSettings = {
      ...settings,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(
      settingsPath,
      JSON.stringify(updatedSettings, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Error saving settings:", error);
    throw new Error("Failed to save settings");
  }
}

