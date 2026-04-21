/**
 * Copy logic for files and folders
 */

import type { FakeFs } from "./fsAll";

/**
 * Copy a file from source to destination
 */
export const copyFile = async (
  sourceFs: FakeFs,
  sourcePath: string,
  destFs: FakeFs,
  destPath: string
): Promise<void> => {
  try {
    const content = await sourceFs.readFile(sourcePath);
    const stat = await sourceFs.stat(sourcePath);
    const now = Date.now();
    await destFs.writeFile(destPath, content, stat.mtime || now, stat.mtime || now);
  } catch (error) {
    throw new Error(`Failed to copy file ${sourcePath} to ${destPath}: ${error}`);
  }
};

/**
 * Copy a folder from source to destination
 */
export const copyFolder = async (
  sourceFs: FakeFs,
  sourcePath: string,
  destFs: FakeFs,
  destPath: string
): Promise<void> => {
  try {
    const entities = await sourceFs.walkPartial();
    const items = entities.filter(item => 
      item.key?.startsWith(sourcePath) && 
      item.key !== sourcePath
    );
    
    for (const item of items) {
      const relativePath = item.key?.substring(sourcePath.length) || '';
      const destItemPath = `${destPath}${relativePath}`;
      
      if (item.type === 'folder') {
        await destFs.mkdir(destItemPath, item.mtime, item.mtime);
      } else {
        await copyFile(sourceFs, item.key!, destFs, destItemPath);
      }
    }
  } catch (error) {
    throw new Error(`Failed to copy folder ${sourcePath} to ${destPath}: ${error}`);
  }
};

/**
 * Copy a file or folder from source to destination
 */
export const copyFileOrFolder = async (
  sourceFs: FakeFs,
  sourcePath: string,
  destFs: FakeFs,
  destPath: string
): Promise<void> => {
  try {
    const stat = await sourceFs.stat(sourcePath);
    if (stat.type === 'folder') {
      await copyFolder(sourceFs, sourcePath, destFs, destPath);
    } else {
      await copyFile(sourceFs, sourcePath, destFs, destPath);
    }
  } catch (error) {
    throw new Error(`Failed to copy ${sourcePath} to ${destPath}: ${error}`);
  }
};
