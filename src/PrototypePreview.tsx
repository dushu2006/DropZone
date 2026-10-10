import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, MouseEvent, ReactNode } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Compass,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Flag,
  HandHelping,
  Image as ImageIcon,
  Info,
  LockKeyhole,
  Map as MapIcon,
  MapPin,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Package,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import {
  currentUser,
  defaultZone,
  eventName,
  makeSeedConversations,
  makeSeedCustomRequests,
  makeSeedNotifications,
  makeSeedPosts,
  makeSeedReports,
  timeAgo,
  timeRemaining,
} from './data'
import type {
  CustomRequest,
  NotificationItem,
  OrganizerConversation,
  PageKey,
  Post,
  PostStatus,
  ReportCase,
  TemplateCode,
  UserRole,
} from './types'

const templates: {
  code: TemplateCode
  name: string
  description: string
  icon: typeof Search
  tone: string
  group: string
  extraLabel: string
  extraPlaceholder: string
  bodyPlaceholder: string
  defaultHours: number
}[] = [
  {
    code: 'lost_found',
    name: 'Lost & found',
    description: 'Help a lost item find its way home.',
    icon: Search,
    tone: 'coral',
    group: 'Lost & found',
    extraLabel: 'Approximate place',
    extraPlaceholder: 'e.g. Studio B · near the north entrance',
    bodyPlaceholder: 'Describe the item and any helpful details. Leave out serial numbers or private information.',
    defaultHours: 24,
  },
  {
    code: 'find_teammate',
    name: 'Find a teammate',
    description: 'Meet someone with the skills your idea needs.',
    icon: Users,
    tone: 'violet',
    group: 'Team & help',
    extraLabel: 'Role or skills you need',
    extraPlaceholder: 'e.g. frontend · React · visual design',
    bodyPlaceholder: 'What are you working on, and what would you like a teammate to bring?',
    defaultHours: 2,
  },
  {
    code: 'need_resource',
    name: 'Need an item',
    description: 'Borrow or find a useful item nearby.',
    icon: Package,
    tone: 'blue',
    group: 'Resources',
    extraLabel: 'Item, quantity & arrangement',
    extraPlaceholder: 'e.g. 1 HDMI adapter · borrow',
    bodyPlaceholder: 'What do you need it for, and when do you need it by?',
    defaultHours: 2,
  },
  {
    code: 'ask_help',
    name: 'Ask for help',
    description: 'Get a hand with a task or event question.',
    icon: HandHelping,
    tone: 'gold',
    group: 'Team & help',
    extraLabel: 'Help category',
    extraPlaceholder: 'e.g. Tech · logistics · accessibility',
    bodyPlaceholder: 'Share enough context for someone nearby to help. Please do not include sensitive personal details.',
    defaultHours: 2,
  },
  {
    code: 'offer_resource',
    name: 'Offer help or a resource',
    description: 'Let the community know what you can share.',
    icon: Sparkles,
    tone: 'green',
    group: 'Resources',
    extraLabel: 'Availability or quantity',
    extraPlaceholder: 'e.g. Free until 3 pm · one spot',
    bodyPlaceholder: 'What can you offer, and what should people know before they respond?',
    defaultHours: 2,
  },
  {
    code: 'community_question',
    name: 'Community question',
    description: 'Ask a question for this event community.',
    icon: MessageCircle,
    tone: 'slate',
    group: 'Questions',
    extraLabel: 'Topic (optional)',
    extraPlaceholder: 'e.g. Food · schedule · venue',
    bodyPlaceholder: 'Add a little detail so the right people can answer.',
    defaultHours: 6,
  },
]

const pageNames: Record<PageKey, string> = {
  community: 'Community',
  create: 'Create a post',
  organizers: 'Talk to organizers',
  activity: 'My activity',
  notifications: 'Notifications',
  overview: 'Event overview',
  zones: 'Zones',
  participants: 'Participants & teams',
  communications: 'Communications',
  moderation: 'Moderation center',
  settings: 'Settings & privacy',
}

const demoTeams = [
  { name: 'Team Aurora', count: 6 },
  { name: 'Green Circuit', count: 5 },
  { name: 'Northstar', count: 7 },
  { name: 'Open source crew', count: 4 },
]

function useStoredState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.localStorage.getItem(key)
      return saved ? (JSON.parse(saved) as T) : initial()
    } catch {
      return initial()
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // The app remains usable when browser storage is disabled or full.
    }
  }, [key, value])

  return [value, setValue] as const
}

function newId(prefix = 'dz') {
  return `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}`
}

function isActive(post: Post) {
  return post.status === 'published' && post.expiresAt > Date.now()
}

function prettyStatus(status: PostStatus) {
  if (status === 'published') return 'Active'
  if (status === 'fulfilled') return 'Resolved'
  if (status === 'closed') return 'Closed'
  if (status === 'removed') return 'Removed'
  return 'Expired'
}

function templateFor(code: TemplateCode) {
  return templates.find((template) => template.code === code) ?? templates[0]
}

function addHoursToNow(hours: number) {
  return Date.now() + hours * 60 * 60 * 1000
}

function polygonValidationError(points: { x: number; y: number }[]): string | null {
  if (points.length < 3) return 'Add at least three boundary points before saving a polygon.'
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0)
  if (Math.abs(area) < 0.01) return 'These points do not enclose an area. Add or move a point and try again.'
  const orientation = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const onSegment = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => Math.min(a.x, b.x) - 0.0001 <= c.x && c.x <= Math.max(a.x, b.x) + 0.0001 && Math.min(a.y, b.y) - 0.0001 <= c.y && c.y <= Math.max(a.y, b.y) + 0.0001
  const intersects = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
    const abC = orientation(a, b, c)
    const abD = orientation(a, b, d)
    const cdA = orientation(c, d, a)
    const cdB = orientation(c, d, b)
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true
    return (Math.abs(abC) < 0.0001 && onSegment(a, b, c)) || (Math.abs(abD) < 0.0001 && onSegment(a, b, d)) || (Math.abs(cdA) < 0.0001 && onSegment(c, d, a)) || (Math.abs(cdB) < 0.0001 && onSegment(c, d, b))
  }
  for (let first = 0; first < points.length; first += 1) {
    const a = points[first]
    const b = points[(first + 1) % points.length]
    for (let second = first + 1; second < points.length; second += 1) {
      if (second === first || second === (first + 1) % points.length || first === (second + 1) % points.length) continue
      const c = points[second]
      const d = points[(second + 1) % points.length]
      if (intersects(a, b, c, d)) return 'This boundary crosses itself. Move or remove the crossing points, then save again.'
    }
  }
  return null
}

