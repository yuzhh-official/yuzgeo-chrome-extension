// File System Access API members not yet in TypeScript's DOM lib.
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
}

interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite';
    id?: string;
  }): Promise<FileSystemDirectoryHandle>;
}
