const emptyIndex = {
  version: 1,
  folders: [],
  categories: [],
  notes: [],
}

function createDraftNote() {
  const now = Date.now()
  return {
    id: '',
    title: 'Untitled note',
    body: '',
    folderId: null,
    categoryId: null,
    tags: [],
    scope: 'standalone',
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeMarkdownUrl(value, image = false) {
  const trimmed = value.trim().replace(/^<|>$/g, '')
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

    if (image && url.hostname === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean)
      const blobIndex = parts.indexOf('blob')
      if (parts.length > blobIndex + 2 && blobIndex === 2) {
        const [owner, repo] = parts
        const branch = parts[blobIndex + 1]
        const filePath = parts.slice(blobIndex + 2).join('/')
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
      }
    }

    return url.href
  } catch {
    return null
  }
}

function inlineMarkdown(value) {
  const tokens = []
  const stash = (html) => {
    const token = `\u0000${tokens.length}\u0000`
    tokens.push(html)
    return token
  }

  let text = value.replace(/`([^`]+)`/g, (_match, code) => stash(`<code>${escapeHtml(code)}</code>`))

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, rawUrl) => {
    const url = normalizeMarkdownUrl(rawUrl, true)
    if (!url) return match
    return stash(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`)
  })

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, label, rawUrl) => {
    const url = normalizeMarkdownUrl(rawUrl)
    if (!url) return match
    return stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${inlineMarkdown(label)}</a>`)
  })

  let html = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')

  tokens.forEach((token, index) => {
    html = html.replaceAll(`\u0000${index}\u0000`, token)
  })

  return html
}

function closeList(html, listType) {
  if (listType) html.push(`</${listType}>`)
  return null
}

function renderMarkdown(source) {
  const lines = (source || '').split('\n')
  const html = []
  let listType = null
  let paragraph = []
  let inCodeFence = false
  let codeInfo = ''
  let codeLanguage = ''
  let codeLines = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const flushCodeFence = () => {
    const languageClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ''
    const label = codeInfo ? `<figcaption>${escapeHtml(codeInfo)}</figcaption>` : ''
    html.push(`<figure class="lp-code-block">${label}<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre></figure>`)
    inCodeFence = false
    codeInfo = ''
    codeLanguage = ''
    codeLines = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (inCodeFence) {
      if (/^```\s*$/.test(trimmed)) {
        flushCodeFence()
      } else {
        codeLines.push(line)
      }
      continue
    }

    const fence = trimmed.match(/^```(.*)$/)
    if (fence) {
      flushParagraph()
      listType = closeList(html, listType)
      inCodeFence = true
      codeInfo = fence[1]?.trim() ?? ''
      const language = codeInfo.split(/\s+/)[0] ?? ''
      codeLanguage = /^[A-Za-z0-9_-]+$/.test(language) ? language : ''
      continue
    }

    if (!trimmed) {
      flushParagraph()
      listType = closeList(html, listType)
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      listType = closeList(html, listType)
      html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`)
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      listType = closeList(html, listType)
      html.push('<hr />')
      continue
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/)
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const nextType = unordered ? 'ul' : 'ol'
      if (listType !== nextType) {
        listType = closeList(html, listType)
        html.push(`<${nextType}>`)
        listType = nextType
      }
      const content = unordered?.[1] ?? ordered?.[1] ?? ''
      const task = content.match(/^\[( |x|X)\]\s+(.+)$/)
      if (task) {
        html.push(`<li><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''} /> ${inlineMarkdown(task[2])}</li>`)
      } else {
        html.push(`<li>${inlineMarkdown(content)}</li>`)
      }
      continue
    }

    if (trimmed.startsWith('> ')) {
      flushParagraph()
      listType = closeList(html, listType)
      html.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`)
      continue
    }

    paragraph.push(trimmed)
  }

  if (inCodeFence) flushCodeFence()
  flushParagraph()
  closeList(html, listType)
  return html.join('')
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function exportFilename(exportedAt) {
  const stamp = new Date(exportedAt).toISOString().replace(/[:.]/g, '-')
  return `lilypad-notes-${stamp}.json`
}

function downloadJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = exportFilename(payload.exportedAt)
  anchor.rel = 'noreferrer'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function readImportFile(file) {
  const text = await file.text()
  const payload = JSON.parse(text)
  if (payload?.kind !== 'lilypad-notes-export' || !Array.isArray(payload?.notes)) {
    throw new Error('That file is not a Lilypad notes export.')
  }
  return payload
}

function sortFolders(folders) {
  return [...folders].sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort
    return a.name.localeCompare(b.name)
  })
}

function normalizeChatContext(value) {
  if (!value || typeof value !== 'object') return null

  const chat =
    value.chat ??
    value.activeChat ??
    value.currentChat ??
    value.selectedChat ??
    value.session ??
    value

  const chatId =
    chat.chatId ??
    chat.id ??
    chat.activeChatId ??
    value.chatId ??
    value.activeChatId ??
    value.currentChatId ??
    null

  if (!chatId || typeof chatId !== 'string' || chatId === 'null' || chatId === 'undefined') return null

  const chatName =
    chat.chatName ??
    chat.name ??
    chat.title ??
    value.chatName ??
    value.name ??
    value.title ??
    undefined

  return {
    chatId,
    chatName: typeof chatName === 'string' && chatName.trim() ? chatName.trim() : 'Current chat',
  }
}

function readStoredChatContext(storage) {
  const interestingKey = /(active|current|selected).*chat|chat.*(active|current|selected)/i

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || !interestingKey.test(key)) continue

    const raw = storage.getItem(key)
    if (!raw || raw === 'null' || raw === 'undefined') continue

    if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) {
      return { chatId: raw, chatName: 'Current chat' }
    }

    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(parsed)) {
        return { chatId: parsed, chatName: 'Current chat' }
      }

      const fromJson = normalizeChatContext(parsed)
      if (fromJson) return fromJson
    } catch {
      // Not JSON; keep looking.
    }
  }

  return null
}

function readUrlChatContext() {
  const params = new URLSearchParams(window.location.search)
  const queryChatId = params.get('chatId') ?? params.get('chat_id') ?? params.get('chat')
  if (queryChatId) return { chatId: queryChatId, chatName: document.title || 'Current chat' }

  const routeMatch = window.location.pathname.match(/\/(?:chat|chats|c)\/([^/?#]+)/i)
  if (!routeMatch?.[1]) return null

  return {
    chatId: decodeURIComponent(routeMatch[1]),
    chatName: document.title || 'Current chat',
  }
}

function discoverActiveChat(ctx) {
  const contextCandidates = [
    ctx?.chat,
    ctx?.activeChat,
    ctx?.currentChat,
    ctx?.state?.chat,
    ctx?.state?.activeChat,
    ctx?.app?.chat,
    ctx?.app?.activeChat,
  ]

  for (const candidate of contextCandidates) {
    const chat = normalizeChatContext(candidate)
    if (chat) return chat
  }

  try {
    const local = readStoredChatContext(window.localStorage)
    if (local) return local
  } catch {
    // Storage can be blocked in some browser modes.
  }

  try {
    const session = readStoredChatContext(window.sessionStorage)
    if (session) return session
  } catch {
    // Storage can be blocked in some browser modes.
  }

  return readUrlChatContext()
}

export function setup(ctx) {
  let activeNotesModal = null
  let activeRoot = null
  let selectedNote = null
  let index = emptyIndex
  let scope = 'all'
  let folderFilter = 'all'
  let selectedFolderId = null
  let activeChat = { chatId: null }
  let noteListCollapsed = false
  let pendingEditorRequest = null
  let query = ''
  let dirty = false
  let listTimer

  function createRequestId(prefix = 'request') {
    const uuid = globalThis.crypto?.randomUUID?.()
    if (uuid) return `${prefix}_${uuid.replaceAll('-', '')}`
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  }

  function sendListRequest() {
    ctx.sendToBackend({
      type: 'notes:list',
      scope,
      query,
      chatId: activeChat.chatId,
      folderFilter,
      folderId: folderFilter === 'folder' ? selectedFolderId : null,
    })
  }

  function queueListRequest() {
    if (listTimer) window.clearTimeout(listTimer)
    listTimer = window.setTimeout(sendListRequest, 180)
  }

  function setStatus(message) {
    const status = activeRoot?.querySelector('[data-lilypad-status]')
    if (status) status.textContent = message
  }

  function setNoteListCollapsed(collapsed) {
    noteListCollapsed = collapsed
    const shell = activeRoot?.querySelector('.lp-shell')
    shell?.classList.toggle('is-list-collapsed', noteListCollapsed)
  }

  function openExpandedTextEditor(target, title, value, placeholder = '') {
    const requestId = createRequestId('editor')
    pendingEditorRequest = { requestId, target }
    setStatus('Opening expanded editor...')
    ctx.sendToBackend({
      type: 'editor:open',
      requestId,
      title,
      value,
      placeholder,
    })
  }

  function liveBlockText(block) {
    return (block.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n+$/g, '')
  }

  function createLiveBlock(type = 'p', text = '', options = {}) {
    const block = document.createElement(type === 'code' ? 'pre' : 'div')
    block.dataset.mdType = type
    block.className = 'lp-live-line'

    if (type === 'h') {
      const level = Math.min(6, Math.max(1, Number(options.level) || 1))
      block.dataset.mdLevel = String(level)
      block.classList.add('lp-live-heading', `is-h${level}`)
    } else if (type === 'ul' || type === 'ol') {
      block.classList.add('lp-live-list', `is-${type}`)
      if (type === 'ol') block.dataset.mdIndex = String(options.index ?? 1)
    } else if (type === 'quote') {
      block.classList.add('lp-live-quote')
    } else if (type === 'code') {
      block.classList.add('lp-live-code')
      block.dataset.mdInfo = options.info ?? ''
    }

    if (text) {
      block.textContent = text
    } else {
      block.innerHTML = '<br>'
    }

    return block
  }

  function replaceLiveBlock(block, type = 'p', text = '', options = {}) {
    const next = createLiveBlock(type, text, options)
    block.replaceWith(next)
    return next
  }

  function setCaretToEnd(element) {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  function getCurrentLiveBlock(root) {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    if (!anchor || !root.contains(anchor)) return null
    const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement
    return element?.closest('[data-md-type]') ?? null
  }

  function updateOrderedListIndexes(root) {
    let index = 1
    let inOrderedList = false
    root.querySelectorAll('[data-md-type]').forEach((block) => {
      if (block.dataset.mdType === 'ol') {
        if (!inOrderedList) index = 1
        block.dataset.mdIndex = String(index)
        index += 1
        inOrderedList = true
      } else {
        inOrderedList = false
      }
    })
  }

  function renderLiveEditorFromMarkdown(root, markdown) {
    root.innerHTML = ''
    const lines = (markdown || '').split('\n')
    let index = 0

    while (index < lines.length) {
      const line = lines[index]
      const trimmed = line.trim()
      const fence = trimmed.match(/^```(.*)$/)

      if (fence) {
        const info = fence[1]?.trim() ?? ''
        const codeLines = []
        index += 1
        while (index < lines.length && !lines[index].trim().match(/^```\s*$/)) {
          codeLines.push(lines[index])
          index += 1
        }
        root.append(createLiveBlock('code', codeLines.join('\n'), { info }))
      } else if (!trimmed) {
        root.append(createLiveBlock('p'))
      } else {
        const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
        const unordered = trimmed.match(/^[-*+]\s+(.+)$/)
        const ordered = trimmed.match(/^(\d+)[.)]\s+(.+)$/)
        const quote = trimmed.match(/^>\s+(.+)$/)

        if (heading) {
          root.append(createLiveBlock('h', heading[2], { level: heading[1].length }))
        } else if (unordered) {
          root.append(createLiveBlock('ul', unordered[1]))
        } else if (ordered) {
          root.append(createLiveBlock('ol', ordered[2], { index: ordered[1] }))
        } else if (quote) {
          root.append(createLiveBlock('quote', quote[1]))
        } else {
          root.append(createLiveBlock('p', line))
        }
      }

      index += 1
    }

    if (!root.querySelector('[data-md-type]')) root.append(createLiveBlock('p'))
    updateOrderedListIndexes(root)
  }

  function liveEditorToMarkdown(root) {
    const lines = []
    root.querySelectorAll('[data-md-type]').forEach((block) => {
      const type = block.dataset.mdType ?? 'p'
      const text = liveBlockText(block)

      if (type === 'h') {
        const level = Math.min(6, Math.max(1, Number(block.dataset.mdLevel) || 1))
        lines.push(`${'#'.repeat(level)} ${text}`)
      } else if (type === 'ul') {
        lines.push(text ? `- ${text}` : '- ')
      } else if (type === 'ol') {
        lines.push(`${block.dataset.mdIndex ?? '1'}. ${text}`)
      } else if (type === 'quote') {
        lines.push(text ? `> ${text}` : '> ')
      } else if (type === 'code') {
        const info = block.dataset.mdInfo ? block.dataset.mdInfo : ''
        lines.push(`\`\`\`${info}`, text, '```')
      } else {
        lines.push(text)
      }
    })

    return lines.join('\n').replace(/\n+$/g, '')
  }

  function syncLiveEditorToSource(root, source) {
    updateOrderedListIndexes(root)
    source.value = liveEditorToMarkdown(root)
  }

  function transformLiveShortcut(block) {
    if (block.dataset.mdType !== 'p') return block
    const text = liveBlockText(block)
    const heading = text.match(/^(#{1,6})\s+(.*)$/)
    const unordered = text.match(/^[-*+]\s+(.*)$/)
    const ordered = text.match(/^(\d+)[.)]\s+(.*)$/)
    const quote = text.match(/^>\s+(.*)$/)
    const code = text.match(/^```(.*)$/)

    if (heading) return replaceLiveBlock(block, 'h', heading[2], { level: heading[1].length })
    if (unordered) return replaceLiveBlock(block, 'ul', unordered[1])
    if (ordered) return replaceLiveBlock(block, 'ol', ordered[2], { index: ordered[1] })
    if (quote) return replaceLiveBlock(block, 'quote', quote[1])
    if (code) return replaceLiveBlock(block, 'code', '', { info: code[1]?.trim() ?? '' })
    return block
  }

  function renderChatContext() {
    const context = activeRoot?.querySelector('[data-lilypad-chat-context]')
    if (!context) return
    context.textContent = activeChat.chatId
      ? `This Chat: ${activeChat.chatName ?? activeChat.chatId}`
      : 'This Chat: no active chat'
  }

  function getFolderName(folderId) {
    if (!folderId) return 'No Folder'
    return index.folders.find((folder) => folder.id === folderId)?.name ?? 'Unknown folder'
  }

  function getSelectedFolder() {
    if (folderFilter !== 'folder' || !selectedFolderId) return null
    return index.folders.find((folder) => folder.id === selectedFolderId) ?? null
  }

  function selectFolder(nextFilter, folderId = null) {
    folderFilter = nextFilter
    selectedFolderId = nextFilter === 'folder' ? folderId : null
    renderFolders()
    setStatus('Loading notes...')
    sendListRequest()
  }

  function renderFolders() {
    const list = activeRoot?.querySelector('[data-lilypad-folder-list]')
    if (!list) return

    activeRoot?.querySelectorAll('[data-folder-filter]').forEach((button) => {
      const filter = button.dataset.folderFilter
      const folderId = button.dataset.folderId ?? null
      const active =
        filter === folderFilter &&
        (folderFilter !== 'folder' || folderId === selectedFolderId)
      button.classList.toggle('is-active', active)
    })

    list.innerHTML = sortFolders(index.folders)
      .map(
        (folder) => `
          <button class="lp-folder ${folderFilter === 'folder' && selectedFolderId === folder.id ? 'is-active' : ''}"
            data-folder-filter="folder"
            data-folder-id="${escapeHtml(folder.id)}">
            ${escapeHtml(folder.name)}
          </button>
        `,
      )
      .join('')

    list.querySelectorAll('[data-folder-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const folderId = button.dataset.folderId
        if (!folderId) return
        selectFolder('folder', folderId)
      })
    })

    const selected = getSelectedFolder()
    const rename = activeRoot?.querySelector('[data-lilypad-folder-rename]')
    const remove = activeRoot?.querySelector('[data-lilypad-folder-delete]')
    if (rename) rename.disabled = !selected
    if (remove) remove.disabled = !selected
  }

  function renderFolderOptions(selectedId) {
    return `
      <option value="">No Folder</option>
      ${sortFolders(index.folders)
        .map(
          (folder) =>
            `<option value="${escapeHtml(folder.id)}" ${selectedId === folder.id ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`,
        )
        .join('')}
    `
  }

  function refreshFolderSelect() {
    const select = activeRoot?.querySelector('[data-lilypad-folder]')
    if (!select) return

    const current = select.value
    select.innerHTML = renderFolderOptions(current)
    if (current && index.folders.some((folder) => folder.id === current)) {
      select.value = current
    } else {
      select.value = ''
    }
  }

  function setActiveChat(chat) {
    activeChat = chat?.chatId
      ? {
          chatId: chat.chatId,
          chatName: chat.chatName ?? 'Current chat',
        }
      : { chatId: null }

    renderChatContext()
    if (scope === 'chat') sendListRequest()
  }

  function requestActiveChat() {
    const clientChat = discoverActiveChat(ctx)
    if (clientChat?.chatId && !activeChat.chatId) {
      setActiveChat(clientChat)
    }

    ctx.sendToBackend({ type: 'context:getActiveChat', clientChat })
  }

  function renderList() {
    const list = activeRoot?.querySelector('[data-lilypad-note-list]')
    if (!list) return
    const noteCount = activeRoot?.querySelector('[data-lilypad-note-count]')
    if (noteCount) noteCount.textContent = String(index.notes.length)

    if (!index.notes.length) {
      list.innerHTML = `
        <div class="lp-empty">
          <strong>No notes yet.</strong>
          <span>Make the first one and Lilypad will keep it here.</span>
        </div>
      `
      return
    }

    list.innerHTML = index.notes
      .map((note) => {
        const selected = selectedNote?.id && selectedNote.id === note.id
        const scopeText = note.scope === 'chat' ? note.chatName || 'Chat note' : 'Standalone'
        const folderText = getFolderName(note.folderId)
        const tagText = note.tags.length
          ? `${escapeHtml(scopeText)} · ${escapeHtml(folderText)} · ${note.tags.map((tag) => `#${escapeHtml(tag)}`).join(' ')}`
          : `${escapeHtml(scopeText)} · ${escapeHtml(folderText)}`
        return `
          <button class="lp-note-card ${selected ? 'is-selected' : ''}" data-note-id="${escapeHtml(note.id)}">
            <span class="lp-note-title">${escapeHtml(note.title)}</span>
            <span class="lp-note-meta">${note.pinned ? 'Pinned · ' : ''}${formatDate(note.updatedAt)}</span>
            <span class="lp-note-tags">${tagText}</span>
          </button>
        `
      })
      .join('')

    list.querySelectorAll('[data-note-id]').forEach((button) => {
      button.addEventListener('click', () => {
        if (dirty && !window.confirm('Discard unsaved changes?')) return
        const id = button.dataset.noteId
        if (!id) return
        setNoteListCollapsed(true)
        setStatus('Loading note...')
        ctx.sendToBackend({ type: 'notes:get', id })
      })
    })
  }

  function collectEditorNote() {
    if (!activeRoot) return null

    const draft = selectedNote ?? createDraftNote()
    const title = activeRoot.querySelector('[data-lilypad-title]')?.value.trim() || 'Untitled note'
    const body = activeRoot.querySelector('[data-lilypad-body]')?.value ?? ''
    const folderValue = activeRoot.querySelector('[data-lilypad-folder]')?.value || ''
    const tagsValue = activeRoot.querySelector('[data-lilypad-tags]')?.value ?? ''
    const scopeValue =
      activeRoot.querySelector('[data-lilypad-scope]')?.value === 'chat' ? 'chat' : 'standalone'
    const pinned = Boolean(activeRoot.querySelector('[data-lilypad-pinned]')?.checked)

    if (scopeValue === 'chat' && !activeChat.chatId && !draft.chatId) {
      const discovered = discoverActiveChat(ctx)
      if (discovered?.chatId) {
        setActiveChat(discovered)
      }
    }

    if (scopeValue === 'chat' && !activeChat.chatId && !draft.chatId) {
      setStatus('Open a chat before saving a chat note')
      window.alert('Open a Lumiverse chat before saving this as a chat note.')
      return null
    }

    return {
      ...draft,
      title,
      body,
      folderId: folderValue || null,
      tags: tagsValue
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      scope: scopeValue,
      chatId: scopeValue === 'chat' ? activeChat.chatId ?? draft.chatId : undefined,
      chatName: scopeValue === 'chat' ? activeChat.chatName ?? draft.chatName : undefined,
      pinned,
      archived: false,
    }
  }

  function renderEditor() {
    const editor = activeRoot?.querySelector('[data-lilypad-editor]')
    if (!editor) return

    const note = selectedNote ?? createDraftNote()
    editor.innerHTML = `
      <div class="lp-editor-head">
        <input data-lilypad-title class="lp-title-input" value="${escapeHtml(note.title)}" placeholder="Note title" />
        <div class="lp-actions">
          <button data-lilypad-save class="lp-primary">Save</button>
          <button data-lilypad-delete>Delete</button>
        </div>
      </div>

      <div class="lp-meta-grid">
        <label>
          Scope
          <select data-lilypad-scope>
            <option value="standalone" ${note.scope === 'standalone' ? 'selected' : ''}>Standalone</option>
            <option value="chat" ${note.scope === 'chat' ? 'selected' : ''}>Chat</option>
          </select>
        </label>
        <label>
          Folder
          <select data-lilypad-folder>
            ${renderFolderOptions(note.folderId)}
          </select>
        </label>
        <label>
          Tags
          <input data-lilypad-tags value="${escapeHtml(note.tags.join(', '))}" placeholder="lore, css, continuity" />
        </label>
        <label class="lp-check">
          <input data-lilypad-pinned type="checkbox" ${note.pinned ? 'checked' : ''} />
          Pinned
        </label>
      </div>
      <div class="lp-note-context" data-lilypad-chat-hint>
        ${note.scope === 'chat' ? `Chat note: ${escapeHtml(note.chatName ?? activeChat.chatName ?? 'Current chat')}` : 'Global note'}
      </div>

      <div class="lp-markdown-head">
        <span>Markdown</span>
        <div class="lp-markdown-actions">
          <button class="lp-expand-text" data-lilypad-expand-body type="button">Edit Raw</button>
        </div>
      </div>

      <div class="lp-body-grid">
        <textarea data-lilypad-body class="lp-source-textarea" hidden>${escapeHtml(note.body)}</textarea>
        <div
          class="lp-live-editor"
          data-lilypad-live-editor
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          spellcheck="true"
        ></div>
      </div>
    `

    const body = editor.querySelector('[data-lilypad-body]')
    const liveEditor = editor.querySelector('[data-lilypad-live-editor]')
    const scopeSelect = editor.querySelector('[data-lilypad-scope]')
    const chatHint = editor.querySelector('[data-lilypad-chat-hint]')
    const markDirty = () => {
      dirty = true
      setStatus('Unsaved changes')
    }

    editor.querySelectorAll('input, textarea, select').forEach((field) => {
      field.addEventListener('input', markDirty)
      field.addEventListener('change', markDirty)
    })

    if (liveEditor && body) {
      renderLiveEditorFromMarkdown(liveEditor, body.value)

      liveEditor.addEventListener('input', () => {
        const block = getCurrentLiveBlock(liveEditor)
        if (block) {
          const transformed = transformLiveShortcut(block)
          if (transformed !== block) setCaretToEnd(transformed)
        }
        syncLiveEditorToSource(liveEditor, body)
        markDirty()
      })

      liveEditor.addEventListener('keydown', (event) => {
        const block = getCurrentLiveBlock(liveEditor)
        if (!block) return

        if (event.key === 'Backspace' && liveBlockText(block) === '' && block.dataset.mdType !== 'p') {
          event.preventDefault()
          const paragraph = replaceLiveBlock(block, 'p')
          setCaretToEnd(paragraph)
          syncLiveEditorToSource(liveEditor, body)
          markDirty()
          return
        }

        if (event.key !== 'Enter' || event.shiftKey || block.dataset.mdType === 'code') return

        event.preventDefault()
        const type = block.dataset.mdType ?? 'p'
        if (liveBlockText(block) === '' && ['h', 'ul', 'ol', 'quote'].includes(type)) {
          const paragraph = replaceLiveBlock(block, 'p')
          setCaretToEnd(paragraph)
          syncLiveEditorToSource(liveEditor, body)
          markDirty()
          return
        }

        const nextType = type === 'ul' || type === 'ol' ? type : 'p'
        const next = createLiveBlock(nextType)
        block.insertAdjacentElement('afterend', next)
        updateOrderedListIndexes(liveEditor)
        setCaretToEnd(next)
        syncLiveEditorToSource(liveEditor, body)
        markDirty()
      })

      liveEditor.addEventListener('paste', (event) => {
        event.preventDefault()
        const text = event.clipboardData?.getData('text/plain') ?? ''
        document.execCommand('insertText', false, text)
      })
    }

    editor.querySelector('[data-lilypad-expand-body]')?.addEventListener('click', () => {
      openExpandedTextEditor(
        'body',
        selectedNote?.title ? `Edit ${selectedNote.title}` : 'Edit Note Body',
        body?.value ?? '',
        'Write your note...',
      )
    })

    scopeSelect?.addEventListener('change', () => {
      if (!chatHint) return
      chatHint.textContent =
        scopeSelect.value === 'chat'
          ? `Chat note: ${activeChat.chatName ?? selectedNote?.chatName ?? 'Current chat'}`
          : 'Global note'
    })

    editor.querySelector('[data-lilypad-save]')?.addEventListener('click', () => {
      const noteToSave = collectEditorNote()
      if (!noteToSave) return
      setStatus('Saving...')
      ctx.sendToBackend({ type: 'notes:save', note: noteToSave })
    })

    editor.querySelector('[data-lilypad-delete]')?.addEventListener('click', () => {
      if (!selectedNote?.id) {
        selectedNote = null
        dirty = false
        renderEditor()
        setStatus('Draft cleared')
        return
      }

      if (!window.confirm(`Delete "${selectedNote.title}"?`)) return
      setStatus('Deleting...')
      ctx.sendToBackend({ type: 'notes:delete', id: selectedNote.id })
    })

    dirty = false
  }

  function renderShell(source) {
    if (!activeRoot) return

    activeRoot.innerHTML = `
      <style>
        .lp-shell { display: grid; grid-template-columns: 172px 260px minmax(320px, 1fr); gap: 12px; height: min(680px, 76vh); box-sizing: border-box; color: var(--lumiverse-text); transition: grid-template-columns .18s ease; }
        .lp-shell.is-list-collapsed { grid-template-columns: 172px 46px minmax(360px, 1fr); }
        .lp-pane { min-width: 0; overflow: hidden; }
        .lp-sidebar, .lp-list-pane { border-right: 1px solid var(--lumiverse-border); padding-right: 12px; }
        .lp-list-pane { position: relative; }
        .lp-heading { font-weight: 700; margin-bottom: 8px; }
        .lp-filter, .lp-folder, .lp-folder-action, .lp-folder-add, .lp-note-card, .lp-primary, .lp-actions button, .lp-new, .lp-list-toggle, .lp-list-collapsed, .lp-expand-text { border: 1px solid var(--lumiverse-border); background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); border-radius: 8px; cursor: pointer; }
        .lp-new { width: 100%; padding: 8px 10px; margin-bottom: 10px; text-align: left; }
        .lp-filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
        .lp-filter { padding: 6px 7px; text-align: center; font-size: 12px; }
        .lp-folder { width: 100%; padding: 7px 9px; margin-bottom: 6px; text-align: left; }
        .lp-filter.is-active, .lp-folder.is-active, .lp-note-card.is-selected, .lp-primary { background: var(--lumiverse-accent, var(--lumiverse-fill)); color: var(--lumiverse-accent-contrast, var(--lumiverse-text)); }
        .lp-section-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 0 8px; font-size: 12px; color: var(--lumiverse-text-dim); }
        .lp-folder-add { width: 28px; height: 24px; padding: 0; text-align: center; }
        .lp-folder-list { max-height: 118px; overflow: auto; padding-right: 2px; }
        .lp-folder-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 2px; }
        .lp-folder-action { padding: 6px 8px; font-size: 12px; }
        .lp-folder-action:disabled { cursor: not-allowed; opacity: .45; }
        .lp-data-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0 0 8px; }
        .lp-data-action { border: 1px solid var(--lumiverse-border); background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); border-radius: 8px; cursor: pointer; padding: 7px 8px; font-size: 12px; }
        .lp-search, .lp-title-input, .lp-meta-grid input, .lp-meta-grid select, .lp-live-editor { width: 100%; box-sizing: border-box; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); }
        .lp-list-tools { display: grid; grid-template-columns: minmax(0, 1fr) 34px; gap: 6px; margin-bottom: 10px; }
        .lp-search { padding: 8px; }
        .lp-list-toggle { padding: 0; font-size: 18px; line-height: 1; }
        .lp-list-collapsed { display: none; width: 100%; height: 100%; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: var(--lumiverse-text-dim); font-size: 12px; }
        .lp-list-collapsed span { writing-mode: vertical-rl; text-orientation: mixed; }
        .lp-list-collapsed strong { color: var(--lumiverse-text); font-size: 13px; }
        .lp-shell.is-list-collapsed .lp-list-expanded { display: none; }
        .lp-shell.is-list-collapsed .lp-list-collapsed { display: flex; }
        .lp-note-list { height: calc(100% - 48px); overflow: auto; padding-right: 2px; }
        .lp-note-card { display: block; width: 100%; padding: 10px; margin-bottom: 8px; text-align: left; }
        .lp-note-title, .lp-note-meta, .lp-note-tags { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp-note-title { font-weight: 700; }
        .lp-note-meta, .lp-note-tags, .lp-status, .lp-chat-context, .lp-field-hint, .lp-note-context, .lp-empty span { color: var(--lumiverse-text-dim); font-size: 12px; margin-top: 4px; }
        .lp-chat-context { display: block; margin: 4px 0 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp-empty { padding: 12px; border: 1px dashed var(--lumiverse-border); border-radius: 8px; }
        .lp-empty strong, .lp-empty span { display: block; }
        .lp-editor { height: 100%; overflow: hidden; display: flex; flex-direction: column; gap: 10px; }
        .lp-editor-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
        .lp-title-input { padding: 9px 10px; font-weight: 700; }
        .lp-actions { display: flex; gap: 8px; }
        .lp-actions button { padding: 8px 10px; }
        .lp-meta-grid { display: grid; grid-template-columns: 120px minmax(0, 1fr) minmax(0, 1.2fr) 82px; gap: 8px; align-items: start; }
        .lp-meta-grid label { color: var(--lumiverse-text-dim); font-size: 12px; }
        .lp-meta-grid input, .lp-meta-grid select { display: block; margin-top: 4px; padding: 7px 8px; }
        .lp-field-hint { display: block; min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp-note-context { min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lp-check { display: flex; align-items: center; gap: 6px; min-height: 34px; margin-top: 18px; }
        .lp-markdown-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--lumiverse-text-dim); font-size: 12px; }
        .lp-markdown-actions { display: flex; align-items: center; gap: 6px; }
        .lp-expand-text { padding: 4px 7px; font-size: 12px; background: transparent; color: var(--lumiverse-text-dim); }
        .lp-expand-text:hover { color: var(--lumiverse-text); }
        .lp-body-grid { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr); }
        .lp-source-textarea { display: none; }
        .lp-live-editor { min-height: 0; overflow: auto; padding: 14px; outline: none; line-height: 1.5; }
        .lp-live-editor:focus { border-color: var(--lumiverse-accent, var(--lumiverse-border)); }
        .lp-live-editor:empty::before { content: "Start writing..."; color: var(--lumiverse-text-dim); }
        .lp-live-line { min-height: 1.45em; margin: 0 0 6px; white-space: pre-wrap; word-break: break-word; }
        .lp-live-line:last-child { margin-bottom: 0; }
        .lp-live-heading { color: var(--lumiverse-text); font-weight: 800; line-height: 1.15; }
        .lp-live-heading.is-h1 { font-size: 28px; margin: 0 0 10px; }
        .lp-live-heading.is-h2 { font-size: 22px; margin: 0 0 9px; }
        .lp-live-heading.is-h3 { font-size: 18px; margin: 0 0 8px; }
        .lp-live-heading.is-h4, .lp-live-heading.is-h5, .lp-live-heading.is-h6 { font-size: 15px; margin: 0 0 7px; }
        .lp-live-list { position: relative; padding-left: 24px; }
        .lp-live-list::before { position: absolute; left: 4px; color: var(--lumiverse-text-dim); }
        .lp-live-list.is-ul::before { content: "•"; }
        .lp-live-list.is-ol::before { content: attr(data-md-index) "."; }
        .lp-live-quote { padding-left: 12px; border-left: 3px solid var(--lumiverse-border); color: var(--lumiverse-text-dim); }
        .lp-live-code { margin: 0 0 10px; padding: 10px; overflow: auto; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill); color: var(--lumiverse-text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; white-space: pre-wrap; }
        .lp-live-code[data-md-info]:not([data-md-info=""])::before { content: attr(data-md-info); display: block; margin: -10px -10px 8px; padding: 6px 10px; border-bottom: 1px solid var(--lumiverse-border); color: var(--lumiverse-text-dim); font-size: 12px; }
        .lp-preview { min-height: 0; overflow: auto; padding: 12px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: transparent; line-height: 1.45; }
        .lp-preview:empty::before { content: "No markdown yet."; color: var(--lumiverse-text-dim); }
        .lp-preview h1, .lp-preview h2, .lp-preview h3, .lp-preview h4, .lp-preview h5, .lp-preview h6 { margin: 0 0 8px; }
        .lp-preview p { margin: 0 0 8px; }
        .lp-preview ul, .lp-preview ol { margin: 0 0 10px 22px; padding: 0; }
        .lp-preview ul { list-style: disc outside; }
        .lp-preview ol { list-style: decimal outside; }
        .lp-preview li { margin: 3px 0; }
        .lp-preview li::marker { color: var(--lumiverse-text-dim); }
        .lp-preview blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid var(--lumiverse-border); color: var(--lumiverse-text-dim); }
        .lp-code-block { margin: 0 0 10px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill); overflow: hidden; }
        .lp-code-block figcaption { padding: 6px 10px; border-bottom: 1px solid var(--lumiverse-border); color: var(--lumiverse-text-dim); font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .lp-preview pre { margin: 0 0 10px; padding: 10px; overflow: auto; border-radius: 8px; background: var(--lumiverse-fill); }
        .lp-code-block pre { margin: 0; border-radius: 0; background: transparent; }
        .lp-preview code { padding: 1px 4px; border-radius: 4px; background: var(--lumiverse-fill); }
        .lp-preview pre code { padding: 0; background: transparent; }
        .lp-preview a { color: var(--lumiverse-accent, currentColor); text-decoration: underline; text-underline-offset: 2px; }
        .lp-preview img { display: block; max-width: 100%; height: auto; margin: 8px 0 10px; border-radius: 8px; border: 1px solid var(--lumiverse-border); }
        .lp-preview hr { border: 0; border-top: 1px solid var(--lumiverse-border); margin: 12px 0; }
        .lp-footer { margin-top: 10px; display: flex; justify-content: space-between; gap: 8px; }
        @media (max-width: 760px) {
          .lp-shell, .lp-shell.is-list-collapsed { grid-template-columns: 1fr; height: min(720px, 78vh); overflow: auto; }
          .lp-shell.is-list-collapsed .lp-list-expanded { display: block; }
          .lp-shell.is-list-collapsed .lp-list-collapsed { display: none; }
          .lp-sidebar, .lp-list-pane { border-right: 0; border-bottom: 1px solid var(--lumiverse-border); padding-right: 0; padding-bottom: 10px; }
          .lp-note-list { max-height: 210px; }
          .lp-meta-grid, .lp-body-grid, .lp-editor-head { grid-template-columns: 1fr; }
          .lp-check { margin-top: 0; }
          .lp-actions { justify-content: stretch; }
          .lp-actions button { flex: 1; }
          .lp-live-editor { min-height: 220px; }
        }
      </style>
      <div class="lp-shell" data-lilypad-open-source="${source}">
        <aside class="lp-pane lp-sidebar">
          <div class="lp-heading">Lilypad</div>
          <button class="lp-new" data-lilypad-new>+ New Note</button>
          <div class="lp-section-title"><span>View</span></div>
          <div class="lp-filter-grid">
            <button class="lp-filter is-active" data-scope="all">All</button>
            <button class="lp-filter" data-scope="chat">Chat</button>
            <button class="lp-filter" data-scope="standalone">Global</button>
            <button class="lp-filter" data-scope="pinned">Pinned</button>
          </div>
          <div class="lp-section-title">
            <span>Folders</span>
            <button class="lp-folder-add" data-lilypad-folder-add title="New folder">+</button>
          </div>
          <button class="lp-folder is-active" data-folder-filter="all">All Folders</button>
          <button class="lp-folder" data-folder-filter="none">No Folder</button>
          <div class="lp-folder-list" data-lilypad-folder-list></div>
          <div class="lp-folder-actions">
            <button class="lp-folder-action" data-lilypad-folder-rename disabled>Rename</button>
            <button class="lp-folder-action" data-lilypad-folder-delete disabled>Delete</button>
          </div>
          <div class="lp-section-title"><span>Library Backup</span></div>
          <div class="lp-data-actions">
            <button class="lp-data-action" data-lilypad-export>Export JSON</button>
            <button class="lp-data-action" data-lilypad-import>Import JSON</button>
          </div>
          <input data-lilypad-import-file type="file" accept="application/json,.json" hidden />
          <span class="lp-chat-context" data-lilypad-chat-context>This Chat: checking...</span>
          <div class="lp-footer">
            <span class="lp-status" data-lilypad-status>Ready</span>
          </div>
        </aside>

        <section class="lp-pane lp-list-pane">
          <div class="lp-list-expanded">
            <div class="lp-list-tools">
              <input class="lp-search" data-lilypad-search placeholder="Search title, body, or tags..." />
              <button class="lp-list-toggle" data-lilypad-list-collapse type="button" title="Collapse notes">‹</button>
            </div>
            <div class="lp-note-list" data-lilypad-note-list></div>
          </div>
          <button class="lp-list-collapsed" data-lilypad-list-expand type="button" title="Show notes">
            <span>Notes</span>
            <strong data-lilypad-note-count>${index.notes.length}</strong>
          </button>
        </section>

        <main class="lp-pane lp-editor" data-lilypad-editor></main>
      </div>
    `

    setNoteListCollapsed(noteListCollapsed)

    activeRoot.querySelector('[data-lilypad-new]')?.addEventListener('click', () => {
      if (dirty && !window.confirm('Discard unsaved changes?')) return
      selectedNote = createDraftNote()
      setNoteListCollapsed(true)
      renderList()
      renderEditor()
      setStatus('New draft')
    })

    activeRoot.querySelector('[data-lilypad-list-collapse]')?.addEventListener('click', () => {
      setNoteListCollapsed(true)
    })

    activeRoot.querySelector('[data-lilypad-list-expand]')?.addEventListener('click', () => {
      setNoteListCollapsed(false)
    })

    activeRoot.querySelector('[data-lilypad-folder-add]')?.addEventListener('click', () => {
      const name = window.prompt('Folder name?')?.trim()
      if (!name) return
      setStatus('Creating folder...')
      ctx.sendToBackend({ type: 'folders:create', name })
    })

    activeRoot.querySelector('[data-lilypad-folder-rename]')?.addEventListener('click', () => {
      const selected = getSelectedFolder()
      if (!selected) return
      const name = window.prompt('Rename folder?', selected.name)?.trim()
      if (!name || name === selected.name) return
      setStatus('Renaming folder...')
      ctx.sendToBackend({ type: 'folders:update', folder: { id: selected.id, name } })
    })

    activeRoot.querySelector('[data-lilypad-folder-delete]')?.addEventListener('click', () => {
      const selected = getSelectedFolder()
      if (!selected) return
      if (!window.confirm(`Delete folder "${selected.name}"? Notes inside it will be kept and moved to No Folder.`)) return
      setStatus('Deleting folder...')
      ctx.sendToBackend({ type: 'folders:delete', id: selected.id })
    })

    activeRoot.querySelector('[data-lilypad-export]')?.addEventListener('click', () => {
      setStatus('Exporting...')
      ctx.sendToBackend({ type: 'export:all' })
    })

    const importFile = activeRoot.querySelector('[data-lilypad-import-file]')
    activeRoot.querySelector('[data-lilypad-import]')?.addEventListener('click', () => {
      importFile?.click()
    })

    importFile?.addEventListener('change', async () => {
      const file = importFile.files?.[0]
      importFile.value = ''
      if (!file) return

      try {
        const payload = await readImportFile(file)
        if (!window.confirm(`Import ${payload.notes.length} notes? This replaces the current Lilypad library.`)) return
        setStatus('Importing...')
        ctx.sendToBackend({ type: 'import:all', payload })
      } catch (error) {
        const message = error?.message ?? 'Import failed.'
        console.error('[Lilypad]', message)
        window.alert(message)
        setStatus(message)
      }
    })

    activeRoot.querySelectorAll('[data-folder-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextFilter = (button.dataset.folderFilter) || 'all'
        const folderId = button.dataset.folderId ?? null
        selectFolder(nextFilter, folderId)
      })
    })

    activeRoot.querySelectorAll('[data-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        scope = (button.dataset.scope) || 'all'
        activeRoot?.querySelectorAll('[data-scope]').forEach((item) => item.classList.remove('is-active'))
        button.classList.add('is-active')
        setStatus('Loading notes...')
        sendListRequest()
      })
    })

    activeRoot.querySelector('[data-lilypad-search]')?.addEventListener('input', (event) => {
      query = (event.target).value
      setStatus(query.trim() ? 'Searching...' : 'Loading notes...')
      queueListRequest()
    })

    renderChatContext()
    renderFolders()
    renderEditor()
    requestActiveChat()
    sendListRequest()
  }

  function openNotesModal(source = 'inputAction') {
    if (activeNotesModal) {
      activeNotesModal.setTitle?.('Lilypad')
      const sourceMarker = activeNotesModal.root.querySelector('[data-lilypad-open-source]')
      if (sourceMarker) {
        sourceMarker.setAttribute('data-lilypad-open-source', source)
      }
      sendListRequest()
      return
    }

    const modal = ctx.ui.showModal({
      title: 'Lilypad',
      width: 980,
      maxHeight: 740,
    })

    activeNotesModal = modal
    activeRoot = modal.root

    modal.onDismiss?.(() => {
      if (activeNotesModal === modal) {
        activeNotesModal = null
        activeRoot = null
        selectedNote = null
        pendingEditorRequest = null
        noteListCollapsed = false
        dirty = false
      }
    })

    renderShell(source)
  }

  const inputAction = ctx.ui.registerInputBarAction({
    id: 'lilypad-input-open',
    label: 'Open Lilypad',
    iconSvg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      </svg>
    `,
    enabled: true,
  })

  const unsubInputAction = inputAction.onClick(() => {
    openNotesModal('inputAction')
  })

  const unsubChatSwitched =
    ctx.events?.on?.('CHAT_SWITCHED', (payload) => {
      setActiveChat(normalizeChatContext(payload) ?? discoverActiveChat(ctx))
    }) ?? (() => {})

  const unsubBackend = ctx.onBackendMessage((payload) => {
    if (payload.type === 'ui:openNotesModal') {
      if (payload.activeChat?.chatId) {
        setActiveChat({
          chatId: payload.activeChat.chatId,
          chatName: payload.activeChat.chatName,
        })
      }
      openNotesModal(payload.source ?? 'commandPalette')
      return
    }

    if (payload.type === 'editor:result') {
      if (!pendingEditorRequest || pendingEditorRequest.requestId !== payload.requestId) return
      const target = pendingEditorRequest.target
      pendingEditorRequest = null

      if (payload.cancelled) {
        setStatus('Editor cancelled')
        return
      }

      if (target === 'body') {
        const body = activeRoot?.querySelector('[data-lilypad-body]')
        const liveEditor = activeRoot?.querySelector('[data-lilypad-live-editor]')
        if (body) {
          body.value = payload.text
          if (liveEditor) renderLiveEditorFromMarkdown(liveEditor, payload.text)
          dirty = true
          setStatus('Unsaved changes')
        }
      }
      return
    }

    if (payload.type === 'context:activeChat') {
      if (payload.chatId || !activeChat.chatId) {
        setActiveChat({
          chatId: payload.chatId,
          chatName: payload.chatName,
        })
      }
      return
    }

    if (payload.type === 'notes:index') {
      index = payload.index
      if (folderFilter === 'folder' && !index.folders.some((folder) => folder.id === selectedFolderId)) {
        folderFilter = 'all'
        selectedFolderId = null
      }
      renderFolders()
      refreshFolderSelect()
      renderList()
      if (scope === 'chat' && !activeChat.chatId) {
        setStatus('No active chat')
      } else {
        setStatus(`${index.notes.length} note${index.notes.length === 1 ? '' : 's'}`)
      }
      return
    }

    if (payload.type === 'folders:saved') {
      index = payload.index
      renderFolders()
      refreshFolderSelect()
      renderList()
      setStatus('Folder saved')
      return
    }

    if (payload.type === 'folders:deleted') {
      index = payload.index
      if (selectedFolderId === payload.id) {
        folderFilter = 'all'
        selectedFolderId = null
      }
      if (selectedNote?.folderId === payload.id) {
        selectedNote = {
          ...selectedNote,
          folderId: null,
        }
      }
      renderFolders()
      refreshFolderSelect()
      renderList()
      setStatus('Folder deleted')
      return
    }

    if (payload.type === 'export:all') {
      downloadJson(payload.payload)
      setStatus(`Exported ${payload.payload.notes.length} note${payload.payload.notes.length === 1 ? '' : 's'}`)
      return
    }

    if (payload.type === 'import:complete') {
      index = payload.index
      selectedNote = null
      dirty = false
      folderFilter = 'all'
      selectedFolderId = null
      renderFolders()
      renderList()
      renderEditor()
      setStatus(`Imported ${payload.imported} note${payload.imported === 1 ? '' : 's'}`)
      return
    }

    if (payload.type === 'notes:note') {
      selectedNote = payload.note
      dirty = false
      renderList()
      renderEditor()
      setStatus('Loaded')
      return
    }

    if (payload.type === 'notes:saved') {
      selectedNote = payload.note
      dirty = false
      renderEditor()
      setStatus('Saved')
      return
    }

    if (payload.type === 'notes:deleted') {
      if (selectedNote?.id === payload.id) selectedNote = null
      dirty = false
      renderEditor()
      setStatus('Deleted')
      return
    }

    if (payload.type === 'error') {
      console.error('[Lilypad]', payload.message)
      setStatus(payload.message)
    }
  })

  return () => {
    unsubInputAction()
    inputAction.destroy()
    unsubChatSwitched()
    unsubBackend()
    if (listTimer) window.clearTimeout(listTimer)
    activeNotesModal?.dismiss?.()
    activeNotesModal = null
    activeRoot = null
  }
}