function PrototypePreview() {
  const [posts, setPosts] = useStoredState<Post[]>('dropzone.posts.v1', () => makeSeedPosts())
  const [notifications, setNotifications] = useStoredState<NotificationItem[]>('dropzone.notifications.v1', () => makeSeedNotifications())
  const [conversations, setConversations] = useStoredState<OrganizerConversation[]>('dropzone.conversations.v1', () => makeSeedConversations())
  const [customRequests, setCustomRequests] = useStoredState<CustomRequest[]>('dropzone.custom-requests.v1', () => makeSeedCustomRequests())
  const [reports, setReports] = useStoredState<ReportCase[]>('dropzone.reports.v1', () => makeSeedReports())
  const [blockedAuthors, setBlockedAuthors] = useStoredState<string[]>('dropzone.blocked-authors.v1', () => [])
  const [mutedCategories, setMutedCategories] = useStoredState<string[]>('dropzone.muted-categories.v1', () => [])
  const [notificationPreferences, setNotificationPreferences] = useStoredState('dropzone.notification-preferences.v1', () => ({ inApp: true, replies: true, announcements: true }))
  const [role, setRole] = useStoredState<UserRole>('dropzone.role.v1', () => 'participant')

  const [page, setPage] = useState<PageKey>('community')
  const [clockNow, setClockNow] = useState(Date.now())
  const [zone, setZone] = useState(defaultZone)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('All')
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [reportPostId, setReportPostId] = useState<string | null>(null)
  const [zoneMenuOpen, setZoneMenuOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [zoneCheck, setZoneCheck] = useState<'simulated' | 'checking' | 'denied' | 'uncertain' | 'unavailable' | 'not-verified'>('simulated')
  const [toast, setToast] = useState('')
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimeout.current) clearTimeout(toastTimeout.current)
    toastTimeout.current = setTimeout(() => setToast(''), 3400)
  }

  useEffect(() => () => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const unreadCount = notifications.filter((notification) => !notification.read).length
  const visiblePosts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return posts
      .filter(isActive)
      .filter((post) => post.visibility === 'event' || (post.zone ?? defaultZone) === zone)
      .filter((post) => !blockedAuthors.includes(post.author))
      .filter((post) => {
        if (activeFilter === 'All') return true
        if (activeFilter === 'Team & help') return post.template === 'find_teammate' || post.template === 'ask_help'
        return templateFor(post.template).group === activeFilter
      })
      .filter((post) => !query || `${post.title} ${post.body} ${post.author} ${post.extra ?? ''}`.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [posts, search, activeFilter, blockedAuthors, zone, clockNow])

  const addNotification = (item: Omit<NotificationItem, 'id' | 'read' | 'createdAt'>) => {
    if (!notificationPreferences.inApp || (item.kind === 'reply' && !notificationPreferences.replies) || (item.kind === 'announcement' && !notificationPreferences.announcements)) return
    setNotifications((items) => [{ ...item, id: newId('notice'), read: false, createdAt: Date.now() }, ...items])
  }

  const publishPost = (input: {
    template: TemplateCode
    title: string
    body: string
    extra?: string
    locationNote?: string
    hours: number
    attachmentName?: string
    downloadAllowed?: boolean
  }) => {
    const post: Post = {
      id: newId('post'),
      zone,
      visibility: 'zone',
      template: input.template,
      title: input.title.trim(),
      body: input.body.trim(),
      author: 'You',
      initials: currentUser.initials,
      avatarColor: 'green',
      createdAt: Date.now(),
      expiresAt: addHoursToNow(input.hours),
      status: 'published',
      replies: [],
      extra: input.extra?.trim() || undefined,
      locationNote: input.locationNote?.trim() || undefined,
      attachmentName: input.attachmentName,
      downloadAllowed: input.downloadAllowed,
    }
    setPosts((items) => [post, ...items])
    addNotification({ kind: 'status', title: 'Your post is live', body: `“${post.title}” is now visible to eligible members of ${zone}.` })
    setPage('community')
    setSearch('')
    setActiveFilter('All')
    showToast('Your post is live in this browser demo.')
  }

  const submitCustomRequest = (request: Omit<CustomRequest, 'id' | 'submittedAt' | 'status'>) => {
    const created: CustomRequest = { ...request, id: newId('custom'), submittedAt: Date.now(), status: 'submitted' }
    setCustomRequests((items) => [created, ...items])
    addNotification({ kind: 'status', title: 'Custom post submitted', body: 'Your request is private while the event team reviews it.' })
    setPage('activity')
    showToast('Custom post request submitted for review.')
  }

  const respondToPost = (postId: string, body: string) => {
    const post = posts.find((item) => item.id === postId)
    if (!post || !isActive(post)) {
      showToast('This post is no longer accepting replies.')
      return
    }
    const reply = { id: newId('reply'), author: 'You', initials: currentUser.initials, body: body.trim(), createdAt: Date.now(), mine: true }
    setPosts((items) => items.map((item) => item.id === postId ? { ...item, replies: [...item.replies, reply] } : item))
    if (post.author !== 'You' && !mutedCategories.includes(templateFor(post.template).group)) addNotification({ kind: 'reply', title: 'Reply sent', body: `Your reply was added to “${post.title}”.` })
    showToast('Reply added to the thread.')
  }

  const resolvePost = (postId: string, status: 'fulfilled' | 'closed' = 'fulfilled') => {
    setPosts((items) => items.map((post) => post.id === postId ? { ...post, status } : post))
    setSelectedPostId(null)
    showToast(status === 'fulfilled' ? 'Marked as resolved. It is no longer active.' : 'Post closed and removed from active discovery.')
  }

  const reportPost = (postId: string, reason: string, details: string) => {
    const post = posts.find((item) => item.id === postId)
    if (!post) return
    setReports((items) => [{
      id: newId('report'),
      target: `Post: “${post.title}”`,
      targetPostId: post.id,
      reason: details.trim() ? `${reason} · ${details.trim()}` : reason,
      zone,
      reportedAt: Date.now(),
      status: 'new',
      reporter: 'You',
    }, ...items])
    setReportPostId(null)
    showToast('Report sent to the moderation team. The post remains visible for now.')
  }

  const blockAuthor = (author: string) => {
    if (author === 'You') return
    setBlockedAuthors((items) => items.includes(author) ? items : [...items, author])
    showToast(`${author} is hidden from your feed. You can undo this in Settings.`)
  }

  const createConversation = (input: { subject: string; category: string; body: string }) => {
    const id = newId('conversation')
    const conversation: OrganizerConversation = {
      id,
      subject: input.subject,
      category: input.category,
      status: 'awaiting_organizer',
      updatedAt: Date.now(),
      messages: [{ id: newId('message'), author: 'You', body: input.body, createdAt: Date.now(), mine: true }],
    }
    setConversations((items) => [conversation, ...items])
    showToast('Private message sent to the organizer group.')
    return id
  }

  const sendConversationMessage = (conversationId: string, body: string) => {
    setConversations((items) => items.map((conversation) => conversation.id === conversationId ? {
      ...conversation,
      status: role === 'organizer' ? 'awaiting_participant' : 'awaiting_organizer',
      updatedAt: Date.now(),
      messages: [...conversation.messages, {
        id: newId('message'),
        author: role === 'organizer' ? 'You · Organizer' : 'You',
        body,
        createdAt: Date.now(),
        mine: true,
      }],
    } : conversation))
    showToast('Message sent to the private conversation.')
  }

  const setCustomStatus = (requestId: string, status: CustomRequest['status'], reason?: string) => {
    const request = customRequests.find((item) => item.id === requestId)
    setCustomRequests((items) => items.map((item) => item.id === requestId ? { ...item, status, reviewReason: reason } : item))
    if (status === 'approved' && request) {
      const publishedAt = Date.now()
      const eventWide = request.intendedAudience === 'Entire event'
      const post: Post = {
        id: newId('post'),
        zone,
        visibility: eventWide ? 'event' : 'zone',
        template: 'community_question',
        title: request.title,
        body: request.body,
        author: 'You',
        initials: currentUser.initials,
        avatarColor: 'green',
        createdAt: publishedAt,
        expiresAt: publishedAt + 6 * 60 * 60 * 1000,
        status: 'published',
        replies: [],
        extra: 'Approved custom post',
      }
      setPosts((items) => [post, ...items])
      addNotification({ kind: 'status', title: 'Your custom post was approved', body: `“${request.title}” is now published to ${request.intendedAudience}.` })
      showToast('Custom post approved and published to its requested audience.')
    } else {
      addNotification({ kind: 'status', title: status === 'rejected' ? 'Custom post decision' : 'Custom post updated', body: status === 'rejected' ? reason || 'Your request was not approved.' : 'Your custom post request status has changed.' })
      showToast(status === 'rejected' ? 'Request rejected and decision recorded.' : 'Request updated.')
    }
  }

  const handleLocationCheck = () => {
    if (!navigator.geolocation) {
      setZoneCheck('unavailable')
      showToast('Location is not available in this browser. Demo access is still simulated.')
      return
    }
    setZoneCheck('checking')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Coordinates are intentionally not retained. This front-end demo has no server-side geofence.
        setZoneCheck(position.coords.accuracy > 100 ? 'uncertain' : 'not-verified')
        showToast(position.coords.accuracy > 100
          ? 'Location is uncertain. No zone was verified and your coordinates were discarded.'
          : 'Location estimate received. Live zone validation is not connected; demo access remains simulated.')
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED
        setZoneCheck(denied ? 'denied' : 'unavailable')
        showToast(denied
          ? 'Location permission was denied. You can change this in browser settings; no access was verified.'
          : 'Could not get a location estimate. Demo access remains simulated.')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  const goTo = (nextPage: PageKey) => {
    setPage(nextPage)
    setProfileMenuOpen(false)
    setZoneMenuOpen(false)
    if (nextPage === 'notifications') {
      setNotifications((items) => items.map((item) => ({ ...item, read: true })))
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const selectRole = (nextRole: UserRole) => {
    setRole(nextRole)
    setProfileMenuOpen(false)
    if (nextRole === 'organizer' && ['organizers', 'activity', 'settings'].includes(page)) setPage('overview')
    if (nextRole === 'participant' && ['overview', 'zones', 'participants', 'communications', 'moderation'].includes(page)) setPage('community')
    showToast(nextRole === 'organizer' ? 'Organizer preview enabled. Actions are local to this demo.' : 'Participant view restored.')
  }

  const renderPage = () => {
    switch (page) {
      case 'community':
        return <CommunityPage
          posts={visiblePosts}
          zone={zone}
          activeFilter={activeFilter}
          onFilter={setActiveFilter}
          onCreate={() => goTo('create')}
          onOpenPost={setSelectedPostId}
          onReport={setReportPostId}
          onBlock={blockAuthor}
          search={search}
        />
      case 'create':
        return <CreatePage zone={zone} onBack={() => goTo('community')} onPublish={publishPost} onCustomRequest={submitCustomRequest} />
      case 'organizers':
        return <OrganizersPage
          conversations={conversations}
          role={role}
          onCreate={createConversation}
          onSend={sendConversationMessage}
          onResolve={(id) => {
            setConversations((items) => items.map((conversation) => conversation.id === id ? { ...conversation, status: 'resolved' } : conversation))
            showToast('Conversation resolved.')
          }}
        />
      case 'activity':
        return <ActivityPage posts={posts} requests={customRequests} conversations={conversations} onOpenPost={setSelectedPostId} onCreate={() => goTo('create')} onSettings={() => goTo('settings')} onOpenConversations={() => goTo('organizers')} />
      case 'notifications':
        return <NotificationsPage notifications={notifications} onMarkAll={() => setNotifications((items) => items.map((item) => ({ ...item, read: true })))} />
      case 'overview':
        return <OverviewPage posts={posts} reports={reports} customRequests={customRequests} onNavigate={goTo} />
      case 'zones':
        return <ZonesPage zone={zone} setZone={setZone} onToast={showToast} />
      case 'participants':
        return <ParticipantsPage onToast={showToast} />
      case 'communications':
        return <CommunicationsPage onToast={showToast} />
      case 'moderation':
        return <ModerationPage
          reports={reports}
          requests={customRequests}
          onReportAction={(id, status) => {
            const report = reports.find((item) => item.id === id)
            setReports((items) => items.map((item) => item.id === id ? { ...item, status } : item))
            if (status === 'action_taken' && report?.targetPostId) {
              setPosts((items) => items.map((post) => post.id === report.targetPostId ? { ...post, status: 'removed' } : post))
            }
            showToast(status === 'dismissed' ? 'Report dismissed and recorded.' : status === 'under_review' ? 'Report moved to under review.' : status === 'action_taken' ? 'Content removed from active discovery; decision recorded.' : 'Moderation action recorded.')
          }}
          onCustomAction={setCustomStatus}
        />
      case 'settings':
        return <SettingsPage
          zone={zone}
          blockedAuthors={blockedAuthors}
          setBlockedAuthors={setBlockedAuthors}
          mutedCategories={mutedCategories}
          setMutedCategories={setMutedCategories}
          notificationPreferences={notificationPreferences}
          setNotificationPreferences={setNotificationPreferences}
          onCheckLocation={handleLocationCheck}
          onToast={showToast}
        />
      default:
        return null
    }
  }

  const pageContent = renderPage()
  const communityAside = page === 'community'

  return (
    <>
      <div className="prototype-preview-banner" role="note">
        DEVELOPMENT-ONLY PREVIEW — sample records and role switching are simulated. Never enter real event data here.
      </div>
      <div className={`app-shell ${role === 'organizer' ? 'is-organizer' : ''}`}>
      <Sidebar page={page} role={role} zone={zone} onNavigate={goTo} onSelectZone={(nextZone) => { setZone(nextZone); setZoneCheck('simulated') }} onSwitchRole={() => selectRole(role === 'participant' ? 'organizer' : 'participant')} />
      <div className="workspace">
        <header className="topbar">
          <button className="mobile-brand-lockup" type="button" aria-label={`Choose zone. Current zone: ${zone}, simulation mode`} aria-expanded={zoneMenuOpen} onClick={() => setZoneMenuOpen((open) => !open)}>
            <BrandMark compact />
            <span className="mobile-brand-copy"><strong>{eventName}</strong><span>{zone} · Demo access</span></span>
          </button>
          {zoneMenuOpen && <div className="popover mobile-zone-popover"><div className="popover-title">Choose a demo zone</div><button className={`zone-option ${zone === 'Innovation Hall' ? 'selected' : ''}`} type="button" onClick={() => { setZone('Innovation Hall'); setZoneCheck('simulated'); setZoneMenuOpen(false) }}><span className="zone-option-icon"><MapPin size={15} /></span><span><strong>Innovation Hall</strong><small>1,248 people · Demo zone</small></span>{zone === 'Innovation Hall' && <Check size={15} />}</button><button className={`zone-option ${zone === 'Maker Courtyard' ? 'selected' : ''}`} type="button" onClick={() => { setZone('Maker Courtyard'); setZoneCheck('simulated'); setZoneMenuOpen(false) }}><span className="zone-option-icon"><Compass size={15} /></span><span><strong>Maker Courtyard</strong><small>326 people · Demo zone</small></span>{zone === 'Maker Courtyard' && <Check size={15} />}</button><div className="popover-note"><Info size={14} /><span>Demo access is simulated. Physical presence is not verified.</span></div><button className="location-check-button" type="button" onClick={handleLocationCheck} disabled={zoneCheck === 'checking'}><MapPin size={15} />{zoneCheck === 'checking' ? 'Checking device location…' : 'Check device location'}</button></div>}
          <div className="topbar-context">
            <button className="event-context" type="button" onClick={() => showToast('You are viewing the BuildFest 2026 event space.') }>
              <span className="context-dot" />
              <span className="event-context-name">{eventName}</span>
              <span className="event-context-date">Oct 10–11</span>
              <ChevronDown size={15} />
            </button>
            <span className="topbar-divider" />
            <div className="zone-picker-wrap">
              <button className="zone-context" type="button" onClick={() => setZoneMenuOpen((open) => !open)} aria-expanded={zoneMenuOpen}>
                <MapPin size={15} />
                <span>{zone}</span>
                <ChevronDown size={15} />
              </button>
              {zoneMenuOpen && <div className="popover zone-popover">
                <div className="popover-title">Your current zone</div>
                <button className={`zone-option ${zone === 'Innovation Hall' ? 'selected' : ''}`} onClick={() => { setZone('Innovation Hall'); setZoneCheck('simulated'); setZoneMenuOpen(false) }}>
                  <span className="zone-option-icon"><MapPin size={15} /></span><span><strong>Innovation Hall</strong><small>1,248 people · Demo zone</small></span>{zone === 'Innovation Hall' && <Check size={15} />}
                </button>
                <button className={`zone-option ${zone === 'Maker Courtyard' ? 'selected' : ''}`} onClick={() => { setZone('Maker Courtyard'); setZoneCheck('simulated'); setZoneMenuOpen(false) }}>
                  <span className="zone-option-icon"><Compass size={15} /></span><span><strong>Maker Courtyard</strong><small>326 people · Demo zone</small></span>{zone === 'Maker Courtyard' && <Check size={15} />}
                </button>
                <div className="popover-note"><Info size={14} /><span>Demo access is simulated. This prototype does not verify physical presence.</span></div>
                <button className="location-check-button" type="button" onClick={handleLocationCheck} disabled={zoneCheck === 'checking'}>
                  <MapPin size={15} /> {zoneCheck === 'checking' ? 'Checking device location…' : 'Check device location'}
                </button>
                {zoneCheck !== 'simulated' && zoneCheck !== 'checking' && <p className="location-state-note">{zoneCheck === 'denied' ? 'Permission denied · no access verified' : zoneCheck === 'uncertain' ? 'Location uncertain · no access verified' : zoneCheck === 'unavailable' ? 'Location unavailable · no access verified' : 'Estimate received · zone not verified'}</p>}
              </div>}
            </div>
            <span className="simulation-chip"><span /> Simulation mode</span>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <Search size={16} />
              <input
                ref={searchInputRef}
                aria-label="Search this zone"
                placeholder="Search this zone"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  if (page !== 'community') setPage('community')
                }}
                onFocus={() => { if (page !== 'community') setPage('community') }}
              />
              <kbd>⌘ K</kbd>
            </label>
            <button className={`icon-button notification-button ${unreadCount ? 'has-unread' : ''}`} type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onClick={() => goTo('notifications')}>
              <Bell size={18} />{unreadCount > 0 && <span className="notification-dot" />}
            </button>
            <div className="profile-menu-wrap">
              <button className="top-avatar-button" type="button" onClick={() => setProfileMenuOpen((open) => !open)} aria-label="Open profile menu" aria-expanded={profileMenuOpen}>
                <Avatar initials={currentUser.initials} color="green" size="sm" />
                <ChevronDown size={14} />
              </button>
              {profileMenuOpen && <div className="popover profile-popover">
                <div className="profile-popover-head"><Avatar initials={currentUser.initials} color="green" /><div><strong>{currentUser.name}</strong><small>{role === 'organizer' ? 'Event organizer' : 'Participant'} · BuildFest</small></div></div>
                <button className="profile-menu-item" onClick={() => goTo('settings')}><Settings size={15} /> Settings & privacy</button>
                <button className="profile-menu-item" onClick={() => selectRole(role === 'participant' ? 'organizer' : 'participant')}><Users size={15} /> {role === 'participant' ? 'Preview organizer view' : 'Switch to participant view'}</button>
                <div className="profile-demo-note">Preview mode · changes are saved in this browser only</div>
              </div>}
            </div>
          </div>
        </header>
        <main id="main-content" className="page-container">
          <div className={communityAside ? 'content-layout with-aside' : 'content-layout'}>
            <section className="primary-content" aria-label={pageNames[page]}>{pageContent}</section>
            {communityAside && <CommunityAside zone={zone} onOrganizers={() => goTo('organizers')} onCreate={() => goTo('create')} />}
          </div>
        </main>
        <MobileNavigation page={page} role={role} onNavigate={goTo} onCreate={() => goTo('create')} />
      </div>
      {selectedPostId && <PostDetailModal
        post={posts.find((post) => post.id === selectedPostId) ?? null}
        onClose={() => setSelectedPostId(null)}
        onRespond={respondToPost}
        onResolve={resolvePost}
        onReport={setReportPostId}
        onBlock={blockAuthor}
        role={role}
      />}
      {reportPostId && <ReportModal post={posts.find((post) => post.id === reportPostId) ?? null} onClose={() => setReportPostId(null)} onSubmit={(reason, details) => reportPost(reportPostId, reason, details)} />}
      {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
      </div>
    </>
  )
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-mark ${compact ? 'compact' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>
}

function Avatar({ initials, color = 'slate', size = 'md' }: { initials: string; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar-${color} avatar-${size}`} aria-hidden="true">{initials}</span>
}

function Sidebar({ page, role, zone, onNavigate, onSelectZone, onSwitchRole }: { page: PageKey; role: UserRole; zone: string; onNavigate: (page: PageKey) => void; onSelectZone: (zone: string) => void; onSwitchRole: () => void }) {
  const primary: { key: PageKey; label: string; icon: typeof Search; badge?: string }[] = [
    { key: 'community', label: 'Community', icon: Compass },
    { key: 'organizers', label: 'Talk to organizers', icon: MessageSquare },
    { key: 'activity', label: 'My activity', icon: Activity },
  ]
  const organizer: { key: PageKey; label: string; icon: typeof Search }[] = [
    { key: 'overview', label: 'Event overview', icon: Compass },
    { key: 'zones', label: 'Zones', icon: MapIcon },
    { key: 'participants', label: 'Participants & teams', icon: Users },
    { key: 'communications', label: 'Communications', icon: Send },
    { key: 'moderation', label: 'Moderation', icon: ShieldCheck },
  ]

  return <aside className="sidebar">
    <button className="brand-lockup" type="button" onClick={() => onNavigate('community')}>
      <BrandMark />
      <span>dropzone<span className="brand-period">.</span></span>
    </button>
    <div className="event-card-mini">
      <div className="event-mini-icon"><CalendarDays size={16} /></div>
      <div className="event-mini-copy"><span>YOUR EVENT</span><strong>{eventName}</strong><small><span className="event-live-dot" /> Happening now</small></div>
      <ChevronDown size={14} className="event-mini-chevron" />
    </div>
    <div className="sidebar-section-label">YOUR SPACE</div>
    <nav className="side-nav" aria-label="Main navigation">
      {primary.map((item) => <NavButton key={item.key} item={item} active={page === item.key} onClick={() => onNavigate(item.key)} />)}
    </nav>
    <div className="sidebar-section-label sidebar-section-secondary">YOUR ZONES</div>
    <button className={`sidebar-zone-link ${zone === 'Innovation Hall' ? 'zone-current' : ''}`} type="button" onClick={() => { onSelectZone('Innovation Hall'); onNavigate('community') }}>
      <span className="zone-link-icon"><MapPin size={15} /></span><span className="zone-link-copy"><strong>Innovation Hall</strong><small>1,248 here · demo</small></span><span className="zone-link-status" />
    </button>
    <button className={`sidebar-zone-link ${zone === 'Maker Courtyard' ? 'zone-current' : ''}`} type="button" onClick={() => { onSelectZone('Maker Courtyard'); onNavigate('community') }}>
      <span className="zone-link-icon muted"><Compass size={15} /></span><span className="zone-link-copy"><strong>Maker Courtyard</strong><small>326 here · demo</small></span>
    </button>
    {role === 'organizer' && <>
      <div className="sidebar-section-label organizer-label">ORGANIZER TOOLS</div>
      <nav className="side-nav organizer-nav" aria-label="Organizer navigation">
        {organizer.map((item) => <NavButton key={item.key} item={item} active={page === item.key} onClick={() => onNavigate(item.key)} />)}
      </nav>
    </>}
    <div className="sidebar-spacer" />
    <div className="sidebar-privacy-note"><span className="privacy-icon"><LockKeyhole size={14} /></span><div><strong>Your location stays yours</strong><span>Only this zone is shared.</span></div></div>
    <button className="sidebar-settings-link" type="button" onClick={() => onNavigate('settings')}><Settings size={16} /> Settings & privacy</button>
    <div className="sidebar-user-row">
      <Avatar initials={currentUser.initials} color="green" size="md" />
      <div className="sidebar-user-copy"><strong>{currentUser.name}</strong><span>{role === 'organizer' ? 'Organizer preview' : 'Event participant'}</span></div>
      <button className="sidebar-role-switch" type="button" onClick={onSwitchRole} title={role === 'participant' ? 'Switch to organizer preview' : 'Switch to participant view'} aria-label={role === 'participant' ? 'Switch to organizer preview' : 'Switch to participant view'}><ArrowUpRight size={15} /></button>
    </div>
  </aside>
}

function NavButton({ item, active, onClick }: { item: { key: PageKey; label: string; icon: typeof Search; badge?: string }; active: boolean; onClick: () => void }) {
  const Icon = item.icon
  return <button className={`nav-button ${active ? 'active' : ''}`} type="button" onClick={onClick} aria-current={active ? 'page' : undefined}>
    <Icon size={17} strokeWidth={active ? 2.15 : 1.8} /><span>{item.label}</span>{item.badge && <small>{item.badge}</small>}
  </button>
}

function MobileNavigation({ page, role, onNavigate, onCreate }: { page: PageKey; role: UserRole; onNavigate: (page: PageKey) => void; onCreate: () => void }) {
  const items: { key: PageKey; label: string; icon: typeof Search; action?: () => void }[] = role === 'participant'
    ? [
      { key: 'community', label: 'Community', icon: Compass },
      { key: 'create', label: 'Create', icon: Plus, action: onCreate },
      { key: 'organizers', label: 'Organizers', icon: MessageSquare },
      { key: 'activity', label: 'Activity', icon: Activity },
      { key: 'settings', label: 'Profile', icon: UserRound },
    ]
    : [
      { key: 'overview', label: 'Overview', icon: Compass },
      { key: 'zones', label: 'Zones', icon: MapIcon },
      { key: 'communications', label: 'Messages', icon: Send },
      { key: 'moderation', label: 'Review', icon: ShieldCheck },
      { key: 'settings', label: 'Profile', icon: UserRound },
    ]
  return <nav className="mobile-nav" aria-label="Mobile navigation">
    {items.map((item) => {
      const Icon = item.icon
      const active = page === item.key || (item.key === 'create' && page === 'create')
      return <button className={active ? 'mobile-nav-item active' : 'mobile-nav-item'} key={item.key} type="button" onClick={item.action ?? (() => onNavigate(item.key))} aria-current={active ? 'page' : undefined}>
        <Icon size={19} strokeWidth={active ? 2.25 : 1.8} /><span>{item.label}</span>
      </button>
    })}
  </nav>
}

function CommunityPage({
  posts,
  zone,
  activeFilter,
  onFilter,
  onCreate,
  onOpenPost,
  onReport,
  onBlock,
  search,
}: {
  posts: Post[]
  zone: string
  activeFilter: string
  onFilter: (filter: string) => void
  onCreate: () => void
  onOpenPost: (id: string) => void
  onReport: (id: string) => void
  onBlock: (author: string) => void
  search: string
}) {
  const filters = ['All', 'Lost & found', 'Team & help', 'Resources', 'Questions']
  return <>
    <div className="page-intro community-intro">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot" /> BUILD FEST · COMMUNITY</div>
        <h1>Your event, <span>in the moment.</span></h1>
        <p>Good things happen when the right people are close by.</p>
      </div>
      <button className="primary-button create-main-button" type="button" onClick={onCreate}><Plus size={17} /> Create a post</button>
    </div>
    <AnnouncementBanner />
    <section className="feed-section" aria-label="Community posts">
      <div className="feed-heading-row">
        <div><h2>Happening nearby</h2><p>{posts.length} active {posts.length === 1 ? 'post' : 'posts'} in <strong>{zone}</strong></p></div>
        <div className="feed-sort"><span className="sort-pulse" /> Latest first <ChevronDown size={14} /></div>
      </div>
      <div className="filter-row" role="tablist" aria-label="Filter community posts">
        {filters.map((filter) => <button key={filter} type="button" className={`filter-chip ${activeFilter === filter ? 'selected' : ''}`} onClick={() => onFilter(filter)} role="tab" aria-selected={activeFilter === filter}>{filter}{filter === 'All' && <span className="filter-count">{posts.length}</span>}</button>)}
      </div>
      {search && <div className="search-results-note"><Search size={14} /> Showing results for <strong>“{search}”</strong><button type="button" onClick={() => onFilter('All')}>Clear category</button></div>}
      {posts.length === 0 ? <div className="empty-state feed-empty"><div className="empty-state-icon"><Compass size={22} /></div><h3>Nothing here just yet</h3><p>Try another filter or start a conversation with your zone.</p><button type="button" className="secondary-button" onClick={onCreate}><Plus size={15} /> Create a post</button></div> : <div className="post-list">
        {posts.map((post) => <PostCard key={post.id} post={post} onOpen={() => onOpenPost(post.id)} onReport={() => onReport(post.id)} onBlock={() => onBlock(post.author)} />)}
      </div>}
      <p className="feed-footnote"><LockKeyhole size={13} /> Demo feed only · production access requires server-side zone authorization.</p>
    </section>
  </>
}

function AnnouncementBanner() {
  return <article className="announcement-banner">
    <div className="announcement-icon"><Megaphone size={17} /></div>
    <div className="announcement-copy"><div className="announcement-meta"><span>FROM THE ORGANIZERS</span><span className="announcement-separator">·</span><span>31 min ago</span></div><h2>Workshop room update</h2><p>Rapid prototyping has moved to <strong>Cedar 2</strong>. Step-free access is available from the east entrance.</p></div>
    <span className="announcement-live">Official</span>
  </article>
}

function CommunityAside({ zone, onOrganizers, onCreate }: { zone: string; onOrganizers: () => void; onCreate: () => void }) {
  return <aside className="community-aside" aria-label="Zone information">
    <div className="zone-summary-card">
      <div className="zone-summary-top"><span className="zone-summary-icon"><MapPin size={17} /></span><span className="simulation-mini">SIMULATED</span></div>
      <h3>{zone}</h3>
      <p>BuildFest 2026 · zone community</p>
      <div className="zone-summary-divider" />
      <div className="zone-people-row"><div className="avatar-stack"><Avatar initials="MP" color="rose" size="sm" /><Avatar initials="KN" color="violet" size="sm" /><Avatar initials="LP" color="blue" size="sm" /><span className="avatar-stack-more">+12</span></div><span><strong>{zone === 'Innovation Hall' ? '1,248' : '326'}</strong> participants</span></div>
      <div className="zone-summary-status"><span className="status-orb" /> Your zone access is simulated</div>
    </div>
    <div className="aside-card organizer-help-card">
      <div className="aside-card-icon lavender"><MessageSquare size={17} /></div>
      <h3>Need a hand from the team?</h3>
      <p>Send a private note to the event team. In production, this inbox is limited to authorized organizers.</p>
      <button type="button" className="aside-link-button" onClick={onOrganizers}>Talk to organizers <ArrowRight size={15} /></button>
    </div>
    <div className="aside-card quick-post-card">
      <div className="quick-post-header"><div className="aside-card-icon mint"><Sparkles size={17} /></div><span>GOT SOMETHING TO SHARE?</span></div>
      <h3>Make the moment easier.</h3>
      <p>Find a teammate, borrow an adapter, or help someone out.</p>
      <button type="button" className="secondary-button quick-create-button" onClick={onCreate}><Plus size={15} /> Start a post</button>
    </div>
    <p className="aside-privacy-note"><ShieldCheck size={14} /> No live location is shown to other participants.</p>
  </aside>
}

function PostCard({ post, onOpen, onReport, onBlock }: { post: Post; onOpen: () => void; onReport: () => void; onBlock: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const meta = templateFor(post.template)
  const Icon = meta.icon
  return <article className="post-card">
    <div className="post-card-topline">
      <div className={`post-category-icon tone-${meta.tone}`}><Icon size={16} strokeWidth={1.9} /></div>
      <span className="post-category-label">{meta.name}</span>
      {post.visibility === 'event' && <span className="event-wide-tag">Event-wide</span>}
      <span className="post-top-dot">·</span>
      <span className="post-time">{timeAgo(post.createdAt)}</span>
      <div className="post-card-menu-wrap">
        <button className="post-menu-button" type="button" aria-label={`More options for ${post.title}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button>
        {menuOpen && <div className="post-menu popover">
          <button type="button" onClick={() => { setMenuOpen(false); onReport() }}><Flag size={14} /> Report post</button>
          {post.author !== 'You' && <button type="button" onClick={() => { setMenuOpen(false); onBlock() }}><UserRound size={14} /> Hide {post.author}</button>}
          <div className="post-menu-foot">Reports go to the event moderation queue.</div>
        </div>}
      </div>
    </div>
    <button type="button" className="post-title-button" onClick={onOpen}><h3>{post.title}</h3></button>
    <p className="post-body-preview">{post.body}</p>
    {post.extra && <div className="post-extra-pill"><span className={`extra-pill-dot tone-dot-${meta.tone}`} />{post.extra}</div>}
    {post.locationNote && <div className="post-location-note"><MapPin size={13} />{post.locationNote}</div>}
    {post.attachmentName && <div className="post-attachment-preview"><ImageIcon size={16} /><span>{post.attachmentName}</span><span className="attachment-policy">{post.downloadAllowed ? 'Download allowed' : 'View only · best effort'}</span></div>}
    <div className="post-card-footer">
      <div className="post-author"><Avatar initials={post.initials} color={post.avatarColor} size="sm" /><span><strong>{post.author}</strong><small>{post.author === 'You' ? 'Your post' : 'Event participant'}</small></span></div>
      <div className="post-footer-actions">
        <span className="expires-label"><Clock3 size={13} />{timeRemaining(post.expiresAt)}</span>
        <button className="reply-count-button" type="button" onClick={onOpen}><MessageCircle size={15} /><span>{post.replies.length}</span><span className="reply-text">replies</span></button>
        <button className="post-open-button" type="button" onClick={onOpen} aria-label="Open post thread"><ArrowUpRight size={16} /></button>
      </div>
    </div>
  </article>
}

function CreatePage({ zone, onBack, onPublish, onCustomRequest }: {
  zone: string
  onBack: () => void
  onPublish: (input: { template: TemplateCode; title: string; body: string; extra?: string; locationNote?: string; hours: number; attachmentName?: string; downloadAllowed?: boolean }) => void
  onCustomRequest: (request: Omit<CustomRequest, 'id' | 'submittedAt' | 'status'>) => void
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateCode | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const selected = selectedTemplate ? templateFor(selectedTemplate) : null
  return <div className="create-page">
    <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={15} /> Back to community</button>
    <div className="page-intro create-intro"><div><div className="eyebrow">A LITTLE HELP GOES A LONG WAY</div><h1>{customMode ? 'Request a custom post' : 'What can we help with?'}</h1><p>{customMode ? 'If no template fits, send your idea to the event team for review.' : 'Start with a template. It keeps the right details together and gets your post seen by the right people.'}</p></div></div>
    {customMode ? <CustomPostForm zone={zone} onBack={() => setCustomMode(false)} onSubmit={onCustomRequest} /> : !selected ? <>
      <div className="template-picker-heading"><span>CHOOSE A TEMPLATE</span><span className="template-time-hint"><Clock3 size={13} /> Takes about a minute</span></div>
      <div className="template-grid">
        {templates.map((template) => {
          const Icon = template.icon
          return <button type="button" className="template-card" key={template.code} onClick={() => setSelectedTemplate(template.code)}>
            <span className={`template-card-icon tone-${template.tone}`}><Icon size={19} /></span><span className="template-card-arrow"><ArrowUpRight size={15} /></span><strong>{template.name}</strong><span>{template.description}</span><small>{template.defaultHours >= 24 ? 'Usually active for 24 hours' : `Usually active for ${template.defaultHours} hours`}</small>
          </button>
        })}
      </div>
      <div className="custom-request-strip"><div className="custom-request-icon"><MessageSquare size={17} /></div><div><strong>Something else in mind?</strong><p>Ask the event team to review a custom post before it appears in the feed.</p></div><button className="text-button" type="button" onClick={() => setCustomMode(true)}>Request a custom post <ArrowRight size={15} /></button></div>
      <p className="create-privacy-note"><LockKeyhole size={14} /> Your identity comes from your event profile. Your exact location is never displayed.</p>
    </> : <TemplateForm zone={zone} template={selected} onBack={() => setSelectedTemplate(null)} onPublish={onPublish} />}
  </div>
}

function TemplateForm({ zone, template, onBack, onPublish }: {
  zone: string
  template: (typeof templates)[number]
  onBack: () => void
  onPublish: (input: { template: TemplateCode; title: string; body: string; extra?: string; locationNote?: string; hours: number; attachmentName?: string; downloadAllowed?: boolean }) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [extra, setExtra] = useState('')
  const [locationNote, setLocationNote] = useState('')
  const [hours, setHours] = useState(template.defaultHours)
  const [attachmentName, setAttachmentName] = useState('')
  const [downloadAllowed, setDownloadAllowed] = useState(false)
  const [formError, setFormError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const Icon = template.icon

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (title.trim().length < 4 || body.trim().length < 8) {
      setFormError('Add a clear title and a little more detail before publishing.')
      return
    }
    setFormError('')
    onPublish({ template: template.code, title, body, extra, locationNote: template.code === 'lost_found' ? locationNote : undefined, hours, attachmentName: attachmentName || undefined, downloadAllowed: attachmentName ? downloadAllowed : undefined })
  }

  const changeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!validTypes.includes(file.type)) {
      setFormError('Choose a JPEG, PNG, WebP image, or PDF for this demo.')
      event.target.value = ''
      return
    }
    const limit = file.type === 'application/pdf' ? 20 : 10
    if (file.size > limit * 1024 * 1024) {
      setFormError(`This demo accepts files up to ${limit} MB.`)
      event.target.value = ''
      return
    }
    setAttachmentName(file.name)
    setFormError('')
  }

  return <form className="post-composer" onSubmit={submit}>
    <div className="composer-template-row"><span className={`template-card-icon tone-${template.tone}`}><Icon size={18} /></span><span><strong>{template.name}</strong><small>Post in {zone}</small></span><button type="button" className="change-template-button" onClick={onBack}>Change template</button></div>
    <label className="form-field"><span>Post title <b>Required</b></span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} required autoFocus placeholder={template.code === 'lost_found' ? 'e.g. Found a blue water bottle near Studio B' : 'A short, specific title'} /><small>Keep it clear and easy to scan.</small></label>
    <label className="form-field"><span>{template.code === 'community_question' ? 'Your question' : 'Details'} <b>Required</b></span><textarea value={body} onChange={(event) => setBody(event.target.value)} required maxLength={1200} rows={5} placeholder={template.bodyPlaceholder} /><small>{body.length}/1,200 characters · Please keep private contact details out of public posts.</small></label>
    <label className="form-field"><span>{template.extraLabel} <em>Optional</em></span><input value={extra} onChange={(event) => setExtra(event.target.value)} maxLength={140} placeholder={template.extraPlaceholder} /></label>
    {template.code === 'lost_found' && <label className="form-field"><span>Approximate place <em>Optional</em></span><div className="input-with-icon"><MapPin size={16} /><input value={locationNote} onChange={(event) => setLocationNote(event.target.value)} maxLength={100} placeholder="e.g. North entrance · near Studio B" /></div><small>Use a general landmark, not someone's live location.</small></label>}
    <div className="form-field attachment-field"><span>Add a photo or file <em>Optional</em></span>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={changeFile} />
      {attachmentName ? <div className="file-selected-row"><span className="file-selected-icon"><FileText size={16} /></span><span><strong>{attachmentName}</strong><small>Preview only · this prototype does not upload files</small></span><button type="button" className="remove-file-button" aria-label="Remove attachment" onClick={() => setAttachmentName('')}><X size={16} /></button></div> : <button type="button" className="file-picker-button" onClick={() => fileInput.current?.click()}><span className="file-picker-icon"><Paperclip size={16} /></span><span><strong>Choose a file</strong><small>JPEG, PNG, WebP or PDF · up to 10 MB for images / 20 MB for PDFs</small></span><span className="file-picker-choose">Browse</span></button>}
      {attachmentName && <label className="toggle-row attachment-policy-row"><span><strong>View only (best effort)</strong><small>Hides the usual download action; it cannot prevent screenshots or copying.</small></span><input type="checkbox" checked={!downloadAllowed} onChange={(event) => setDownloadAllowed(!event.target.checked)} /><span className="toggle-visual" /></label>}
    </div>
    <div className="composer-settings-grid">
      <label className="form-field compact-field"><span>Active for</span><div className="select-wrap"><select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
        <option value={1}>1 hour</option><option value={2}>2 hours</option><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option>
      </select><ChevronDown size={15} /></div></label>
      <div className="audience-summary"><span className="audience-lock"><LockKeyhole size={15} /></span><span><strong>Visible to this zone</strong><small>Eligible BuildFest members in {zone}</small></span></div>
    </div>
    <div className="expiry-preview"><Clock3 size={15} /><span>This post will stop appearing as active after <strong>{hours} {hours === 1 ? 'hour' : 'hours'}</strong>. It may remain in your history.</span></div>
    {formError && <p className="form-error" role="alert"><AlertCircle size={15} />{formError}</p>}
    <div className="composer-footer"><button type="button" className="secondary-button" onClick={onBack}>Cancel</button><button type="submit" className="primary-button"><Plus size={16} /> Publish post</button></div>
    <p className="demo-form-notice"><Info size={13} /> Demo mode: this post is saved in this browser only. Server-side checks and real file uploads are not connected.</p>
  </form>
}

function CustomPostForm({ zone, onBack, onSubmit }: { zone: string; onBack: () => void; onSubmit: (request: Omit<CustomRequest, 'id' | 'submittedAt' | 'status'>) => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [intendedAudience, setIntendedAudience] = useState(zone)
  useEffect(() => { if (intendedAudience !== 'Entire event') setIntendedAudience(zone) }, [zone, intendedAudience])
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!acknowledged) { setError('Please confirm that you understand this request is reviewed before publishing.'); return }
    if (title.trim().length < 4 || body.trim().length < 12 || reason.trim().length < 8) { setError('Please complete each field with a little more detail.'); return }
    onSubmit({ title: title.trim(), body: body.trim(), reason: reason.trim(), intendedAudience })
  }
  return <form className="post-composer custom-request-form" onSubmit={submit}>
    <div className="review-notice"><ShieldCheck size={18} /><div><strong>Private until it is approved</strong><p>Your draft will not appear in the community feed while it is under review.</p></div></div>
    <label className="form-field"><span>Proposed title <b>Required</b></span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="What would you like to post?" required /></label>
    <label className="form-field"><span>What would you like to share? <b>Required</b></span><textarea rows={5} maxLength={1200} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Describe the post and who it would help." required /></label>
    <label className="form-field"><span>Why doesn't an existing template fit? <b>Required</b></span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Tell the event team what is missing." required /></label>
    <label className="form-field"><span>Intended audience</span><div className="select-wrap"><select value={intendedAudience} onChange={(event) => setIntendedAudience(event.target.value)}><option value={zone}>This zone · {zone}</option><option value="Entire event">Entire event · requires moderator confirmation</option></select><ChevronDown size={15} /></div><small>The request stays private until approved. A reviewer will confirm the audience before publishing.</small></label>
    <label className="acknowledgement-row"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I understand this request is reviewed before it can be published, and it will be visible only to the submitter and authorized reviewers.</span></label>
    {error && <p className="form-error"><AlertCircle size={15} />{error}</p>}
    <div className="composer-footer"><button type="button" className="secondary-button" onClick={onBack}>Back to templates</button><button type="submit" className="primary-button"><Send size={15} /> Submit for review</button></div>
  </form>
}

function PostDetailModal({ post, onClose, onRespond, onResolve, onReport, onBlock, role }: {
  post: Post | null
  onClose: () => void
  onRespond: (id: string, body: string) => void
  onResolve: (id: string, status?: 'fulfilled' | 'closed') => void
  onReport: (id: string) => void
  onBlock: (author: string) => void
  role: UserRole
}) {
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState('')
  useEffect(() => {
    if (!post) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [post, onClose])
  if (!post) return null
  const active = isActive(post)
  const isOwn = post.author === 'You'
  const meta = templateFor(post.template)
  const Icon = meta.icon
  const sendReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (reply.trim().length < 2) { setReplyError('Write a little more before sending.'); return }
    onRespond(post.id, reply)
    setReply('')
    setReplyError('')
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="post-detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <header className="modal-header"><div className="modal-title-mark"><span className={`post-category-icon tone-${meta.tone}`}><Icon size={16} /></span><span>{meta.name}</span></div><button className="icon-button modal-close-button" type="button" aria-label="Close post" onClick={onClose}><X size={19} /></button></header>
      <div className="post-detail-body">
        <div className="detail-meta-row"><span>{timeAgo(post.createdAt)}</span><span>·</span><span className={`status-badge ${active ? 'status-active' : 'status-inactive'}`}><span />{active ? 'Active' : prettyStatus(post.status === 'published' ? 'expired' : post.status)}</span><span className="detail-expiry"><Clock3 size={13} />{active ? timeRemaining(post.expiresAt) : 'No longer accepting replies'}</span></div>
        <h2 id="detail-title">{post.title}</h2>
        <p className="detail-description">{post.body}</p>
        {post.extra && <div className="detail-info-row"><span className="detail-info-icon"><Info size={15} /></span><span>{post.extra}</span></div>}
        {post.locationNote && <div className="detail-info-row"><span className="detail-info-icon"><MapPin size={15} /></span><span>{post.locationNote} <small>· approximate</small></span></div>}
        {post.attachmentName && <div className="detail-file-card"><span className="file-preview-icon"><FileText size={19} /></span><span><strong>{post.attachmentName}</strong><small>{post.downloadAllowed ? 'Download allowed' : 'View only · best effort'}</small></span><button type="button" className="file-open-demo" onClick={() => window.alert('Protected file preview is not connected in this browser-only demo.')}>{post.downloadAllowed ? <Download size={15} /> : <Eye size={15} />}{post.downloadAllowed ? 'Download' : 'Preview'}</button></div>}
        <div className="detail-author-line"><Avatar initials={post.initials} color={post.avatarColor} size="md" /><span><strong>{post.author}</strong><small>{post.author === 'You' ? 'Your post' : 'BuildFest participant'}</small></span><span className="detail-zone-tag"><MapPin size={12} />{post.visibility === 'event' ? 'Entire event' : post.zone ?? defaultZone}</span></div>
        {!isOwn && <div className="detail-safety-actions"><button type="button" onClick={() => onReport(post.id)}><Flag size={14} /> Report</button><button type="button" onClick={() => { onBlock(post.author); onClose() }}><UserRound size={14} /> Hide author</button></div>}
        <div className="thread-divider"><span>{post.replies.length} {post.replies.length === 1 ? 'reply' : 'replies'}</span><span /></div>
        {post.replies.length ? <div className="reply-list">{post.replies.map((item) => <div className="reply-row" key={item.id}><Avatar initials={item.initials} color={item.mine ? 'green' : 'slate'} size="sm" /><div className="reply-content"><div className="reply-author-line"><strong>{item.author}</strong><span>{timeAgo(item.createdAt)}</span></div><p>{item.body}</p></div></div>)}</div> : <div className="no-replies"><MessageCircle size={16} />Be the first to reply thoughtfully.</div>}
      </div>
      {active ? <form className="reply-composer" onSubmit={sendReply}><Avatar initials={currentUser.initials} color="green" size="sm" /><div className="reply-input-wrap"><input aria-label="Write a reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={500} placeholder="Write a helpful reply…" /><button type="submit" aria-label="Send reply" disabled={!reply.trim()}><Send size={16} /></button></div>{replyError && <span className="reply-error">{replyError}</span>}</form> : <div className="closed-replies-note"><LockKeyhole size={15} />This post is {prettyStatus(post.status === 'published' ? 'expired' : post.status).toLowerCase()} and no longer accepts replies.</div>}
      {isOwn && active && <footer className="post-detail-footer"><button type="button" className="secondary-button" onClick={() => onResolve(post.id, 'closed')}>Close post</button><button type="button" className="primary-button" onClick={() => onResolve(post.id, 'fulfilled')}><Check size={16} /> Mark resolved</button></footer>}
      {role === 'organizer' && active && !isOwn && <footer className="post-detail-footer"><button type="button" className="secondary-button" onClick={() => onResolve(post.id, 'closed')}>Close post</button></footer>}
      <div className="detail-retention-note"><Info size={13} /> Expiry removes a post from active discovery. It does not guarantee immediate deletion of saved copies or backups.</div>
    </section>
  </div>
}

function ReportModal({ post, onClose, onSubmit }: { post: Post | null; onClose: () => void; onSubmit: (reason: string, details: string) => void }) {
  const [reason, setReason] = useState('Spam')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!post) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [post, onClose])
  if (!post) return null
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (reason === 'Other' && details.trim().length < 5) { setError('Add a short note so the moderators understand your report.'); return }
    onSubmit(reason, details)
  }
  return <div className="modal-backdrop report-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submit}>
      <div className="report-modal-icon"><Flag size={19} /></div><button className="icon-button modal-close-button" type="button" aria-label="Close report form" onClick={onClose}><X size={18} /></button>
      <h2 id="report-title">Report this post</h2><p className="report-subtitle">Your report goes to the BuildFest moderation team. Reporting does not automatically remove the post.</p>
      <div className="reported-content-preview"><span>REPORTING</span><strong>{post.title}</strong></div>
      <label className="form-field"><span>What is the issue?</span><div className="select-wrap"><select value={reason} onChange={(event) => setReason(event.target.value)}><option>Spam</option><option>Harassment</option><option>Suspected scam or fraud</option><option>Personal information</option><option>Inappropriate content</option><option>Other</option></select><ChevronDown size={15} /></div></label>
      <label className="form-field"><span>Anything else? <em>Optional</em></span><textarea rows={3} maxLength={500} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Share context that could help the moderators." /></label>
      {error && <p className="form-error"><AlertCircle size={15} />{error}</p>}
      <div className="report-modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="danger-button"><Flag size={15} /> Send report</button></div>
      <p className="report-confidential-note"><LockKeyhole size={13} /> Your identity is only shared with authorized moderators.</p>
    </form>
  </div>
}

function ActivityPage({ posts, requests, conversations, onOpenPost, onCreate, onSettings, onOpenConversations }: { posts: Post[]; requests: CustomRequest[]; conversations: OrganizerConversation[]; onOpenPost: (id: string) => void; onCreate: () => void; onSettings: () => void; onOpenConversations: () => void }) {
  const [tab, setTab] = useState('Active')
  const mine = posts.filter((post) => post.author === 'You')
  const filtered = mine.filter((post) => {
    const status = post.status === 'published' && post.expiresAt <= Date.now() ? 'expired' : post.status
    if (tab === 'Active') return status === 'published'
    if (tab === 'Resolved') return status === 'fulfilled' || status === 'closed'
    if (tab === 'Expired') return status === 'expired'
    return false
  })
  const pendingRequests = requests.filter((request) => ['submitted', 'under_review', 'changes_requested'].includes(request.status))
  const decisions = requests.filter((request) => ['approved', 'rejected'].includes(request.status))
  const requestRows = tab === 'Decisions' ? decisions : pendingRequests
  const isRequestTab = tab === 'Pending review' || tab === 'Decisions'
  const isConversationTab = tab === 'Conversations'
  const tabs = ['Active', 'Resolved', 'Expired', 'Pending review', 'Decisions', 'Conversations']
  return <div className="activity-page">
    <PageHeading eyebrow="YOUR CORNER OF THE EVENT" title="My activity" subtitle="Keep track of your posts, decisions, and private conversations." />
    <div className="activity-summary"><div className="activity-summary-copy"><span className="activity-summary-icon"><Activity size={17} /></span><span><strong>Your activity, at a glance</strong><small>Only you can see your personal history.</small></span></div><span className="activity-summary-count">{mine.filter(isActive).length} active</span></div>
    <div className="activity-tabs" role="tablist" aria-label="Filter your activity">{tabs.map((item) => <button key={item} type="button" className={tab === item ? 'selected' : ''} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>{item}{item === 'Pending review' && pendingRequests.length > 0 && <span className="tab-badge">{pendingRequests.length}</span>}{item === 'Decisions' && decisions.length > 0 && <span className="tab-badge">{decisions.length}</span>}{item === 'Conversations' && conversations.length > 0 && <span className="tab-badge">{conversations.length}</span>}</button>)}</div>
    {isRequestTab ? <div className="activity-record-list">
      {requestRows.length ? requestRows.map((request) => <div className="activity-record" key={request.id}><div className="activity-record-icon custom-record-icon"><MessageSquare size={17} /></div><div className="activity-record-main"><div className="activity-record-top"><span className="record-kind">CUSTOM POST REQUEST</span><StatusChip status={request.status === 'changes_requested' ? 'Changes requested' : request.status === 'submitted' ? 'Submitted' : request.status === 'under_review' ? 'Awaiting review' : request.status === 'approved' ? 'Approved' : 'Rejected'} /></div><h3>{request.title}</h3><p>{request.body}</p><small>Submitted {timeAgo(request.submittedAt)} · Audience: {request.intendedAudience}{tab === 'Pending review' ? ' · Private while under review' : ''}</small>{request.reviewReason && <div className="review-reason"><Info size={14} />{request.reviewReason}</div>}</div></div>) : <EmptyActivity title={tab === 'Pending review' ? 'No requests awaiting review' : 'No decisions yet'} body={tab === 'Pending review' ? 'Your submitted custom post requests will appear here while the event team reviews them.' : 'Approved and rejected custom post decisions will appear here.'} />}
    </div> : isConversationTab ? <div className="activity-record-list">{conversations.length ? [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((conversation) => <button type="button" className="activity-record activity-record-button" key={conversation.id} onClick={onOpenConversations}><div className="activity-record-icon custom-record-icon"><MessageSquare size={17} /></div><div className="activity-record-main"><div className="activity-record-top"><span className="record-kind">PRIVATE ORGANIZER CONVERSATION</span><StatusChip status={conversation.status === 'resolved' ? 'Resolved' : conversation.status === 'awaiting_participant' ? 'Awaiting your reply' : conversation.status === 'open' ? 'Open' : 'Awaiting organizer'} /></div><h3>{conversation.subject}</h3><p>{conversation.messages[conversation.messages.length - 1]?.body}</p><small>{conversation.category} · Updated {timeAgo(conversation.updatedAt)} · Shared with authorized organizers</small></div><ArrowRight className="activity-record-arrow" size={17} /></button>) : <EmptyActivity title="No private conversations yet" body="Messages you send to the event organizers will appear here." action={<button className="secondary-button" type="button" onClick={onOpenConversations}><MessageSquare size={14} /> Talk to organizers</button>} />}</div> : filtered.length ? <div className="activity-record-list">{filtered.map((post) => <button type="button" className="activity-record activity-record-button" key={post.id} onClick={() => onOpenPost(post.id)}><div className={`activity-record-icon tone-${templateFor(post.template).tone}`}>{(() => { const Icon = templateFor(post.template).icon; return <Icon size={17} /> })()}</div><div className="activity-record-main"><div className="activity-record-top"><span className="record-kind">{templateFor(post.template).name.toUpperCase()}</span><StatusChip status={isActive(post) ? 'Active' : prettyStatus(post.status === 'published' ? 'expired' : post.status)} /></div><h3>{post.title}</h3><p>{post.body}</p><small>Updated {timeAgo(post.createdAt)} · {post.replies.length} {post.replies.length === 1 ? 'reply' : 'replies'}</small></div><ArrowRight className="activity-record-arrow" size={17} /></button>)}</div> : <EmptyActivity title={tab === 'Active' ? 'No active posts yet' : `No ${tab.toLowerCase()} posts`} body={tab === 'Active' ? 'Your posts will appear here once you share something with the zone.' : 'Posts will move here as they are resolved or expire.'} action={tab === 'Active' ? <button className="secondary-button" type="button" onClick={onCreate}><Plus size={15} /> Create a post</button> : undefined} />}
    <div className="activity-privacy-callout"><LockKeyhole size={15} /><span>Posts stop appearing in active discovery when they expire. Expiry is not the same as permanent deletion.</span><button type="button" onClick={onSettings}>Learn more</button></div>
  </div>
}

function StatusChip({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll(' ', '-')
  return <span className={`status-chip status-${normalized}`}><span />{status}</span>
}

function EmptyActivity({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state activity-empty"><div className="empty-state-icon"><Activity size={21} /></div><h3>{title}</h3><p>{body}</p>{action}</div>
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return <div className="page-intro generic-page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>
}

function NotificationsPage({ notifications, onMarkAll }: { notifications: NotificationItem[]; onMarkAll: () => void }) {
  const sorted = [...notifications].sort((a, b) => b.createdAt - a.createdAt)
  const iconFor: Record<NotificationItem['kind'], typeof Search> = { reply: MessageCircle, organizer: MessageSquare, status: CheckCircle2, announcement: Megaphone }
  return <div className="notifications-page">
    <PageHeading eyebrow="A LITTLE SOMETHING TO KNOW" title="Notifications" subtitle="Replies, organizer notes, and updates from your event." action={notifications.some((notification) => !notification.read) ? <button className="secondary-button mark-all-button" type="button" onClick={onMarkAll}><Check size={15} /> Mark all as read</button> : undefined} />
    <div className="notifications-card">
      <div className="notifications-card-heading"><div><strong>Recent updates</strong><span>Only notifications for your BuildFest account</span></div><span className="notifications-today">LATEST</span></div>
      {sorted.length ? sorted.map((notification) => {
        const Icon = iconFor[notification.kind]
        return <div className={`notification-row ${!notification.read ? 'unread' : ''}`} key={notification.id}><span className={`notification-icon notification-${notification.kind}`}><Icon size={17} /></span><div className="notification-copy"><strong>{notification.title}</strong><p>{notification.body}</p><small>{timeAgo(notification.createdAt)}</small></div>{!notification.read && <span className="unread-indicator" aria-label="Unread" />}</div>
      }) : <div className="empty-state"><div className="empty-state-icon"><Bell size={21} /></div><h3>You’re all caught up</h3><p>New replies and event updates will show up here.</p></div>}
      <div className="notifications-footnote"><Info size={14} /> “Published” means an update is available in DropZone; it does not mean it was seen on someone’s device.</div>
    </div>
  </div>
}

function OrganizersPage({ conversations, role, onCreate, onSend, onResolve }: {
  conversations: OrganizerConversation[]
  role: UserRole
  onCreate: (input: { subject: string; category: string; body: string }) => string
  onSend: (id: string, body: string) => void
  onResolve: (id: string) => void
}) {
  const [selectedId, setSelectedId] = useState(conversations[0]?.id ?? '')
  const [showNew, setShowNew] = useState(false)
  const conversation = conversations.find((item) => item.id === selectedId) ?? conversations[0]
  useEffect(() => {
    if (!conversations.some((item) => item.id === selectedId)) setSelectedId(conversations[0]?.id ?? '')
  }, [conversations, selectedId])

  const makeNew = (input: { subject: string; category: string; body: string }) => {
    const id = onCreate(input)
    setSelectedId(id)
    setShowNew(false)
  }
  return <div className="organizers-page">
    <PageHeading eyebrow={role === 'organizer' ? 'EVENT OPERATIONS' : 'PRIVATE EVENT SUPPORT'} title={role === 'organizer' ? 'Organizer inbox' : 'Talk to organizers'} subtitle={role === 'organizer' ? 'Private conversations shared with authorized event organizers.' : 'A private line to the people keeping the event running.'} action={role === 'participant' ? <button className="primary-button" type="button" onClick={() => setShowNew(true)}><Plus size={16} /> New message</button> : undefined} />
    {role === 'participant' && <div className="private-inbox-notice"><span className="inbox-notice-icon"><LockKeyhole size={17} /></span><span><strong>A private, shared inbox</strong><small>Authorized members of the BuildFest organizer group can access messages here. They never appear in the public feed.</small></span><Info size={15} /></div>}
    <div className="inbox-layout">
      <aside className="conversation-list-panel">
        <div className="conversation-list-heading"><strong>{role === 'organizer' ? 'Inbox' : 'Your conversations'}</strong><span>{conversations.length}</span></div>
        {role === 'organizer' && <div className="inbox-filter-chips"><button className="selected">All</button><button>New</button><button>Assigned</button></div>}
        {conversations.map((item) => <button type="button" key={item.id} className={`conversation-list-item ${conversation?.id === item.id && !showNew ? 'selected' : ''}`} onClick={() => { setSelectedId(item.id); setShowNew(false) }}><span className="conversation-avatar"><MessageSquare size={16} /></span><span className="conversation-list-copy"><strong>{item.subject}</strong><small>{item.messages[item.messages.length - 1]?.body}</small><span className="conversation-list-meta">{item.category} · {timeAgo(item.updatedAt)}</span></span>{item.status !== 'resolved' && <span className="conversation-unread-dot" />}</button>)}
        {!conversations.length && <div className="conversation-list-empty">No conversations yet.</div>}
      </aside>
      <section className="conversation-thread-panel">
        {showNew ? <NewConversationForm onCancel={() => setShowNew(false)} onSubmit={makeNew} /> : conversation ? <ConversationThread conversation={conversation} role={role} onSend={(body) => onSend(conversation.id, body)} onResolve={() => onResolve(conversation.id)} /> : <div className="thread-empty"><MessageSquare size={24} /><h3>Start a private conversation</h3><p>Ask the event organizers about schedules, access, or something you need help with.</p><button className="secondary-button" onClick={() => setShowNew(true)}><Plus size={15} /> New message</button></div>}
      </section>
    </div>
    <p className="conversation-safety-note"><ShieldCheck size={14} /> Production access should be event-scoped and audited. Sample conversations in this preview stay in this browser.</p>
  </div>
}

function NewConversationForm({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (input: { subject: string; category: string; body: string }) => void }) {
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('Event question')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (subject.trim().length < 4 || body.trim().length < 8) { setError('Add a subject and a little detail so the organizers can help.'); return }
    onSubmit({ subject: subject.trim(), category, body: body.trim() })
  }
  return <form className="new-conversation-form" onSubmit={submit}><div className="thread-header"><div className="thread-header-icon"><MessageSquare size={17} /></div><div><strong>New organizer message</strong><small>Private · shared with authorized organizers</small></div><button className="icon-button" type="button" aria-label="Cancel new message" onClick={onCancel}><X size={18} /></button></div><div className="new-conversation-fields"><label className="form-field"><span>Topic</span><div className="select-wrap"><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Event question</option><option>Accessibility</option><option>Safety concern</option><option>Lost item</option><option>Other</option></select><ChevronDown size={15} /></div></label><label className="form-field"><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What do you need help with?" required /></label><label className="form-field"><span>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="Share the details the organizers need to help you." required /></label><div className="shared-inbox-inline"><LockKeyhole size={15} /><span>Authorized members of the organizer group may read and reply to this conversation.</span></div>{error && <p className="form-error"><AlertCircle size={14} />{error}</p>}<div className="composer-footer"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button"><Send size={15} /> Send privately</button></div></div></form>
}

function ConversationThread({ conversation, role, onSend, onResolve }: { conversation: OrganizerConversation; role: UserRole; onSend: (body: string) => void; onResolve: () => void }) {
  const [body, setBody] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'nearest' }), [conversation.messages.length])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!body.trim()) return
    onSend(body.trim())
    setBody('')
  }
  const resolved = conversation.status === 'resolved'
  return <>
    <div className="thread-header"><div className="thread-header-icon"><MessageSquare size={17} /></div><div><strong>{conversation.subject}</strong><small>{conversation.category} · {conversation.status.replaceAll('_', ' ')}</small></div>{role === 'organizer' && !resolved && <button className="thread-resolve-button" type="button" onClick={onResolve}><Check size={14} /> Resolve</button>}</div>
    <div className="thread-message-list">{conversation.messages.map((message) => <div className={`thread-message ${message.mine ? 'mine' : ''}`} key={message.id}><div className="thread-message-author">{message.mine ? <Avatar initials={currentUser.initials} color="green" size="sm" /> : <span className="organizer-avatar"><ShieldCheck size={14} /></span>}<strong>{message.author}</strong><small>{timeAgo(message.createdAt)}</small></div><p>{message.body}</p></div>)}<div ref={bottomRef} /></div>
    {resolved ? <div className="resolved-thread-note"><CheckCircle2 size={16} />This conversation is resolved. Start a new message if you need more help.</div> : <form className="thread-reply-form" onSubmit={submit}><textarea aria-label="Write a private message" rows={2} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a private message…" /><div className="thread-reply-footer"><span><LockKeyhole size={13} />Private conversation</span><button type="submit" className="primary-button" disabled={!body.trim()}><Send size={15} /> Send</button></div></form>}
  </>
}

