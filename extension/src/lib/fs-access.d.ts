interface FileSystemHandle {
  queryPermission(descriptor?: {
    mode?: 'read' | 'readwrite'
  }): Promise<PermissionState>
  requestPermission(descriptor?: {
    mode?: 'read' | 'readwrite'
  }): Promise<PermissionState>
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<
    FileSystemDirectoryHandle | FileSystemFileHandle
  >
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }): Promise<FileSystemDirectoryHandle>
}
