export type TemplateCode =
  | 'lost_found'
  | 'find_teammate'
  | 'need_resource'
  | 'ask_help'
  | 'offer_resource'
  | 'community_question'

export type PostStatus = 'published' | 'fulfilled' | 'closed' | 'expired' | 'removed'

export type Reply = {
  id: string
  author: string
  initials: string
  body: string
  createdAt: number
  mine?: boolean
}

export type Post = {
  id: string
  zone?: string
  visibility?: 'zone' | 'event'
  template: TemplateCode
  title: string
  body: string
  author: string
  initials: string
  avatarColor: string
  createdAt: number
  expiresAt: number
  status: PostStatus
  replies: Reply[]
  extra?: string
  attachmentName?: string
  downloadAllowed?: boolean
  locationNote?: string
}

export type NotificationItem = {
  id: string
  title: string
  body: string
  createdAt: number
  read: boolean
  kind: 'reply' | 'organizer' | 'status' | 'announcement'
}

export type ConversationMessage = {
  id: string
  author: string
  body: string
  createdAt: number
  mine?: boolean
}

export type OrganizerConversation = {
  id: string
  subject: string
  category: string
  status: 'open' | 'awaiting_organizer' | 'awaiting_participant' | 'resolved'
  updatedAt: number
  messages: ConversationMessage[]
}

export type CustomRequest = {
  id: string
  title: string
  body: string
  reason: string
  intendedAudience: string
  submittedAt: number
  status: 'submitted' | 'under_review' | 'changes_requested' | 'approved' | 'rejected'
  reviewReason?: string
}

export type ReportCase = {
  id: string
  target: string
  targetPostId?: string
  reason: string
  zone: string
  reportedAt: number
  status: 'new' | 'under_review' | 'action_taken' | 'dismissed' | 'closed'
  reporter: string
}

export type PageKey =
  | 'community'
  | 'create'
  | 'organizers'
  | 'activity'
  | 'notifications'
  | 'overview'
  | 'zones'
  | 'participants'
  | 'communications'
  | 'moderation'
  | 'settings'

export type UserRole = 'participant' | 'organizer'
