declare const spindle: any

type NoteScope = 'standalone' | 'chat'

type Note = {
  id: string
  title: string
  body: string
  folderId: string | null
  categoryId: string | null
  tags: string[]
  scope: NoteScope
  chatId?: string
  chatName?: string
  pinned: boolean
  archived: boolean
  createdAt: number
  updatedAt: number
}

type NoteSummary = Omit<Note, 'body' | 'createdAt'> & {
  updatedAt: number
}

type Folder = {
  id: string
  name: string
  parentId: string | null
  sort: number
}

type Category = {
  id: string
  name: string
  scope: 'global' | 'chat'
  sort: number
}

type NotesIndex = {
  version: 1
  folders: Folder[]
  categories: Category[]
  notes: NoteSummary[]
}

type FrontendMessage =
  | {
      type: 'notes:list'
      scope?: 'all' | 'standalone' | 'chat' | 'pinned'
      query?: string
      chatId?: string | null
      folderFilter?: 'all' | 'none' | 'folder'
      folderId?: string | null
    }
  | { type: 'notes:get'; id: string }
  | { type: 'notes:save'; note: Partial<Note> }
  | { type: 'notes:delete'; id: string }
  | { type: 'folders:create'; name: string; parentId?: string | null }
  | { type: 'folders:update'; folder: Partial<Folder> & { id: string } }
  | { type: 'folders:delete'; id: string }
  | { type: 'context:getActiveChat'; clientChat?: { chatId: string | null; chatName?: string } }

const OPEN_LILYPAD_COMMAND = 'lilypad-open-notes'
const OPEN_NOTES_MODAL_MESSAGE = 'ui:openNotesModal'
const INDEX_PATH = 'index.json'
const NOTE_PREFIX = 'notes/'

function emptyIndex(): NotesIndex {
  return {
    version: 1,
    folders: [],
    categories: [],
    notes: [],
  }
}

function stringifyContext(context: any) {
  try {
    return JSON.stringify(context ?? {})
  } catch {
    return '[unserializable context]'
  }
}

