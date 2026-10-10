import type {
  CustomRequest,
  NotificationItem,
  OrganizerConversation,
  Post,
  ReportCase,
} from './types'

const minute = 60_000
const hour = 60 * minute

export const eventName = 'BuildFest 2026'
export const defaultZone = 'Innovation Hall'
export const currentUser = { name: 'Asha Raman', initials: 'AR' }

export function makeSeedPosts(now = Date.now()): Post[] {
  return [
    {
      id: 'post-found-bottle',
      template: 'lost_found',
      title: 'Found: blue water bottle by Studio B',
      body: 'A navy Hydro Flask was left on the bench just outside Studio B. I handed it to the front-desk team at the main entrance.',
      author: 'Mira Patel',
      initials: 'MP',
      avatarColor: 'rose',
      createdAt: now - 18 * minute,
      expiresAt: now + 23 * hour + 42 * minute,
      status: 'published',
      locationNote: 'Studio B · North entrance',
      replies: [
        { id: 'r1', author: 'Noah Kim', initials: 'NK', body: 'Thanks! I think that might be mine. Heading to the desk now.', createdAt: now - 12 * minute },
        { id: 'r2', author: 'Mira Patel', initials: 'MP', body: 'They have it behind the counter. Ask for the blue bottle.', createdAt: now - 9 * minute },
      ],
    },
    {
      id: 'post-teammate-climate',
      template: 'find_teammate',
      title: 'Looking for a frontend partner for the climate track',
      body: 'We have a working sensor prototype and a clear problem statement. Looking for someone who enjoys turning rough ideas into a thoughtful interface.',
      author: 'Kavya Nair',
      initials: 'KN',
      avatarColor: 'violet',
      createdAt: now - 34 * minute,
      expiresAt: now + 86 * minute,
      status: 'published',
      extra: 'Frontend · React · Climate track',
      replies: [
        { id: 'r3', author: 'Ishaan Das', initials: 'ID', body: 'I have a bit of React experience — are you at the project tables?', createdAt: now - 20 * minute },
        { id: 'r4', author: 'Kavya Nair', initials: 'KN', body: 'Yep, table 14 near the north windows!', createdAt: now - 17 * minute },
        { id: 'r5', author: 'Sam Lee', initials: 'SL', body: 'Sent you a note about the design system.', createdAt: now - 8 * minute },
      ],
    },
    {
      id: 'post-usbc-adapter',
      template: 'need_resource',
      title: 'Does anyone have a USB-C to HDMI adapter?',
      body: 'I need to connect a laptop to the demo screen for our 2 pm mentor check-in. Happy to borrow and return it right after.',
      author: 'Leo Park',
      initials: 'LP',
      avatarColor: 'blue',
      createdAt: now - 46 * minute,
      expiresAt: now + 74 * minute,
      status: 'published',
      extra: 'Need 1 · Borrow · Needed by 1:45 pm',
      locationNote: 'Project tables · Row C',
      replies: [
        { id: 'r6', author: 'Asha Raman', initials: 'AR', body: 'I have one! I’m at the green lounge table.', createdAt: now - 4 * minute, mine: true },
      ],
    },
    {
      id: 'post-offer-review',
      template: 'offer_resource',
      title: 'Happy to review a pitch deck before 3 pm',
      body: 'I’ve got a free half hour between mentor sessions. Bring a rough deck, a sketch, or just the idea — happy to give friendly feedback.',
      author: 'You',
      initials: 'AR',
      avatarColor: 'green',
      createdAt: now - 57 * minute,
      expiresAt: now + 63 * minute,
      status: 'published',
      extra: 'Pitch feedback · Available until 3 pm',
      replies: [
        { id: 'r7', author: 'Mira Patel', initials: 'MP', body: 'This is so kind. I’ll bring our draft by in a few minutes!', createdAt: now - 26 * minute },
      ],
    },
    {
      id: 'post-quiet-room',
      template: 'community_question',
      title: 'Is there a quiet space for a quick call?',
      body: 'Looking for somewhere a little quieter than the main hall. A small room or a calm corner would be perfect.',
      author: 'Ethan Brooks',
      initials: 'EB',
      avatarColor: 'amber',
      createdAt: now - 70 * minute,
      expiresAt: now + 290 * minute,
      status: 'published',
      replies: [
        { id: 'r8', author: 'Nina Roy', initials: 'NR', body: 'The library nook on level 2 is open until 4!', createdAt: now - 52 * minute },
        { id: 'r9', author: 'Ethan Brooks', initials: 'EB', body: 'Found it — thank you!', createdAt: now - 48 * minute },
      ],
    },
  ]
}

export function makeSeedNotifications(now = Date.now()): NotificationItem[] {
  return [
    { id: 'n1', title: 'A reply to your offer', body: 'Mira wants to bring her pitch deck by for feedback.', createdAt: now - 4 * minute, read: false, kind: 'reply' },
    { id: 'n2', title: 'Workshop room update', body: 'The rapid prototyping session is now in Cedar 2.', createdAt: now - 31 * minute, read: false, kind: 'announcement' },
    { id: 'n3', title: 'Your request is being reviewed', body: 'Your custom post request is with the event team.', createdAt: now - 2 * hour, read: true, kind: 'status' },
    { id: 'n4', title: 'A note from the organizers', body: 'The help desk is open by the main entrance.', createdAt: now - 4 * hour, read: true, kind: 'organizer' },
  ]
}

export function makeSeedConversations(now = Date.now()): OrganizerConversation[] {
  return [
    {
      id: 'conversation-accessibility',
      subject: 'Workshop accessibility',
      category: 'Accessibility',
      status: 'awaiting_participant',
      updatedAt: now - 26 * minute,
      messages: [
        { id: 'm1', author: 'You', body: 'Could you let me know whether Cedar 2 has step-free access for the afternoon workshop?', createdAt: now - 58 * minute, mine: true },
        { id: 'm2', author: 'Riya · Organizer', body: 'Yes — Cedar 2 is step-free, and there is an accessible entrance on the east side. I can meet you there if that helps.', createdAt: now - 26 * minute },
      ],
    },
  ]
}

export function makeSeedCustomRequests(now = Date.now()): CustomRequest[] {
  return [
    {
      id: 'custom-recap-thread',
      title: 'Share a short workshop recap thread',
      body: 'A place to share a few takeaways from each session for people who could not attend.',
      reason: 'The community question template does not support a multi-part recap.',
      intendedAudience: 'Innovation Hall',
      submittedAt: now - 2 * hour,
      status: 'under_review',
    },
  ]
}

export function makeSeedReports(now = Date.now()): ReportCase[] {
  return [
    {
      id: 'report-contact-details',
      target: 'Post: “Found: blue water bottle by Studio B”',
      targetPostId: 'post-found-bottle',
      reason: 'Personal information',
      zone: defaultZone,
      reportedAt: now - 22 * minute,
      status: 'new',
      reporter: 'Event participant',
    },
  ]
}

export function timeAgo(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < minute) return 'Just now'
  const minutes = Math.floor(elapsed / minute)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function timeRemaining(timestamp: number): string {
  const remaining = timestamp - Date.now()
  if (remaining <= 0) return 'Expired'
  const hours = Math.floor(remaining / hour)
  const minutes = Math.floor((remaining % hour) / minute)
  if (hours > 23) return `${Math.floor(hours / 24)}d left`
  if (hours > 0) return `${hours}h ${minutes}m left`
  return `${Math.max(1, minutes)}m left`
}
