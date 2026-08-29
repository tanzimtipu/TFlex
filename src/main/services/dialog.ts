import { dialog } from 'electron';
import { normalize } from 'node:path';

export async function openPdfDialog(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return normalize(result.filePaths[0]);
}
