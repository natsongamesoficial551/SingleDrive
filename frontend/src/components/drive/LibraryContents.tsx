import { ChevronRight, Folder, MoreVertical } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { FileItem, FolderItem } from '@/data/drive-data'
import { FileGrid } from './FileGrid'
import { FileTable } from './FileTable'
import { FolderGrid, type FolderSizeScale } from './FolderGrid'

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' })

export function LibraryContents({ folders, files, mode, sizeScale, selectedFileIds, allSelected, onFolderOpen, onFolderMenu, onDropItem, onFileOpen, onFileMenu, onToggleFile, onToggleAll }: {
  folders: FolderItem[]; files: FileItem[]; mode: 'list' | 'grid'; sizeScale: FolderSizeScale
  selectedFileIds: Set<string>; allSelected: boolean
  onFolderOpen: (folder: FolderItem) => void
  onFolderMenu: (event: MouseEvent<HTMLElement>, folder: FolderItem) => void
  onDropItem: (fileId: string, folderId: string) => void
  onFileOpen: (file: FileItem) => void
  onFileMenu: (event: MouseEvent<HTMLElement>, file: FileItem) => void
  onToggleFile: (file: FileItem) => void; onToggleAll: () => void
}) {
  const orderedFolders = [...folders].sort(byName)
  const orderedFiles = [...files].sort(byName)
  return <>
    {mode === 'grid' ? <>
      {orderedFolders.length > 0 && <FolderGrid items={orderedFolders} mobileTwoColumns sizeScale={sizeScale} onFolderOpen={onFolderOpen} onFolderMenu={onFolderMenu} onDropItem={onDropItem} />}
      {orderedFiles.length > 0 && <FileGrid files={orderedFiles} selectedFileIds={selectedFileIds} sizeScale={sizeScale} onOpenFile={onFileOpen} onFileContextMenu={onFileMenu} onToggleFile={onToggleFile} />}
    </> : <>
      {orderedFolders.length > 0 && <ul className="mt-4 divide-y divide-slate-200/30" aria-label="Pastas da biblioteca">
        {orderedFolders.map(folder => <li key={folder.id} className="flex items-center gap-3 rounded-xl hover:bg-blue-50/50"
          onContextMenu={event => onFolderMenu(event, folder)}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
          onDrop={event => { event.preventDefault(); const fileId = event.dataTransfer.getData('text/plain'); if (fileId && folder.id) onDropItem(fileId, folder.id) }}>
          <button className="flex min-w-0 flex-1 items-center gap-3 px-3 py-4 text-left" onClick={() => onFolderOpen(folder)} aria-label={`Abrir pasta ${folder.name}`}>
            <Folder className="h-8 w-8 shrink-0 fill-blue-100 text-blue-600" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{folder.name}</span><span className="block text-xs text-slate-500">Pasta</span></span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
          <button className="mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={event => { event.stopPropagation(); onFolderMenu(event, folder) }} aria-label={`Menu da pasta ${folder.name}`}><MoreVertical className="h-4 w-4" /></button>
        </li>)}
      </ul>}
      {orderedFiles.length > 0 && <FileTable files={orderedFiles} selectedFileIds={selectedFileIds} allSelected={allSelected} onOpenFile={onFileOpen} onFileContextMenu={onFileMenu} onToggleFile={onToggleFile} onToggleAll={onToggleAll} />}
    </>}
  </>
}
