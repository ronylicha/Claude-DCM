/**
 * Export utilities for CSV and JSON downloads
 */

export interface ExportOptions {
  filename: string;
  headers?: string[];
}

/**
 * Export data as CSV file
 */
export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  headers?: string[]
): void {
  if (data.length === 0) {
    console.warn("No data to export");
    return;
  }

  const keys = headers ?? (Object.keys(data[0]) as string[]);

  // Create CSV header
  const csvHeader = keys.join(",");

  // Create CSV rows
  const csvRows = data.map((row) => {
    return keys
      .map((key) => {
        const value = row[key];
        // Handle values that contain commas or quotes
        if (typeof value === "string") {
          if (value.includes(",") || value.includes('"') || value.includes("\n")) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }
        if (value === null || value === undefined) {
          return "";
        }
        if (typeof value === "object") {
          return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        }
        return String(value);
      })
      .join(",");
  });

  const csvContent = [csvHeader, ...csvRows].join("\n");
  downloadFile(csvContent, `${filename}.csv`, "text/csv;charset=utf-8;");
}

/**
 * Export data as JSON file
 */
export function exportToJSON<T>(data: T, filename: string): void {
  const jsonContent = JSON.stringify(data, null, 2);
  downloadFile(jsonContent, `${filename}.json`, "application/json;charset=utf-8;");
}

/**
 * Helper function to trigger file download
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Format date for export filenames
 */
export function getExportFilename(prefix: string): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.toISOString().slice(11, 16).replace(":", "");
  return `${prefix}_${dateStr}_${timeStr}`;
}