function createNoteId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `note_${uuid.replaceAll('-', '')}`
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function createFolderId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `folder_${uuid.replaceAll('-', '')}`
  return `folder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function normalizeText(value: unknown, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function normalizeNullableText(value: unknown) {
  const text = normalizeText(value)
  return text || null
}

function normalizeIndex(raw: any): NotesIndex {
  const index = emptyIndex()
  if (!raw || typeof raw !== 'object') return index

  index.folders = Array.isArray(raw.folders)
    ? sortFolders(
        raw.folders
          .filter((folder: any) => folder?.id && folder?.name)
          .map((folder: any, sort: number) => ({
            id: normalizeText(folder.id),
            name: normalizeText(folder.name, 'Untitled folder'),
            parentId: normalizeNullableText(folder.parentId),
            sort: Number(folder.sort ?? sort),
          })),
      )
    : []
  index.categories = Array.isArray(raw.categories) ? raw.categories : []
  index.notes = Array.isArray(raw.notes) ? raw.notes : []

  return index
}

function notePath(id: string) {
  return `${NOTE_PREFIX}${id}.json`
}

async function getActiveChat(userId?: string) {
  const attempts = userId
    ? [
        () => spindle.chats?.getActive?.({ userId }),
        () => spindle.chats?.getActive?.(userId),
      ]
    : [() => spindle.chats?.getActive?.()]
  let lastError: any = null

  try {
    for (const attempt of attempts) {
      try {
        const active = await attempt()
        if (!active?.id) return null

        return {
          chatId: active.id,
          chatName: active.name ?? active.title ?? 'Current chat',
        }
      } catch (error: any) {
        lastError = error
      }
    }

    throw lastError
  } catch (error: any) {
    spindle.log?.warn?.(
      `[Lilypad] active chat lookup failed${userId ? '' : ' without userId'}: ${error?.message ?? error}`,
    )
    return null
  }
}

function summarizeNote(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    folderId: note.folderId,
    categoryId: note.categoryId,
    tags: note.tags,
    scope: note.scope,
    chatId: note.chatId,
    chatName: note.chatName,
    pinned: note.pinned,
    archived: note.archived,
    updatedAt: note.updatedAt,
  }
}

function sortSummaries(notes: NoteSummary[]) {
  return notes.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

function sortFolders(folders: Folder[]) {
  return folders.sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort
    return a.name.localeCompare(b.name)
  })
}

async function loadIndex(userId?: string): Promise<NotesIndex> {
  const raw = await spindle.userStorage.getJson(INDEX_PATH, {
    fallback: emptyIndex(),
    userId,
  })
  return normalizeIndex(raw)
}

async function saveIndex(index: NotesIndex, userId?: string) {
  await spindle.userStorage.setJson(INDEX_PATH, index, { indent: 2, userId })
}

async function readNote(id: string, userId?: string): Promise<Note | null> {
  if (!id) return null
  try {
    return await spindle.userStorage.getJson(notePath(id), { fallback: null, userId })
  } catch {
    return null
  }
}

function normalizeNote(input: Partial<Note>, existing?: Note | null): Note {
  const now = Date.now()
  const id = normalizeText(input.id) || createNoteId()
  const title = normalizeText(input.title, 'Untitled note')
  const scope: NoteScope = input.scope === 'chat' ? 'chat' : 'standalone'

  return {
    id,
    title,
    body: typeof input.body === 'string' ? input.body : existing?.body ?? '',
    folderId: normalizeNullableText(input.folderId),
    categoryId: normalizeNullableText(input.categoryId),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => normalizeText(tag)).filter(Boolean).slice(0, 20)
      : existing?.tags ?? [],
    scope,
    chatId: scope === 'chat' ? normalizeText(input.chatId) || existing?.chatId : undefined,
    chatName: scope === 'chat' ? normalizeText(input.chatName) || existing?.chatName : undefined,
    pinned: Boolean(input.pinned ?? existing?.pinned),
    archived: Boolean(input.archived ?? existing?.archived),
    createdAt: Number(input.createdAt || existing?.createdAt || now),
    updatedAt: now,
  }
}

async function saveNote(input: Partial<Note>, userId?: string): Promise<{ index: NotesIndex; note: Note }> {
  const existing = input.id ? await readNote(input.id, userId) : null
  const noteInput = { ...input }
  const wantsChatScope = noteInput.scope === 'chat' || existing?.scope === 'chat'

  if (wantsChatScope && !noteInput.chatId && !existing?.chatId) {
    const active = await getActiveChat(userId)
    if (!active?.chatId) {
      throw new Error('No active chat found for this chat note.')
    }
    noteInput.chatId = active.chatId
    noteInput.chatName = active.chatName
  }

  const note = normalizeNote(noteInput, existing)
  const index = await loadIndex(userId)
  if (note.folderId && !index.folders.some((folder) => folder.id === note.folderId)) {
    note.folderId = null
  }

  await spindle.userStorage.setJson(notePath(note.id), note, { indent: 2, userId })

  index.notes = sortSummaries([
    ...index.notes.filter((summary) => summary.id !== note.id),
    summarizeNote(note),
  ])
  await saveIndex(index, userId)

  return { index, note }
}

async function deleteNote(id: string, userId?: string): Promise<NotesIndex> {
  const index = await loadIndex(userId)
  index.notes = index.notes.filter((summary) => summary.id !== id)

  try {
    await spindle.userStorage.delete(notePath(id), userId)
  } catch {
    // Missing note bodies should not prevent index repair.
  }

  await saveIndex(index, userId)
  return index
}

async function createFolder(name: string, parentId: string | null | undefined, userId?: string): Promise<NotesIndex> {
  const folderName = normalizeText(name, 'Untitled folder')
  const index = await loadIndex(userId)
  const nextSort = index.folders.reduce((max, folder) => Math.max(max, folder.sort), 0) + 1

  index.folders = sortFolders([
    ...index.folders,
    {
      id: createFolderId(),
      name: folderName,
      parentId: normalizeNullableText(parentId),
      sort: nextSort,
    },
  ])

  await saveIndex(index, userId)
  return index
}

async function updateFolder(input: Partial<Folder> & { id: string }, userId?: string): Promise<NotesIndex> {
  const folderId = normalizeText(input.id)
  const index = await loadIndex(userId)
  const existing = index.folders.find((folder) => folder.id === folderId)
  if (!existing) throw new Error('Folder not found.')

  index.folders = sortFolders(
    index.folders.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            name: normalizeText(input.name, folder.name),
            parentId: input.parentId === undefined ? folder.parentId : normalizeNullableText(input.parentId),
            sort: Number(input.sort ?? folder.sort),
          }
        : folder,
    ),
  )

  await saveIndex(index, userId)
  return index
}

async function deleteFolder(id: string, userId?: string): Promise<NotesIndex> {
  const folderId = normalizeText(id)
  const index = await loadIndex(userId)
  const affectedNoteIds = index.notes.filter((summary) => summary.folderId === folderId).map((summary) => summary.id)
  const now = Date.now()

  index.folders = sortFolders(
    index.folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => ({
        ...folder,
        parentId: folder.parentId === folderId ? null : folder.parentId,
      })),
  )
  index.notes = index.notes.map((summary) =>
    summary.folderId === folderId
      ? {
          ...summary,
          folderId: null,
          updatedAt: now,
        }
      : summary,
  )

  await saveIndex(index, userId)

  for (const noteId of affectedNoteIds) {
    const note = await readNote(noteId, userId)
    if (!note) continue
    await spindle.userStorage.setJson(
      notePath(noteId),
      {
        ...note,
        folderId: null,
        updatedAt: now,
      },
      { indent: 2, userId },
    )
  }

  return index
}

async function listNotes(
  userId: string | undefined,
  scope: 'all' | 'standalone' | 'chat' | 'pinned' = 'all',
  query = '',
  chatId?: string | null,
  folderFilter: 'all' | 'none' | 'folder' = 'all',
  folderId?: string | null,
) {
  const index = await loadIndex(userId)
  const normalizedQuery = query.trim().toLowerCase()

  let notes = index.notes.filter((note) => !note.archived)
  if (scope === 'standalone') notes = notes.filter((note) => note.scope === 'standalone')
  if (scope === 'chat') {
    notes = notes.filter((note) => note.scope === 'chat')
    notes = chatId ? notes.filter((note) => note.chatId === chatId) : []
  }
  if (scope === 'pinned') notes = notes.filter((note) => note.pinned)
  if (folderFilter === 'none') notes = notes.filter((note) => !note.folderId)
  if (folderFilter === 'folder') notes = notes.filter((note) => note.folderId === folderId)

  if (normalizedQuery) {
    const matches: NoteSummary[] = []
    for (const summary of notes) {
      const summaryHaystack = [
        summary.title,
        summary.tags.join(' '),
        summary.chatName,
      ].join(' ').toLowerCase()

      if (summaryHaystack.includes(normalizedQuery)) {
        matches.push(summary)
        continue
      }

      const note = await readNote(summary.id, userId)
      if (note?.body?.toLowerCase().includes(normalizedQuery)) {
        matches.push(summary)
      }
    }
    notes = matches
  }

  return {
    ...index,
    notes: sortSummaries([...notes]),
  }
}

function sendToUser(payload: any, userId?: string) {
  if (userId) {
    spindle.sendToFrontend(payload, userId)
  } else {
    spindle.sendToFrontend(payload)
  }
}

function sendError(message: string, userId?: string) {
  sendToUser({ type: 'error', message }, userId)
}

function sendActiveChat(activeChat: { chatId: string; chatName?: string } | null, userId?: string) {
  sendToUser(
    {
      type: 'context:activeChat',
      chatId: activeChat?.chatId ?? null,
      chatName: activeChat?.chatName,
    },
    userId,
  )
}

function normalizeClientChat(clientChat?: { chatId: string | null; chatName?: string }) {
  const chatId = normalizeText(clientChat?.chatId)
  if (!chatId) return null

  return {
    chatId,
    chatName: normalizeText(clientChat?.chatName, 'Current chat'),
  }
}

function resolveUserId(context: any) {
  return (
    context?.userId ??
    context?.user?.id ??
    context?.frontendUserId ??
    context?.viewerId ??
    undefined
  )
}

function registerCommands() {
  try {
    spindle.commands.register([
      {
        id: OPEN_LILYPAD_COMMAND,
        label: 'Open Lilypad Notes',
        description: 'Open the Lilypad notes library',
        keywords: ['lilypad', 'notes', 'markdown', 'library', 'folders'],
        scope: 'global',
      },
    ])

    spindle.log?.info?.('[Lilypad] command registered')
  } catch (error: any) {
    spindle.log?.error?.(`[Lilypad] command registration failed: ${error?.message ?? error}`)
  }
}

spindle.log?.info?.('[Lilypad] backend loaded')

registerCommands()

spindle.commands.onInvoked((commandId: string, context: any) => {
  spindle.log?.info?.(`[Lilypad] command invoked: ${commandId}`)
  spindle.log?.debug?.(`[Lilypad] command context: ${stringifyContext(context)}`)

  if (commandId !== OPEN_LILYPAD_COMMAND) return

  const userId = resolveUserId(context)

  try {
    sendToUser(
      {
        type: OPEN_NOTES_MODAL_MESSAGE,
        source: 'commandPalette',
        activeChat: context?.chatId
          ? {
              chatId: context.chatId,
              chatName: context?.chatName ?? context?.chat?.name ?? 'Current chat',
            }
          : undefined,
      },
      userId,
    )
  } catch (error: any) {
    spindle.log?.error?.(`[Lilypad] failed to open notes modal: ${error?.message ?? error}`)
  }
})

spindle.on?.('CHAT_SWITCHED', async (payload: any) => {
  registerCommands()

  const userId = resolveUserId(payload)
  const activeChat = payload?.chatId
    ? {
        chatId: payload.chatId,
        chatName: payload?.chatName ?? payload?.chat?.name ?? 'Current chat',
      }
    : await getActiveChat(userId)

  sendActiveChat(activeChat, userId)
})

spindle.onFrontendMessage(async (payload: FrontendMessage, userId?: string) => {
  try {
    switch (payload.type) {
      case 'notes:list': {
        const index = await listNotes(
          userId,
          payload.scope,
          payload.query,
          payload.chatId,
          payload.folderFilter,
          payload.folderId,
        )
        sendToUser({ type: 'notes:index', index }, userId)
        break
      }

      case 'folders:create': {
        const index = await createFolder(payload.name, payload.parentId, userId)
        sendToUser({ type: 'folders:saved', index }, userId)
        sendToUser({ type: 'notes:index', index }, userId)
        break
      }

      case 'folders:update': {
        const index = await updateFolder(payload.folder, userId)
        sendToUser({ type: 'folders:saved', index }, userId)
        sendToUser({ type: 'notes:index', index }, userId)
        break
      }

      case 'folders:delete': {
        const index = await deleteFolder(payload.id, userId)
        sendToUser({ type: 'folders:deleted', id: payload.id, index }, userId)
        sendToUser({ type: 'notes:index', index }, userId)
        break
      }

      case 'context:getActiveChat': {
        const activeChat = await getActiveChat(userId)
        sendActiveChat(activeChat ?? normalizeClientChat(payload.clientChat), userId)
        break
      }

      case 'notes:get': {
        const note = await readNote(payload.id, userId)
        if (!note) {
          sendError('Note not found.', userId)
          break
        }
        sendToUser({ type: 'notes:note', note }, userId)
        break
      }

      case 'notes:save': {
        const { index, note } = await saveNote(payload.note, userId)
        sendToUser({ type: 'notes:saved', note }, userId)
        sendToUser({ type: 'notes:index', index }, userId)
        break
      }

      case 'notes:delete': {
        const index = await deleteNote(payload.id, userId)
        sendToUser({ type: 'notes:deleted', id: payload.id }, userId)
        sendToUser({ type: 'notes:index', index }, userId)
        break
      }
    }
  } catch (error: any) {
    spindle.log?.error?.(`[Lilypad] notes message failed: ${error?.message ?? error}`)
    sendError(error?.message ?? 'Lilypad storage failed.', userId)
  }
})