function OverviewPage({ posts, reports, customRequests, onNavigate }: { posts: Post[]; reports: ReportCase[]; customRequests: CustomRequest[]; onNavigate: (page: PageKey) => void }) {
  const active = posts.filter(isActive).length
  const openReports = reports.filter((report) => report.status === 'new' || report.status === 'under_review').length
  const pending = customRequests.filter((request) => ['submitted', 'under_review', 'changes_requested'].includes(request.status)).length
  return <div className="overview-page">
    <PageHeading eyebrow="BUILDFEST 2026 · EVENT OPERATIONS" title="Good morning, team." subtitle="A quick read on what needs attention across your event." action={<span className="organizer-preview-pill"><ShieldCheck size={14} /> Organizer preview</span>} />
    <div className="event-live-banner"><span className="event-live-banner-icon"><CalendarDays size={19} /></span><span><strong>BuildFest 2026 is live</strong><small>Saturday, October 10 · Northstar Innovation Campus</small></span><span className="event-live-pill"><i /> LIVE</span><button type="button" onClick={() => onNavigate('zones')}>Manage event <ArrowUpRight size={15} /></button></div>
    <div className="metric-grid">
      <MetricCard icon={MessageCircle} label="Active requests" value={String(active).padStart(2, '0')} detail="Across your event zones" accent="green" action={() => onNavigate('community')} />
      <MetricCard icon={Flag} label="Open reports" value={String(openReports).padStart(2, '0')} detail={openReports ? 'Needs moderator review' : 'All clear'} accent="coral" action={() => onNavigate('moderation')} urgent={openReports > 0} />
      <MetricCard icon={FileText} label="Custom post reviews" value={String(pending).padStart(2, '0')} detail="Awaiting a decision" accent="violet" action={() => onNavigate('moderation')} />
      <MetricCard icon={Users} label="Participants & teams" value="1,248" detail="186 registered teams" accent="blue" action={() => onNavigate('participants')} />
    </div>
    <div className="overview-lower-grid">
      <section className="overview-panel attention-panel"><div className="overview-panel-heading"><div><span className="panel-kicker">TAKE A LOOK</span><h2>Needs your attention</h2></div><button type="button" className="text-button" onClick={() => onNavigate('moderation')}>Open moderation <ArrowRight size={14} /></button></div>
        {openReports ? <div className="attention-row"><span className="attention-mark report-mark"><Flag size={16} /></span><span><strong>{openReports} new report{openReports === 1 ? '' : 's'}</strong><small>Personal information · Innovation Hall · {timeAgo(reports.find((item) => item.status === 'new')?.reportedAt ?? Date.now())}</small></span><button type="button" aria-label="Review reports" onClick={() => onNavigate('moderation')}><ArrowUpRight size={16} /></button></div> : <div className="all-clear-row"><CheckCircle2 size={17} /> Nothing needs your attention right now.</div>}
        {pending > 0 && <div className="attention-row"><span className="attention-mark review-mark"><FileText size={16} /></span><span><strong>{pending} custom post{pending === 1 ? '' : 's'} to review</strong><small>Private submissions · Separate from reports</small></span><button type="button" aria-label="Review custom post requests" onClick={() => onNavigate('moderation')}><ArrowUpRight size={16} /></button></div>}
      </section>
      <section className="overview-panel zones-overview-panel"><div className="overview-panel-heading"><div><span className="panel-kicker">YOUR EVENT FOOTPRINT</span><h2>Zones</h2></div><button type="button" className="icon-button" aria-label="Open zones" onClick={() => onNavigate('zones')}><ArrowUpRight size={16} /></button></div><div className="mini-zone-map"><div className="mini-map-road road-a" /><div className="mini-map-road road-b" /><div className="mini-map-building building-a" /><div className="mini-map-building building-b" /><div className="mini-map-zone-circle" /><span className="mini-map-label">Innovation Hall</span><span className="mini-map-pin"><MapPin size={14} /></span><span className="mini-map-map-label">ILLUSTRATIVE · DEMO</span></div><div className="zone-overview-footer"><span><span className="small-live-dot" /> 2 active zones</span><button type="button" onClick={() => onNavigate('zones')}>Manage zones <ArrowRight size={14} /></button></div></section>
    </div>
    <div className="organizer-bottom-row"><span><Info size={14} /> Production organizer actions should be event-scoped and audited; this preview stores decisions locally.</span><button type="button" onClick={() => onNavigate('communications')}><Send size={14} /> Send an update</button></div>
  </div>
}

function MetricCard({ icon: Icon, label, value, detail, accent, action, urgent = false }: { icon: typeof Search; label: string; value: string; detail: string; accent: string; action: () => void; urgent?: boolean }) {
  return <button type="button" className={`metric-card metric-${accent}`} onClick={action}><span className="metric-topline"><span className="metric-icon"><Icon size={17} /></span>{urgent && <span className="metric-alert-dot" />}</span><span className="metric-value">{value}</span><span className="metric-label">{label}</span><span className="metric-detail">{detail}<ArrowUpRight size={13} /></span></button>
}

function ZonesPage({ zone, setZone, onToast }: { zone: string; setZone: (zone: string) => void; onToast: (message: string) => void }) {
  const [shape, setShape] = useState<'radius' | 'polygon'>('radius')
  const [radius, setRadius] = useState(250)
  const [center, setCenter] = useState({ x: 53, y: 49 })
  const [points, setPoints] = useState([{ x: 28, y: 38 }, { x: 53, y: 32 }, { x: 69, y: 48 }, { x: 61, y: 69 }, { x: 37, y: 67 }])
  const [drawing, setDrawing] = useState(false)
  const [saved, setSaved] = useState(true)
  const handleMapClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(4, Math.min(96, ((event.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(6, Math.min(94, ((event.clientY - rect.top) / rect.height) * 100))
    if (shape === 'radius') {
      setCenter({ x, y })
      setSaved(false)
    } else if (drawing) {
      setPoints((current) => [...current, { x, y }])
      setSaved(false)
    }
  }
  const save = () => {
    if (!zone.trim()) { onToast('Add a name for this zone before saving.'); return }
    if (shape === 'polygon' && drawing) { onToast('Finish drawing the area before saving this zone.'); return }
    if (shape === 'polygon') {
      const validationError = polygonValidationError(points)
      if (validationError) { onToast(validationError); return }
    }
    setSaved(true)
    onToast('Zone settings saved in this browser demo.')
  }
  return <div className="zones-page">
    <PageHeading eyebrow="BUILDFEST 2026 · EVENT SETUP" title="Zones" subtitle="Shape the places where your community comes together." action={<span className="organizer-preview-pill"><ShieldCheck size={14} /> Organizer preview</span>} />
    <div className="zone-editor-card">
      <div className="zone-editor-heading"><div><span className="panel-kicker">ZONE EDITOR</span><h2>Set a clear boundary</h2><p>Use a radius for a venue or draw an area around a campus space.</p></div><StatusChip status={saved ? 'Saved' : 'Unsaved changes'} /></div>
      <div className="zone-editor-content">
        <div className="zone-editor-controls">
          <label className="form-field"><span>Zone name</span><input value={zone} onChange={(event) => { setZone(event.target.value); setSaved(false) }} maxLength={60} /></label>
          <div className="form-field"><span>Boundary shape</span><div className="shape-toggle"><button type="button" className={shape === 'radius' ? 'selected' : ''} onClick={() => { setShape('radius'); setDrawing(false); setSaved(false) }}><span className="shape-circle-icon" />Radius</button><button type="button" className={shape === 'polygon' ? 'selected' : ''} onClick={() => { setShape('polygon'); setDrawing(false); setSaved(false) }}><span className="shape-poly-icon" />Draw area</button></div></div>
          {shape === 'radius' ? <label className="form-field"><span>Radius <small>METERS</small></span><div className="select-wrap"><select value={radius} onChange={(event) => { setRadius(Number(event.target.value)); setSaved(false) }}><option value={100}>100 m</option><option value={250}>250 m</option><option value={400}>400 m</option><option value={500}>500 m</option><option value={1000}>1 km</option></select><ChevronDown size={15} /></div></label> : <div className="polygon-controls"><span className="polygon-help"><MapPin size={15} />{drawing ? 'Tap the map to place boundary points.' : `${points.length} boundary points`}</span><div><button className="secondary-button small-button" type="button" onClick={() => { setPoints((current) => current.slice(0, -1)); setSaved(false) }} disabled={points.length === 0}>Undo point</button><button className={`secondary-button small-button ${drawing ? 'is-drawing' : ''}`} type="button" onClick={() => { setDrawing((value) => !value); if (!drawing) setPoints([]); setSaved(false) }}>{drawing ? 'Finish area' : 'Redraw'}</button></div></div>}
          <div className="zone-center-summary"><span><MapPin size={15} /></span><div><strong>{shape === 'radius' ? 'Approximate center' : 'Boundary summary'}</strong><small>{shape === 'radius' ? 'Northstar Innovation Campus' : `${points.length} vertices · boundary points count as inside`}</small></div></div>
          <div className="zone-editor-note"><Info size={14} /><p>GPS is an estimate, not proof of identity. This map is an illustrative demo, not a live map or geofence service.</p></div>
          <div className="zone-editor-actions"><button type="button" className="secondary-button" onClick={() => onToast('No changes were discarded in this local demo.')}>Cancel</button><button type="button" className="primary-button" onClick={save}><Check size={15} /> Save zone</button></div>
        </div>
        <div className={`map-preview-wrap ${drawing ? 'map-drawing' : ''}`}><CampusMap shape={shape} radius={radius} center={center} points={points} onClick={handleMapClick} /><div className="map-disclaimer"><MapIcon size={13} />Illustrative campus plan · not to scale</div>{shape === 'polygon' && drawing && <div className="map-draw-hint">Tap to add point</div>}</div>
      </div>
    </div>
    <div className="zone-list-card"><div><span className="panel-kicker">ACTIVE ZONES</span><h2>Zones in this event</h2></div><div className="zone-list-row"><span className="zone-list-pin"><MapPin size={16} /></span><span><strong>{zone}</strong><small>{shape === 'radius' ? `${radius} m radius` : `Polygon · ${points.length} points`} · Demo boundary</small></span><StatusChip status="Active" /><button className="text-button" type="button" onClick={() => onToast('You are editing the current demo zone.')}>Edit <ArrowUpRight size={14} /></button></div><div className="zone-list-row"><span className="zone-list-pin secondary-pin"><MapPin size={16} /></span><span><strong>Maker Courtyard</strong><small>400 m radius · Demo boundary</small></span><StatusChip status="Active" /><button className="text-button" type="button" onClick={() => { setZone('Maker Courtyard'); onToast('Maker Courtyard selected for this demo.') }}>Edit <ArrowUpRight size={14} /></button></div></div>
  </div>
}

function CampusMap({ shape, radius, center, points, onClick }: { shape: 'radius' | 'polygon'; radius: number; center: { x: number; y: number }; points: { x: number; y: number }[]; onClick: (event: MouseEvent<SVGSVGElement>) => void }) {
  const polygonPoints = points.map((point) => `${point.x * 6.4},${point.y * 4.3}`).join(' ')
  const radiusValue = Math.max(38, Math.min(184, radius / 1000 * 184))
  return <svg className="campus-map-svg" viewBox="0 0 640 430" role="img" aria-label="Illustrative campus map showing the selected demo zone" onClick={onClick}>
    <rect width="640" height="430" fill="#eaf0e7" />
    <path d="M-30 114 C104 155 178 115 294 145 S477 212 672 178" fill="none" stroke="#f9faf7" strokeWidth="44" />
    <path d="M-30 114 C104 155 178 115 294 145 S477 212 672 178" fill="none" stroke="#d8ded5" strokeWidth="2" strokeDasharray="6 8" />
    <path d="M75 -20 C106 83 122 168 165 236 S219 359 202 455" fill="none" stroke="#f8f9f6" strokeWidth="31" />
    <path d="M75 -20 C106 83 122 168 165 236 S219 359 202 455" fill="none" stroke="#d9dfd5" strokeWidth="1.5" strokeDasharray="5 8" />
    <path d="M487 -20 C450 88 470 174 455 248 S455 360 526 455" fill="none" stroke="#fbfcf9" strokeWidth="27" />
    <path d="M487 -20 C450 88 470 174 455 248 S455 360 526 455" fill="none" stroke="#d9dfd5" strokeWidth="1.5" strokeDasharray="5 8" />
    <path d="M-20 324 C127 300 272 339 364 325 S527 276 664 302" fill="none" stroke="#fafbf8" strokeWidth="24" />
    <path d="M-20 324 C127 300 272 339 364 325 S527 276 664 302" fill="none" stroke="#d9dfd5" strokeWidth="1.5" strokeDasharray="5 8" />
    <rect x="231" y="44" width="127" height="68" rx="12" fill="#d7e4d1" />
    <rect x="374" y="47" width="78" height="67" rx="11" fill="#d8e4d1" />
    <rect x="278" y="235" width="116" height="80" rx="13" fill="#d7e4d1" />
    <rect x="499" y="218" width="78" height="91" rx="12" fill="#dce8d5" />
    <rect x="36" y="252" width="93" height="62" rx="12" fill="#dce8d5" />
    <rect x="280" y="48" width="52" height="58" rx="7" fill="#eef0e7" />
    <rect x="388" y="61" width="51" height="42" rx="6" fill="#eff1e8" />
    <rect x="296" y="250" width="78" height="47" rx="7" fill="#eff1e8" />
    <rect x="515" y="233" width="49" height="59" rx="7" fill="#eff1e8" />
    <rect x="51" y="265" width="61" height="35" rx="6" fill="#eef1e7" />
    <path d="M26 59 C68 26 110 39 133 72 C151 98 127 123 96 125 C56 129 20 99 26 59Z" fill="#bdd6bb" opacity=".9" />
    <path d="M547 350 C582 326 619 342 624 372 C628 396 601 411 573 405 C545 399 530 373 547 350Z" fill="#bdd6bb" opacity=".9" />
    <text x="242" y="39" className="map-building-label">CEDAR WING</text>
    <text x="288" y="229" className="map-building-label">INNOVATION HALL</text>
    <text x="502" y="213" className="map-building-label">STUDIO B</text>
    <text x="41" y="247" className="map-building-label">LIBRARY</text>
    <text x="78" y="90" className="map-place-label">NORTH GARDEN</text>
    <text x="543" y="385" className="map-place-label">COURTYARD</text>
    {shape === 'radius' ? <g><circle cx={center.x * 6.4} cy={center.y * 4.3} r={radiusValue} fill="rgba(51, 126, 91, .13)" stroke="#28744e" strokeWidth="2.5" strokeDasharray="7 5" /><circle cx={center.x * 6.4} cy={center.y * 4.3} r="7" fill="#28744e" stroke="white" strokeWidth="3" /></g> : <g>{points.length >= 3 && <polygon points={polygonPoints} fill="rgba(51, 126, 91, .13)" stroke="#28744e" strokeWidth="2.5" strokeDasharray="7 5" />}{points.map((point, index) => <g key={`${point.x}-${point.y}`}><circle cx={point.x * 6.4} cy={point.y * 4.3} r="7" fill="#28744e" stroke="#fff" strokeWidth="3" /><text x={point.x * 6.4 + 10} y={point.y * 4.3 - 11} className="map-vertex-label">{index + 1}</text></g>)}</g>}
    <g transform={`translate(${center.x * 6.4 - 10} ${center.y * 4.3 - 34})`}><path d="M10 0C4.477 0 0 4.477 0 10c0 7.5 10 19 10 19s10-11.5 10-19C20 4.477 15.523 0 10 0z" fill="#174f38" stroke="white" strokeWidth="2" /><circle cx="10" cy="10" r="3" fill="white" /></g>
  </svg>
}

function ParticipantsPage({ onToast }: { onToast: (message: string) => void }) {
  const [rows, setRows] = useState<{ name: string; email: string; team: string; registration: string; issues: string[] }[]>([])
  const [importName, setImportName] = useState('')
  const [error, setError] = useState('')
  const [committed, setCommitted] = useState<{ added: number; rejected: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const validRows = rows.filter((row) => row.issues.length === 0)
  const issueCount = rows.length - validRows.length

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError('')
    setCommitted(null)
    setImportName(file.name)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Roster files must be 10 MB or smaller.')
      const buffer = await file.arrayBuffer()
      const XLSX = await import('@e965/xlsx')
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      if (!data.length) throw new Error('No participant rows were found in the first worksheet.')
      const normalize = (value: string) => value.toLowerCase().trim().replace(/[\s-]+/g, '_')
      const keyMap = new Map(Object.keys(data[0]).map((key) => [normalize(key), key]))
      const findKey = (...candidates: string[]) => candidates.map(normalize).map((key) => keyMap.get(key)).find(Boolean)
      const nameKey = findKey('name', 'participant_name', 'full_name')
      const emailKey = findKey('email', 'email_address', 'participant_email')
      const teamKey = findKey('team', 'team_name', 'team_code')
      const registrationKey = findKey('registration_id', 'registration_ref', 'registration', 'id')
      if (!nameKey || !emailKey || !teamKey) throw new Error('Required headers: participant name, email, and team. A registration ID is recommended.')
      const seenEmail = new Map<string, string>()
      const seenRegistration = new Set<string>()
      const parsed = data.map((row) => {
        const name = String(row[nameKey] ?? '').trim()
        const email = String(row[emailKey] ?? '').trim().toLowerCase()
        const team = String(row[teamKey] ?? '').trim()
        const registration = registrationKey ? String(row[registrationKey] ?? '').trim() : ''
        const issues: string[] = []
        if (!name) issues.push('Missing name')
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push('Invalid email')
        if (!team) issues.push('Missing team')
        if (email && seenEmail.has(email)) issues.push(seenEmail.get(email) === team ? 'Duplicate account' : 'Conflicting team assignment')
        else if (email) seenEmail.set(email, team)
        if (registration && seenRegistration.has(registration)) issues.push('Duplicate registration ID')
        if (registration) seenRegistration.add(registration)
        return { name, email, team, registration, issues }
      })
      setRows(parsed)
    } catch (caught) {
      setRows([])
      setError(caught instanceof Error ? caught.message : 'The roster could not be read. Try a CSV or XLSX file.')
    } finally {
      setLoading(false)
      event.target.value = ''
    }
  }

  const downloadErrorReport = () => {
    const invalid = rows.filter((row) => row.issues.length)
    const content = ['name,email,team,registration_id,errors', ...invalid.map((row) => [row.name, row.email, row.team, row.registration, row.issues.join('; ')].map((value) => `"${value.replaceAll('"', '""')}"`).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'dropzone-roster-errors.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const commitImport = () => {
    if (!validRows.length) return
    setCommitted({ added: validRows.length, rejected: issueCount })
    onToast(`${validRows.length} roster rows added in this browser demo.`)
  }

  return <div className="participants-page">
    <PageHeading eyebrow="BUILDFEST 2026 · ROSTER" title="Participants & teams" subtitle="Import the event roster, review every row, then confirm the changes." action={<button className="secondary-button" type="button" onClick={() => { const csv = 'registration_id,name,email,team\nBF-1001,Alex Morgan,alex@example.com,Team Aurora\nBF-1002,Jamie Chen,jamie@example.com,Green Circuit'; const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = 'buildfest-roster-template.csv'; link.click(); URL.revokeObjectURL(url) }}><Download size={15} /> Sample template</button>} />
    <div className="roster-metrics"><div><span>PARTICIPANTS</span><strong>1,248</strong><small>Active event memberships</small></div><div><span>REGISTERED TEAMS</span><strong>186</strong><small>Across 2 event tracks</small></div><div><span>IMPORT STATUS</span><strong>{committed ? 'Updated' : 'Ready'}</strong><small>{committed ? `${committed.added} added · ${committed.rejected} rejected` : 'No import in progress'}</small></div></div>
    {committed && <div className="import-success-banner"><CheckCircle2 size={17} /><span><strong>Import complete.</strong> {committed.added} rows added, {committed.rejected} rows rejected. This update is local to the demo.</span><button type="button" onClick={() => { setCommitted(null); setRows([]); setImportName('') }}><X size={15} /></button></div>}
    <section className="roster-import-card"><div className="roster-card-heading"><div><span className="panel-kicker">ROSTER IMPORT</span><h2>Upload a participant list</h2><p>CSV or XLSX · required columns: name, email, team · registration ID helps prevent duplicates</p></div><span className="private-file-pill"><LockKeyhole size={13} /> Processed locally</span></div>
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={importFile} />
      <button className={`roster-upload-zone ${rows.length ? 'has-file' : ''}`} type="button" onClick={() => inputRef.current?.click()} disabled={loading}><span className="roster-upload-icon">{loading ? <Activity size={20} className="spin-icon" /> : importName.toLowerCase().endsWith('csv') ? <FileSpreadsheet size={20} /> : <Upload size={20} />}</span><strong>{loading ? 'Reading your roster…' : importName || 'Choose a roster file'}</strong><small>{loading ? 'Validating columns and duplicates' : 'Drag and drop is not enabled in this demo · files are not uploaded to a server'}</small><span className="browse-file-button">{loading ? 'Please wait' : 'Browse files'}</span></button>
      {error && <p className="form-error"><AlertCircle size={15} />{error}</p>}
      {rows.length > 0 && <><div className="import-validation-summary"><div><span className="validation-good"><CheckCircle2 size={15} />{validRows.length} ready</span><span className={issueCount ? 'validation-bad' : 'validation-good'}>{issueCount ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}{issueCount} need attention</span></div><span>{rows.length} rows · {importName}</span></div><div className="roster-table-wrap"><table className="roster-table"><thead><tr><th>PARTICIPANT</th><th>EMAIL</th><th>TEAM</th><th>VALIDATION</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.email}-${index}`} className={row.issues.length ? 'row-invalid' : ''}><td>{row.name || '—'}</td><td>{row.email || '—'}</td><td>{row.team || '—'}</td><td>{row.issues.length ? <span className="row-issue">{row.issues.join(' · ')}</span> : <span className="row-valid"><Check size={13} />Ready</span>}</td></tr>)}</tbody></table></div><div className="roster-import-actions">{issueCount > 0 && <button className="text-button" type="button" onClick={downloadErrorReport}><Download size={14} /> Download error report</button>}<button className="primary-button" type="button" onClick={commitImport} disabled={!validRows.length}><Check size={15} /> Confirm import ({validRows.length})</button></div><p className="demo-form-notice"><Info size={13} /> The source file is read in your browser and is not retained. A production import must commit transactionally on the server.</p></>}
    </section>
    <section className="team-preview-card"><div className="overview-panel-heading"><div><span className="panel-kicker">TEAM ROSTER</span><h2>Recently active teams</h2></div><button className="text-button" type="button" onClick={() => onToast('Team roster is a read-only sample in this demo.')}>View all 186 <ArrowRight size={14} /></button></div><div className="team-preview-grid">{demoTeams.map((team, index) => <div className="team-preview-item" key={team.name}><span className={`team-monogram team-monogram-${index}`}>{team.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{team.name}</strong><small>{team.count} members · active</small></span><ArrowUpRight size={14} /></div>)}</div></section>
  </div>
}

function CommunicationsPage({ onToast }: { onToast: (message: string) => void }) {
  const [audience, setAudience] = useState<'individual' | 'one_team' | 'selected_teams' | 'all'>('one_team')
  const [selectedTeams, setSelectedTeams] = useState<string[]>(['Team Aurora'])
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [sent, setSent] = useState(false)
  const [individual, setIndividual] = useState('')
  const teamCount = selectedTeams.reduce((sum, teamName) => sum + (demoTeams.find((team) => team.name === teamName)?.count ?? 0), 0)
  const recipientCount = audience === 'all' ? 1248 : audience === 'individual' ? 1 : audience === 'one_team' ? (demoTeams.find((team) => team.name === selectedTeams[0])?.count ?? 6) : teamCount
  const toggleTeam = (team: string) => setSelectedTeams((current) => current.includes(team) ? current.filter((name) => name !== team) : [...current, team])
  const send = () => {
    setSent(true)
    setConfirm(false)
    onToast(`Message published to ${recipientCount} intended recipient${recipientCount === 1 ? '' : 's'} in this demo.`)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!subject.trim() || !message.trim()) return
    if (audience === 'all' || audience === 'selected_teams') setConfirm(true)
    else send()
  }
  return <div className="communications-page">
    <PageHeading eyebrow="BUILDFEST 2026 · DIRECT COMMUNICATION" title="Say it to the right people." subtitle="Send a private update to a participant, a team, or your event community." action={<span className="organizer-preview-pill"><ShieldCheck size={14} /> Organizer preview</span>} />
    {sent ? <div className="communication-sent-card"><span className="sent-check-icon"><CheckCircle2 size={22} /></span><span className="panel-kicker">PUBLISHED IN THIS DEMO</span><h2>{subject}</h2><p>{message}</p><div className="sent-recipient-summary"><Users size={15} /> {recipientCount} intended recipient{recipientCount === 1 ? '' : 's'} · {audienceLabel(audience, selectedTeams, individual)}</div><div className="sent-demo-note"><Info size={14} /> No messages were delivered to real participants. Delivery is not connected in this prototype.</div><button type="button" className="secondary-button" onClick={() => { setSent(false); setSubject(''); setMessage('') }}>Compose another</button></div> : <form className="communication-composer-card" onSubmit={submit}>
      <div className="composer-card-heading"><div><span className="panel-kicker">NEW EVENT MESSAGE</span><h2>Choose an audience</h2><p>Your audience is expanded from the event roster on the server in production.</p></div><span className="secure-send-label"><LockKeyhole size={13} />Private delivery</span></div>
      <div className="audience-choice-grid">
        {([
          ['individual', 'One participant', 'A private message to one person', UserRound],
          ['one_team', 'One team', 'Reach verified team members', Users],
          ['selected_teams', 'Selected teams', 'Choose several registered teams', CheckCircle2],
          ['all', 'All eligible', 'Everyone in the event', Megaphone],
        ] as const).map(([value, label, description, Icon]) => <button type="button" key={value} className={`audience-choice ${audience === value ? 'selected' : ''}`} onClick={() => { setAudience(value); setConfirm(false) }}><span className="audience-choice-icon"><Icon size={17} /></span><span><strong>{label}</strong><small>{description}</small></span><span className="radio-indicator" /></button>)}
      </div>
      {audience === 'individual' && <label className="form-field audience-detail-field"><span>Participant</span><input value={individual} onChange={(event) => setIndividual(event.target.value)} placeholder="Search by registered name or ID" required /></label>}
      {(audience === 'one_team' || audience === 'selected_teams') && <div className="form-field audience-detail-field"><span>{audience === 'one_team' ? 'Choose a team' : 'Choose teams'}</span><div className="team-checkbox-list">{demoTeams.map((team) => <label key={team.name} className={`team-checkbox-row ${selectedTeams.includes(team.name) ? 'checked' : ''}`}><input type={audience === 'one_team' ? 'radio' : 'checkbox'} name="team" checked={selectedTeams.includes(team.name)} onChange={() => audience === 'one_team' ? setSelectedTeams([team.name]) : toggleTeam(team.name)} /><span className="team-checkbox-mark"><Check size={12} /></span><span><strong>{team.name}</strong><small>{team.count} registered members</small></span></label>)}</div></div>}
      <div className="recipient-count-card"><span className="recipient-count-icon"><Users size={16} /></span><span><strong>{recipientCount.toLocaleString()} intended recipient{recipientCount === 1 ? '' : 's'}</strong><small>{audienceLabel(audience, selectedTeams, individual)} · Demo roster estimate</small></span><Info size={15} /></div>
      <div className="form-field"><span>Message title</span><input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={100} placeholder="e.g. Mentor check-in starts at 2 pm" required /></div>
      <div className="form-field"><span>Message</span><textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1800} placeholder="Write a clear update. Include only what this audience needs to know." required /></div>
      {audience === 'all' && <div className="broad-audience-warning"><AlertCircle size={15} /><span>This message reaches all eligible BuildFest participants. Review your audience and message before publishing.</span></div>}
      {confirm && <div className="broadcast-confirm"><div><strong>Confirm broad message?</strong><small>This will publish to {recipientCount.toLocaleString()} intended recipients. Unrelated teams will not receive team-targeted messages.</small></div><button type="button" className="secondary-button" onClick={() => setConfirm(false)}>Go back</button><button type="button" className="primary-button" onClick={send}><Send size={14} /> Confirm send</button></div>}
      <div className="communication-actions"><span><ShieldCheck size={14} /> Audience and role checks are server-side in production.</span><button type="submit" className="primary-button" disabled={!subject.trim() || !message.trim() || ((audience === 'one_team' || audience === 'selected_teams') && selectedTeams.length === 0) || (audience === 'individual' && !individual.trim())}><Send size={15} /> {confirm ? 'Review message' : 'Publish message'}</button></div>
      <p className="demo-form-notice"><Info size={13} /> Demo preview only: messages are not delivered. No “read” or “delivered to device” status is claimed.</p>
    </form>}
    <div className="communication-policy-note"><LockKeyhole size={15} /><div><strong>Targeted means targeted.</strong><p>Team messages are private to current members of the selected team and authorized organizers. Recipients are resolved from the verified event roster, never from a browser-supplied list.</p></div></div>
  </div>
}

function audienceLabel(audience: string, selectedTeams: string[], individual: string) {
  if (audience === 'individual') return individual || 'One participant'
  if (audience === 'one_team') return selectedTeams[0] ?? 'One team'
  if (audience === 'selected_teams') return selectedTeams.length ? `${selectedTeams.length} selected teams` : 'No teams selected'
  return 'All eligible event participants'
}

function ModerationPage({ reports, requests, onReportAction, onCustomAction }: {
  reports: ReportCase[]
  requests: CustomRequest[]
  onReportAction: (id: string, status: ReportCase['status']) => void
  onCustomAction: (id: string, status: CustomRequest['status'], reason?: string) => void
}) {
  const [tab, setTab] = useState<'reports' | 'custom'>('reports')
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const openReports = reports.filter((report) => ['new', 'under_review'].includes(report.status))
  const pendingRequests = requests.filter((request) => ['submitted', 'under_review', 'changes_requested'].includes(request.status))
  const decideCustom = (id: string, status: CustomRequest['status']) => {
    if (status === 'rejected' && !decisionReason.trim()) { setReviewing(id); return }
    onCustomAction(id, status, decisionReason.trim() || undefined)
    setReviewing(null)
    setDecisionReason('')
  }
  return <div className="moderation-page">
    <PageHeading eyebrow="BUILDFEST 2026 · SAFETY & QUALITY" title="Moderation center" subtitle="Review reports and custom post requests as separate, accountable workflows." action={<span className="organizer-preview-pill"><ShieldCheck size={14} /> Moderator tools</span>} />
    <div className="moderation-summary-row"><div><span className="moderation-summary-icon alert-summary"><Flag size={17} /></span><span><strong>{openReports.length} open reports</strong><small>Reports do not automatically hide content.</small></span></div><div><span className="moderation-summary-icon request-summary"><FileText size={17} /></span><span><strong>{pendingRequests.length} requests to review</strong><small>Private until approved.</small></span></div><div><span className="moderation-summary-icon audit-summary"><ShieldCheck size={17} /></span><span><strong>Preview decisions are saved</strong><small>Production needs a server-side audit trail.</small></span></div></div>
    <div className="moderation-tabs" role="tablist"><button type="button" className={tab === 'reports' ? 'selected' : ''} onClick={() => setTab('reports')} role="tab" aria-selected={tab === 'reports'}><Flag size={15} />Reports<span>{reports.length}</span></button><button type="button" className={tab === 'custom' ? 'selected' : ''} onClick={() => setTab('custom')} role="tab" aria-selected={tab === 'custom'}><FileText size={15} />Custom post review<span>{requests.length}</span></button></div>
    {tab === 'reports' ? <div className="moderation-case-list">{reports.length ? [...reports].sort((a, b) => b.reportedAt - a.reportedAt).map((report) => <article className="moderation-case" key={report.id}><div className="case-header"><span className="case-icon report-case-icon"><Flag size={16} /></span><div><div className="case-type-line"><strong>Content report</strong><StatusChip status={report.status === 'new' ? 'New' : report.status.replaceAll('_', ' ')} /></div><small>{timeAgo(report.reportedAt)} · {report.zone}</small></div>{report.status === 'new' && <button className="case-review-button" type="button" onClick={() => onReportAction(report.id, 'under_review')}>Start review <ArrowRight size={13} /></button>}</div><div className="case-content"><span className="case-target-label">REPORTED CONTENT</span><strong>{report.target}</strong><p><span className="reason-dot" />{report.reason}</p><small>Reported by {report.reporter}</small></div>{['new', 'under_review'].includes(report.status) && <div className="case-actions"><button type="button" className="secondary-button" onClick={() => onReportAction(report.id, 'dismissed')}>Dismiss report</button><button type="button" className="danger-button" onClick={() => onReportAction(report.id, 'action_taken')}><ShieldCheck size={14} /> Take action</button></div>}{!['new', 'under_review'].includes(report.status) && <div className="case-outcome"><CheckCircle2 size={14} />Decision recorded · {report.status.replaceAll('_', ' ')}</div>}</article>) : <EmptyActivity title="No reports yet" body="Reports submitted by participants will appear here for review." />}</div> : <div className="moderation-case-list">{requests.length ? [...requests].sort((a, b) => b.submittedAt - a.submittedAt).map((request) => <article className="moderation-case custom-review-case" key={request.id}><div className="case-header"><span className="case-icon custom-case-icon"><FileText size={16} /></span><div><div className="case-type-line"><strong>Custom post request</strong><StatusChip status={request.status === 'under_review' ? 'Awaiting review' : request.status.replaceAll('_', ' ')} /></div><small>Submitted {timeAgo(request.submittedAt)} · Private submission</small></div></div><div className="case-content"><span className="case-target-label">PROPOSED POST</span><strong>{request.title}</strong><p>{request.body}</p><div className="custom-audience-line"><span>INTENDED AUDIENCE</span><strong>{request.intendedAudience}</strong></div><div className="custom-reason-box"><span>WHY A TEMPLATE DIDN'T FIT</span><p>{request.reason}</p></div>{request.reviewReason && <div className="review-reason"><Info size={14} />Decision note: {request.reviewReason}</div>}</div>{['submitted', 'under_review', 'changes_requested'].includes(request.status) && <>{reviewing === request.id && <label className="form-field decision-reason-field"><span>Decision note {reviewing === request.id ? <em>Required for rejection</em> : null}</span><textarea rows={2} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} placeholder="Tell the participant what to change or why this was rejected." /></label>}<div className="case-actions"><button type="button" className="secondary-button" onClick={() => decideCustom(request.id, 'changes_requested')}>Request changes</button><button type="button" className="secondary-button reject-button" onClick={() => decideCustom(request.id, 'rejected')}>Reject</button><button type="button" className="primary-button" onClick={() => decideCustom(request.id, 'approved')}><Check size={14} /> Approve & publish</button></div></>}{['approved', 'rejected'].includes(request.status) && <div className="case-outcome"><CheckCircle2 size={14} />Decision recorded · {request.status}</div>}</article>) : <EmptyActivity title="No custom requests" body="Participant submissions that do not fit an existing template will appear here." />}</div>}
    <div className="moderation-footnote"><Info size={14} /> Moderator access is event-scoped. Private organizer conversations are not included in this queue by default.</div>
  </div>
}

function SettingsPage({ zone, blockedAuthors, setBlockedAuthors, mutedCategories, setMutedCategories, notificationPreferences, setNotificationPreferences, onCheckLocation, onToast }: { zone: string; blockedAuthors: string[]; setBlockedAuthors: (authors: string[]) => void; mutedCategories: string[]; setMutedCategories: (categories: string[]) => void; notificationPreferences: { inApp: boolean; replies: boolean; announcements: boolean }; setNotificationPreferences: (preferences: { inApp: boolean; replies: boolean; announcements: boolean }) => void; onCheckLocation: () => void; onToast: (message: string) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const toggleMute = (category: string) => setMutedCategories(mutedCategories.includes(category) ? mutedCategories.filter((item) => item !== category) : [...mutedCategories, category])
  return <div className="settings-page">
    <PageHeading eyebrow="YOUR ACCOUNT · BUILDFEST 2026" title="Settings & privacy" subtitle="Small, clear controls for how DropZone works for you." />
    <div className="settings-profile-card"><Avatar initials={currentUser.initials} color="green" size="lg" /><span><strong>{currentUser.name}</strong><small>BuildFest 2026 · Participant</small></span><button type="button" className="secondary-button" onClick={() => onToast('Profile editing is not connected in this demo.')}>Edit profile</button></div>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon location-settings-icon"><MapPin size={17} /></span><div><h2>Location & zone access</h2><p>Location is used only when you choose a location-dependent action.</p></div></div><div className="settings-detail-block"><div><strong>Current zone access</strong><small>{zone} · simulation mode · no physical presence verified</small></div><span className="settings-status-tag">Demo access</span></div><div className="settings-detail-block"><div><strong>Device location permission</strong><small>DropZone does not keep a movement history. A live geofence check is not connected in this demo.</small></div><button type="button" className="secondary-button location-settings-action" onClick={onCheckLocation}><MapPin size={13} /> Check device location</button></div><div className="settings-info-box"><Info size={15} /><span>Your coordinates are not shown to other participants. Browser location can be inaccurate or spoofed, and is not strong proof of identity.</span></div></section>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon notification-settings-icon"><Bell size={17} /></span><div><h2>Notifications</h2><p>Choose which updates you want to hear about in the app.</p></div></div><SettingsToggle title="In-app notifications" detail="Show replies, organizer notes, and decisions." checked={notificationPreferences.inApp} onChange={(value) => setNotificationPreferences({ ...notificationPreferences, inApp: value })} /><SettingsToggle title="Replies to your posts" detail="Let me know when someone responds to a thread." checked={notificationPreferences.replies} onChange={(value) => setNotificationPreferences({ ...notificationPreferences, replies: value })} /><SettingsToggle title="Official event updates" detail="Room changes, schedule updates, and announcements." checked={notificationPreferences.announcements} onChange={(value) => setNotificationPreferences({ ...notificationPreferences, announcements: value })} /></section>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon mute-settings-icon"><Eye size={17} /></span><div><h2>Muted categories</h2><p>Muted categories stay in the feed, but do not send notifications.</p></div></div><div className="mute-options">{['Lost & found', 'Team & help', 'Resources', 'Questions'].map((item) => <button key={item} type="button" className={mutedCategories.includes(item) ? 'muted' : ''} onClick={() => toggleMute(item)}>{item}{mutedCategories.includes(item) ? <span>Muted</span> : <span>Mute</span>}</button>)}</div></section>
    <section className="settings-section"><div className="settings-section-heading"><span className="settings-section-icon block-settings-icon"><UserRound size={17} /></span><div><h2>Blocked users</h2><p>Blocked users are hidden from your feed. This does not prevent alternate accounts.</p></div></div>{blockedAuthors.length ? <div className="blocked-user-list">{blockedAuthors.map((author) => <div key={author}><Avatar initials={author.split(' ').map((part) => part[0]).slice(0, 2).join('')} color="slate" size="sm" /><strong>{author}</strong><button type="button" onClick={() => { setBlockedAuthors(blockedAuthors.filter((item) => item !== author)); onToast(`${author} was unblocked.`) }}>Unblock</button></div>)}</div> : <p className="settings-empty-note">No blocked users. You can hide someone from a post’s options menu.</p>}</section>
    <section className="settings-section retention-section"><div className="settings-section-heading"><span className="settings-section-icon privacy-settings-icon"><LockKeyhole size={17} /></span><div><h2>Privacy & retention</h2><p>Understand what expiry does — and what it cannot promise.</p></div></div><div className="retention-copy"><p><strong>When a post expires</strong>, it leaves active discovery and stops accepting replies. It may remain in your personal history for the event’s retention period.</p><p><strong>View only is best effort.</strong> A browser receives content it displays, so screenshots and external copies cannot be universally prevented.</p><p><strong>Deletion has limits.</strong> DropZone cannot revoke screenshots or guarantee instant removal from backups and other recipients’ copies.</p></div><a className="privacy-link" href="#privacy-notice" onClick={(event) => { event.preventDefault(); onToast('Privacy notice: this is a browser-only demo. No location, file, or message is sent to a server.') }}>Read the current privacy notice <ArrowUpRight size={14} /></a></section>
    <section className="settings-section account-section"><div className="settings-section-heading"><span className="settings-section-icon account-settings-icon"><UserRound size={17} /></span><div><h2>Account controls</h2><p>Manage your participation in this event.</p></div></div><div className="account-control-row"><span><strong>Leave BuildFest 2026</strong><small>Remove this account from the event on this device.</small></span><button type="button" className="text-button" onClick={() => setConfirmDelete((open) => !open)}>Leave event</button></div>{confirmDelete && <div className="leave-confirm"><span>This demo cannot remove a real membership. Clear your local demo state instead?</span><button type="button" className="danger-button" onClick={() => { Object.keys(localStorage).filter((key) => key.startsWith('dropzone.')).forEach((key) => localStorage.removeItem(key)); onToast('Local demo state cleared. Refresh to restart the demo.'); setConfirmDelete(false) }}>Clear local state</button><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>}</section>
    <p className="settings-build-note"><ShieldCheck size={14} /> This experience is a local prototype. Authentication, server-side access control, and production retention are not connected.</p>
  </div>
}

function SettingsToggle({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="settings-detail-block"><div><strong>{title}</strong><small>{detail}</small></div><button className={`toggle-button ${checked ? 'on' : ''}`} type="button" aria-pressed={checked} onClick={() => onChange(!checked)}><span /></button></div>
}

export default PrototypePreview
