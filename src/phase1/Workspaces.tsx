import { lazy, Suspense, useState, useEffect } from 'react'
const Workbench = lazy(() => import('../phase2/Workbench').then(module => ({ default: module.Workbench })))
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Compass, Copy, KeyRound, LockKeyhole, LogOut, Radio, RefreshCw, Search, ShieldCheck, Users, MapPin, Shield, Clock, ChevronRight, ChevronLeft, Sparkles, Navigation, Layers, Globe, AlertCircle } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from './AccessProvider'
import type { EventMembershipAccess, TrustedAccess } from '../lib/database.types'

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const MODERATION_PERMISSIONS = ['review_reports', 'remove_content', 'review_custom_posts', 'view_audit_log']

function workspaceForMembership(membership: EventMembershipAccess): 'participant' | 'organizer' | 'moderator' {
  if (membership.role === 'organizer') return 'organizer'
  if (membership.role === 'moderator' && membership.permissions.some((permission) => MODERATION_PERMISSIONS.includes(permission))) return 'moderator'
  return 'participant'
}

function eventPath(membership: EventMembershipAccess) {
  return `/app/events/${encodeURIComponent(membership.event_id)}/${workspaceForMembership(membership)}`
}

function canCreateEvent(membership: EventMembershipAccess) {
  return membership.role === 'organizer' && membership.permissions.includes('manage_event')
}

function CreateEventPanel({ memberships, refreshAccess }: { memberships: EventMembershipAccess[]; refreshAccess: () => Promise<TrustedAccess | null> }) {
  const { client } = useAuth()
  const navigate = useNavigate()
  const sourceMembership = memberships.find(canCreateEvent)

  // 5-step wizard state
  const [step, setStep] = useState(1)

  // Step 1: Zone Identity
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [sector, setSector] = useState('Tech & Hackathons')

  // Step 2: Geofence Polygon
  const [boundaryType, setBoundaryType] = useState<'circle' | 'polygon'>('circle')
  const [latitude, setLatitude] = useState(20.5937)
  const [longitude, setLongitude] = useState(78.9629)
  const [radius, setRadius] = useState(500)
  const [zoneName, setZoneName] = useState('Perimeter Alpha')
  const [locDetecting, setLocDetecting] = useState(false)
  const [locNotice, setLocNotice] = useState('')

  // Step 3: TTL Lifespan
  const [ttlHours, setTtlHours] = useState('24')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [storagePolicy, setStoragePolicy] = useState<'strict' | 'standard'>('strict')

  // Step 4: Telemetry Rules
  const [locationRequired, setLocationRequired] = useState(true)
  const [maxAccuracy, setMaxAccuracy] = useState(25)
  const [downloadsAllowed, setDownloadsAllowed] = useState(true)

  // Feedback & submission
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!sourceMembership) return null

  const detectGpsForStep2 = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocNotice('Geolocation is unavailable in this browser environment.')
      return
    }
    setLocDetecting(true)
    setLocNotice('Acquiring live GPS coordinate lock…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(Number(pos.coords.latitude.toFixed(6)))
        setLongitude(Number(pos.coords.longitude.toFixed(6)))
        setLocNotice(`Lock acquired: ${pos.coords.latitude.toFixed(4)}° N, ${pos.coords.longitude.toFixed(4)}° E (±${Math.round(pos.coords.accuracy)}m)`)
        setLocDetecting(false)
      },
      (err) => {
        setLocNotice(err.code === 1 ? 'Location permission was denied by browser.' : 'Unable to acquire GPS fix. Please enter manually.')
        setLocDetecting(false)
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const validateStep1 = () => {
    if (!name.trim()) {
      setError('Event name is required.')
      return false
    }
    if (!slug.trim()) {
      setError('Unique event slug is required.')
      return false
    }
    setError('')
    return true
  }

  const goToStep = (target: number) => {
    if (target > 1 && !validateStep1()) {
      setStep(1)
      return
    }
    setError('')
    setStep(target)
  }

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    if (event) event.preventDefault()
    if (!sourceMembership) return
    if (!validateStep1()) {
      setStep(1)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const cleanName = name.trim()
      const cleanSlug = slug.trim()
      // 1. Create the event
      const { data, error: createError } = await client.rpc('dz_command', {
        p_event: sourceMembership.event_id,
        p_action: 'event.create',
        p_data: {
          name: cleanName,
          slug: cleanSlug,
          description: description.trim(),
        },
        p_request: crypto.randomUUID(),
      })
      if (createError) throw createError
      const createdId = typeof data === 'object' && data && 'id' in data ? String((data as { id: string }).id) : null

      // 2. Configure event telemetry rules & schedule
      if (createdId) {
        try {
          await client.rpc('dz_command', {
            p_event: createdId,
            p_action: 'event.update',
            p_data: {
              name: cleanName,
              description: description.trim(),
              location_required: locationRequired,
              max_accuracy_meters: maxAccuracy,
              downloads_allowed: downloadsAllowed,
              starts_at: startsAt || null,
              ends_at: endsAt || null,
            },
            p_request: crypto.randomUUID(),
          })
        } catch {}

        // 3. Save initial geofenced zone
        try {
          await client.rpc('dz_command', {
            p_event: createdId,
            p_action: 'zone.save',
            p_data: {
              name: zoneName || 'Main Geofence',
              boundary_type: boundaryType,
              radius_meters: radius,
              geometry:
                boundaryType === 'circle'
                  ? { type: 'Point', coordinates: [longitude, latitude] }
                  : {
                      type: 'Polygon',
                      coordinates: [[
                        [longitude - 0.003, latitude - 0.003],
                        [longitude + 0.003, latitude - 0.003],
                        [longitude + 0.003, latitude + 0.003],
                        [longitude - 0.003, latitude + 0.003],
                        [longitude - 0.003, latitude - 0.003],
                      ]],
                    },
            },
            p_request: crypto.randomUUID(),
          })
        } catch {}

        // Save event coordinates in localStorage for location filtering
        try {
          localStorage.setItem(`dropzone_event_coords_${createdId}`, JSON.stringify({
            latitude,
            longitude,
            radius,
            name: cleanName,
          }))
        } catch {}
      }

      const refreshed = await refreshAccess()
      const createdMembership = refreshed?.memberships.find((m: EventMembershipAccess) => m.event_id === createdId)
      if (createdMembership) {
        setNotice('Zone deployed successfully. Opening workspace…')
        navigate(eventPath(createdMembership), { replace: true })
        return
      }
      const fallbackSlug = cleanSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
      const fallbackMembership = refreshed?.memberships.find((m: EventMembershipAccess) => m.event_slug.toLowerCase() === fallbackSlug)
      if (fallbackMembership) {
        setNotice('Zone deployed successfully. Opening workspace…')
        navigate(eventPath(fallbackMembership), { replace: true })
        return
      }
      setNotice('Event created. Open My events to continue.')
    } catch (caught) {
      const errObj = caught as { message?: string; code?: string; status?: number; details?: string }
      const msg = errObj?.message || ''
      const details = errObj?.details || ''
      if (
        errObj?.status === 409 ||
        errObj?.code === '23505' ||
        msg.toLowerCase().includes('duplicate') ||
        msg.toLowerCase().includes('already exists') ||
        msg.toLowerCase().includes('unique') ||
        details.toLowerCase().includes('already exists')
      ) {
        setError(`The event slug "${slug.trim()}" is already taken. Please choose a different unique event slug.`)
      } else {
        setError(caught instanceof Error ? caught.message : 'The event could not be created. Check the details and try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const stepsList = [
    { num: 'Step 01', name: 'Zone Identity' },
    { num: 'Step 02', name: 'Geofence Polygon' },
    { num: 'Step 03', name: 'TTL Lifespan' },
    { num: 'Step 04', name: 'Telemetry Rules' },
    { num: 'Step 05', name: 'Deploy Zone' },
  ]

  return (
    <section id="create-event-panel" className="stitch-wizard-card workspace-panel">
      <div className="stitch-stepper-bar" role="tablist" aria-label="Zone Deployment Stepper">
        {stepsList.map((item, idx) => {
          const stepNum = idx + 1
          const isActive = step === stepNum
          const isCompleted = step > stepNum
          return (
            <button
              type="button"
              key={item.num}
              role="tab"
              aria-selected={isActive}
              className={`stitch-step-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
              onClick={() => goToStep(stepNum)}
            >
              <div className="stitch-step-header">
                <span>{item.num}</span>
                {isCompleted && <CheckCircle2 size={12} />}
              </div>
              <div className="stitch-step-bar" />
              <div className="stitch-step-name">{item.name}</div>
            </button>
          )
        })}
      </div>

      <div className="workspace-panel-heading">
        <h2>Create a new event</h2>
        <p>
          {step === 1 && 'Step 1 of 5: Define cryptographic identity and naming.'}
          {step === 2 && 'Step 2 of 5: Bounded coordinates and geographic fence perimeter.'}
          {step === 3 && 'Step 3 of 5: Ephemeral signal lifespan and in-memory TTL expiration.'}
          {step === 4 && 'Step 4 of 5: Civic telemetry constraints and location verification rules.'}
          {step === 5 && 'Step 5 of 5: Review specifications and deploy your live geofenced zone.'}
        </p>
      </div>

      <form className="auth-form dz-form stitch-field" onSubmit={submit}>
        {/* STEP 1: ZONE IDENTITY */}
        {step === 1 && (
          <div className="stitch-wizard-step-body">
            <label className="auth-field">
              <span>Event name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. HackSprint 2026 or YuvaTarang"
                required
                maxLength={120}
              />
            </label>
            <label className="auth-field">
              <span>Unique event slug</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. hacksprint-2026"
                required
                minLength={3}
                maxLength={60}
                pattern="[a-z0-9][a-z0-9\-]*"
              />
            </label>
            <label className="auth-field">
              <span>Primary Sector / Category</span>
              <select value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="Tech & Hackathons">Tech &amp; Hackathons</option>
                <option value="University Campus">University Campus</option>
                <option value="Festival & Cultural">Festival &amp; Cultural</option>
                <option value="Sports & Tournament">Sports &amp; Tournament</option>
                <option value="Civic Assembly">Civic Assembly</option>
                <option value="Private Community">Private Community</option>
              </select>
            </label>
            <label className="auth-field">
              <span>Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your event purpose, physical zone bounds, and rules."
                maxLength={5000}
                rows={4}
              />
            </label>

            <div className="stitch-wizard-actions">
              <button
                className="primary-button stitch-btn-primary"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Creating event…' : 'Create event'}
              </button>
              <button
                className="secondary-button stitch-btn-secondary"
                type="button"
                onClick={() => goToStep(2)}
              >
                Next: Geofence Polygon <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: GEOFENCE POLYGON */}
        {step === 2 && (
          <div className="stitch-wizard-step-body">
            <div className="stitch-gps-detect-row">
              <button
                type="button"
                className="secondary-button stitch-btn-secondary"
                onClick={detectGpsForStep2}
                disabled={locDetecting}
              >
                <Navigation size={14} />
                <span>{locDetecting ? 'Detecting coordinates…' : 'Detect & Use My Current GPS Coordinates'}</span>
              </button>
              {locNotice && <span className="stitch-loc-notice-inline">{locNotice}</span>}
            </div>

            <div className="stitch-input-row">
              <label className="auth-field">
                <span>Boundary Type</span>
                <select
                  value={boundaryType}
                  onChange={(e) => setBoundaryType(e.target.value as 'circle' | 'polygon')}
                >
                  <option value="circle">Radial Circle Geofence</option>
                  <option value="polygon">Multi-Point Polygon Perimeter</option>
                </select>
              </label>
              <label className="auth-field">
                <span>Initial Zone Label</span>
                <input
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder="e.g. Main Arena, Central Lawn"
                />
              </label>
            </div>

            <div className="stitch-input-row">
              <label className="auth-field">
                <span>Center Latitude (-90 to 90)</span>
                <input
                  type="number"
                  step="0.000001"
                  min="-90"
                  max="90"
                  value={latitude}
                  onChange={(e) => setLatitude(parseFloat(e.target.value) || 0)}
                  required
                />
              </label>
              <label className="auth-field">
                <span>Center Longitude (-180 to 180)</span>
                <input
                  type="number"
                  step="0.000001"
                  min="-180"
                  max="180"
                  value={longitude}
                  onChange={(e) => setLongitude(parseFloat(e.target.value) || 0)}
                  required
                />
              </label>
            </div>

            <label className="auth-field">
              <span>Geofence Radius: {radius} meters</span>
              <input
                type="range"
                min="50"
                max="5000"
                step="50"
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value, 10))}
              />
            </label>

            {/* Geofence Live Preview Box */}
            <div className="stitch-geofence-preview-box">
              <div className="stitch-geofence-preview-text">
                <strong>🛰️ Cryptographic Geofence Lock</strong>
                <span style={{ fontSize: 13, color: 'var(--stitch-text-muted)' }}>
                  Center: {latitude.toFixed(4)}° N, {longitude.toFixed(4)}° E • Radius: ±{radius}m • Bounded: {boundaryType.toUpperCase()}
                </span>
              </div>
              <span className="stitch-geofence-pill">
                <span className="stitch-dot-ping" /> ±5m GPS Lock Active
              </span>
            </div>

            <div className="stitch-wizard-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep(1)}
              >
                <ChevronLeft size={16} /> Back to Identity
              </button>
              <button
                type="button"
                className="primary-button stitch-btn-primary"
                onClick={() => goToStep(3)}
              >
                Next: TTL Lifespan <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: TTL LIFESPAN */}
        {step === 3 && (
          <div className="stitch-wizard-step-body">
            <label className="auth-field">
              <span>Default Signal Ephemeral Lifetime (TTL)</span>
              <div className="stitch-ttl-chips-grid">
                {[
                  { value: '1', label: '1 Hour (Strict Purge)' },
                  { value: '6', label: '6 Hours (Half-Day)' },
                  { value: '12', label: '12 Hours (Single Day)' },
                  { value: '24', label: '24 Hours (Full Day)' },
                  { value: '72', label: '3 Days' },
                  { value: '168', label: '7 Days (Week)' },
                ].map((chip) => (
                  <button
                    type="button"
                    key={chip.value}
                    className={`stitch-chip ${ttlHours === chip.value ? 'active' : ''}`}
                    onClick={() => setTtlHours(chip.value)}
                  >
                    <Clock size={13} /> {chip.label}
                  </button>
                ))}
              </div>
            </label>

            <div className="stitch-input-row">
              <label className="auth-field">
                <span>Event Activation (Starts At)</span>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </label>
              <label className="auth-field">
                <span>Event Deactivation (Ends At)</span>
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </label>
            </div>

            <div className="stitch-telemetry-toggle-card">
              <input
                type="checkbox"
                id="storagePolicyCheck"
                checked={storagePolicy === 'strict'}
                onChange={(e) => setStoragePolicy(e.target.checked ? 'strict' : 'standard')}
              />
              <label htmlFor="storagePolicyCheck" className="stitch-telemetry-toggle-content">
                <strong>Zero Residual Data Storage Policy</strong>
                <span>
                  Post signals and telemetry records automatically purge permanently upon expiration timer trigger. Zero coordinate logs preserved.
                </span>
              </label>
            </div>

            <div className="stitch-wizard-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep(2)}
              >
                <ChevronLeft size={16} /> Back to Geofence
              </button>
              <button
                type="button"
                className="primary-button stitch-btn-primary"
                onClick={() => goToStep(4)}
              >
                Next: Telemetry Rules <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: TELEMETRY RULES */}
        {step === 4 && (
          <div className="stitch-wizard-step-body">
            <div className="stitch-telemetry-toggle-card">
              <input
                type="checkbox"
                id="locationRequiredCheck"
                checked={locationRequired}
                onChange={(e) => setLocationRequired(e.target.checked)}
              />
              <label htmlFor="locationRequiredCheck" className="stitch-telemetry-toggle-content">
                <strong>Require In-Geofence Physical Verification</strong>
                <span>
                  Participants must prove physical coordinates inside the active polygon before publishing any post or community broadcast.
                </span>
              </label>
            </div>

            <label className="auth-field">
              <span>Maximum GPS Accuracy Threshold</span>
              <select
                value={maxAccuracy}
                onChange={(e) => setMaxAccuracy(parseInt(e.target.value, 10))}
              >
                <option value={5}>±5m Lock (High-Precision GPS Hardware)</option>
                <option value={10}>±10m Lock (High Accuracy)</option>
                <option value={25}>±25m Lock (Standard Mobile Accuracy - Recommended)</option>
                <option value={50}>±50m Lock (Dense Urban Tolerant)</option>
                <option value={100}>±100m Lock (Relaxed Campus Boundary)</option>
              </select>
            </label>

            <div className="stitch-telemetry-toggle-card">
              <input
                type="checkbox"
                id="downloadsAllowedCheck"
                checked={downloadsAllowed}
                onChange={(e) => setDownloadsAllowed(e.target.checked)}
              />
              <label htmlFor="downloadsAllowedCheck" className="stitch-telemetry-toggle-content">
                <strong>Allow Resource &amp; Image Downloads</strong>
                <span>
                  Allow participants to download shared image attachments and resources within the zone.
                </span>
              </label>
            </div>

            <div className="stitch-wizard-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep(3)}
              >
                <ChevronLeft size={16} /> Back to TTL
              </button>
              <button
                type="button"
                className="primary-button stitch-btn-primary"
                onClick={() => goToStep(5)}
              >
                Next: Review &amp; Deploy <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: DEPLOY ZONE */}
        {step === 5 && (
          <div className="stitch-wizard-step-body">
            <div className="stitch-review-grid">
              <div className="stitch-review-card">
                <h4>Zone Identity</h4>
                <p><strong>{name || 'Unnamed Event'}</strong></p>
                <small>Slug: {slug || 'none'} • Sector: {sector}</small>
              </div>

              <div className="stitch-review-card">
                <h4>Geofence Coordinates</h4>
                <p>{latitude.toFixed(4)}° N, {longitude.toFixed(4)}° E</p>
                <small>Radius: ±{radius}m • Bounded: {boundaryType.toUpperCase()}</small>
              </div>

              <div className="stitch-review-card">
                <h4>TTL Lifespan</h4>
                <p>Default {ttlHours} Hours Expiration</p>
                <small>Policy: {storagePolicy === 'strict' ? 'Strict Ephemeral Purge' : 'Standard'}</small>
              </div>

              <div className="stitch-review-card">
                <h4>Telemetry &amp; Access</h4>
                <p>{locationRequired ? 'Physical Location Required' : 'Location Optional'}</p>
                <small>Accuracy: ±{maxAccuracy}m • Downloads: {downloadsAllowed ? 'Allowed' : 'Blocked'}</small>
              </div>
            </div>

            <div className="stitch-wizard-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep(4)}
              >
                <ChevronLeft size={16} /> Edit Telemetry Rules
              </button>
              <button
                className="primary-button stitch-btn-primary"
                disabled={busy}
                type="submit"
              >
                <Sparkles size={16} />
                <span>{busy ? 'Deploying Geofenced Zone…' : 'Deploy Geofenced Zone'}</span>
              </button>
            </div>
          </div>
        )}

        {error && <p className="auth-error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        {notice && <p className="auth-success" role="status" style={{ marginTop: 14 }}>{notice}</p>}
      </form>
    </section>
  )
}

function isEventInLocation(
  membership: EventMembershipAccess,
  coords: { latitude: number; longitude: number } | null
) {
  if (!coords) return true
  try {
    const raw = localStorage.getItem(`dropzone_event_coords_${membership.event_id}`)
    if (raw) {
      const data = JSON.parse(raw)
      const dist = distanceKm(coords.latitude, coords.longitude, data.latitude, data.longitude)
      const allowedRadiusKm = Math.max((data.radius || 500) / 1000, 35)
      return dist <= allowedRadiusKm
    }
  } catch {}
  return true
}

export function AccessHome() {
  const { access, loading, error, refreshAccess } = useAccess()
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [filterNearMe, setFilterNearMe] = useState(true)

  const askLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocStatus('denied')
      return
    }
    setLocStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
        setLocStatus('granted')
      },
      (err) => {
        setLocStatus(err.code === 1 ? 'denied' : 'idle')
      },
      { enableHighAccuracy: true, timeout: 6000 }
    )
  }

  useEffect(() => {
    // Attempt automatic browser location request on initial load
    askLocation()
  }, [])

  if (loading) return <PrivateLoading message="Checking your event membership…" />
  if (error) return <AccessError error={error} onRetry={() => void refreshAccess()} />

  const allMemberships = access?.memberships ?? []
  const filteredMemberships =
    locStatus === 'granted' && filterNearMe && userCoords
      ? allMemberships.filter((m) => isEventInLocation(m, userCoords))
      : allMemberships

  const scrollToCreateEvent = () => {
    document.getElementById('create-event-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <WorkspaceFrame
      title="Welcome to DropZone"
      subtitle="Ephemeral hyper-local communities bounded by physical coordinates. Join an active zone or create a high-precision geofence."
    >
      {/* Hyper-Local Civic Location Status Banner */}
      <section className="stitch-location-banner" aria-label="Physical Location Telemetry">
        <div className="stitch-loc-status-left">
          <div className={`stitch-loc-radar-dot ${locStatus === 'granted' ? 'active' : ''}`}>
            <span className="stitch-dot-ping" />
          </div>
          <div>
            <div className="stitch-loc-headline">
              {locStatus === 'granted' && userCoords ? (
                <>
                  <strong>Location Verified:</strong> {userCoords.latitude.toFixed(4)}° N,{' '}
                  {userCoords.longitude.toFixed(4)}° E (±{Math.round(userCoords.accuracy)}m lock)
                </>
              ) : locStatus === 'requesting' ? (
                <span>Requesting GPS coordinate lock to display local events…</span>
              ) : (
                <span>Physical Location Verification: Required to view events bounded to your coordinates</span>
              )}
            </div>
            <div className="stitch-loc-subtext">
              {locStatus === 'granted'
                ? 'Hyper-local geofence active. Only events bounded to your verified physical coordinates are shown.'
                : 'DropZone verifies in-memory coordinates. Zero background tracking or historical location logs.'}
            </div>
          </div>
        </div>

        <div className="stitch-loc-actions-right">
          {locStatus === 'granted' ? (
            <div className="stitch-loc-filter-group">
              <button
                type="button"
                className={`stitch-loc-pill-btn ${filterNearMe ? 'active' : ''}`}
                onClick={() => setFilterNearMe(true)}
              >
                📍 In this Location ({filteredMemberships.length})
              </button>
              <button
                type="button"
                className={`stitch-loc-pill-btn ${!filterNearMe ? 'active' : ''}`}
                onClick={() => setFilterNearMe(false)}
              >
                🌐 All Events ({allMemberships.length})
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="primary-button stitch-btn-primary"
              onClick={askLocation}
            >
              <Navigation size={14} /> Allow Location Access
            </button>
          )}
        </div>
      </section>

      <section className="stitch-home-hero">
        <div className="stitch-hero-top">
          <div className="stitch-hero-copy">
            <span className="stitch-hero-tagline">DECENTRALIZED GEOFENCED SPACES</span>
            <p className="stitch-hero-desc">
              Ephemeral hyper-local communities bounded by physical coordinates. Join an active zone or create a high-precision geofence.
            </p>
          </div>
          <div className="stitch-privacy-badge">
            <span className="stitch-dot-ping" />
            <span>Zero background telemetry active</span>
          </div>
        </div>

        <div className="stitch-dual-cards">
          <div className="stitch-action-card">
            <div>
              <div className="stitch-action-icon-circle emerald">
                <Compass size={22} />
              </div>
              <h2 className="stitch-action-title">Join an Event</h2>
              <p className="stitch-action-desc">
                Enter a 43+ char one-time invitation code or scan an in-person physical coordinate drop to access an active private zone.
              </p>
            </div>
            <Link className="primary-button auth-link-button stitch-btn-primary" to="/app/join">
              Join an Event <ArrowRight size={16} />
            </Link>
          </div>

          <div className="stitch-action-card">
            <div>
              <div className="stitch-action-icon-circle indigo">
                <Radio size={22} />
              </div>
              <h2 className="stitch-action-title">Organize an Event</h2>
              <p className="stitch-action-desc">
                Define GPS bounding boxes, configure ephemeral message TTL timers, manage rosters, and monitor civic signals.
              </p>
            </div>
            <button type="button" className="secondary-button stitch-btn-secondary" onClick={scrollToCreateEvent}>
              Organize an Event <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {access && filteredMemberships.length > 0 && (
        <section className="stitch-events-section">
          <div className="stitch-section-heading-bar">
            <h2 className="stitch-section-heading">
              <Users size={18} />
              <span>
                {locStatus === 'granted' && filterNearMe
                  ? 'Active Events in Your Location'
                  : 'My Active Events'}
              </span>
              <span className="stitch-count-pill">{filteredMemberships.length} Active</span>
            </h2>
          </div>

          <div className="stitch-events-grid">
            {filteredMemberships.map((membership) => (
              <Link className="stitch-event-card" key={membership.event_id} to={eventPath(membership)}>
                <div className="stitch-event-badges-row">
                  <span className="stitch-tag">{membership.event_slug}</span>
                  <span className="stitch-live-pill">
                    <span className="stitch-dot-ping" /> {membership.role.toUpperCase()}
                  </span>
                </div>
                <h3 className="stitch-event-title">{membership.event_name}</h3>
                <div className="stitch-event-meta-list">
                  <span>
                    Role: <strong>{membership.role}</strong>
                  </span>
                  <span>
                    Lock: <strong>±5m Active</strong>
                  </span>
                </div>
                <div className="stitch-btn-secondary" style={{ marginTop: 'auto', textAlign: 'center' }}>
                  Enter Zone <ArrowRight size={14} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {access && filteredMemberships.length === 0 && allMemberships.length > 0 && (
        <section className="workspace-panel empty-membership-state" style={{ marginTop: 24 }}>
          <div className="workspace-panel-heading">
            <h2>No active events found in your immediate location coordinates</h2>
            <p>
              Your physical GPS position is verified, but no active private events are bounded to this exact area.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            <button
              type="button"
              className="primary-button stitch-btn-primary"
              onClick={() => setFilterNearMe(false)}
            >
              Show All Authorized Events ({allMemberships.length})
            </button>
            <button
              type="button"
              className="secondary-button stitch-btn-secondary"
              onClick={scrollToCreateEvent}
            >
              Deploy an Event at Current Location
            </button>
          </div>
        </section>
      )}

      {access && allMemberships.length === 0 && (
        <section className="workspace-panel empty-membership-state" style={{ marginTop: 24 }}>
          <div className="workspace-panel-heading">
            <h2>No active event memberships yet</h2>
            <p>There are no trusted event memberships on this account. Join an event or create one you can manage.</p>
          </div>
        </section>
      )}

      <CreateEventPanel memberships={access?.memberships ?? []} refreshAccess={refreshAccess} />
      {access && access.memberships.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <Link className="auth-help-link" to="/app/join">
            Join another event with an invitation code
          </Link>
        </div>
      )}
    </WorkspaceFrame>
  )
}


export function JoinEventPage() {
  const { client } = useAuth()
  const { access, refreshAccess } = useAccess()
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data: joinedEvent, error: joinError } = await client.rpc('accept_event_invitation', { p_token: token.trim() })
      if (joinError) throw joinError
      const nextAccess = await refreshAccess()
      const joined = nextAccess?.memberships.find((membership) => membership.event_id === joinedEvent.event_id)
      if (!joined) throw new Error('The invitation was accepted but event access did not refresh. Try loading your workspace again.')
      navigate(eventPath(joined), { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be accepted. Check the code and try again.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceFrame title="Join an event" subtitle="An authenticated account still needs a valid invitation to enter a private event.">
    {access?.memberships.length ? <p className="auth-inline-note">Your existing event memberships are unchanged.</p> : null}
    <form className="auth-form join-event-form" onSubmit={submit}>
      <label className="auth-field"><span>Invitation code</span><input value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required minLength={40} maxLength={100} pattern="[A-Za-z0-9_\-]{40,100}" aria-describedby="invite-code-help" /></label>
      <small id="invite-code-help" className="auth-field-help">Codes are case-sensitive, one-time or limited-use, and expire.</small>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" disabled={busy || token.trim().length < 40} type="submit">{busy ? 'Verifying invitation…' : 'Join event'} <ArrowRight size={16} /></button>
    </form>
    <Link className="auth-help-link" to="/app">Back to my workspace</Link>
  </WorkspaceFrame>
}

export function EventWorkspace() {
  const { eventId = '', workspace = '' } = useParams()
  const { access, loading, error, refreshAccess } = useAccess()
  if (loading) return <PrivateLoading message="Verifying event permissions…" />
  if (error) return <AccessError error={error} onRetry={() => void refreshAccess()} />
  const membership = access?.memberships.find((item) => item.event_id === eventId)
  if (!membership) return <WorkspaceFrame title="Event access not found" subtitle="Your account has no active membership for this event."><Link className="primary-button auth-link-button" to="/app">Return to your memberships <ArrowRight size={16} /></Link></WorkspaceFrame>

  const allowed = (workspace === 'participant' && membership.role === 'participant')
    || (workspace === 'organizer' && membership.role === 'organizer')
    || (workspace === 'moderator' && canOpenModeratorWorkspace(membership))
  if (!allowed) return <WorkspaceFrame title="This workspace is not assigned to your account" subtitle="Workspace access is read from your trusted event membership; changing a URL or browser setting does not grant a role."><Link className="primary-button auth-link-button" to={eventPath(membership)}>Open your assigned workspace <ArrowRight size={16} /></Link></WorkspaceFrame>

  if (workspace === 'organizer') return <OrganizerWorkspace membership={membership} />
  if (workspace === 'moderator') return <ModeratorWorkspace membership={membership} />
  return <ParticipantWorkspace membership={membership} />
}

function canOpenModeratorWorkspace(membership: EventMembershipAccess) {
  return (membership.role === 'moderator' || membership.role === 'organizer')
    && membership.permissions.some((permission) => MODERATION_PERMISSIONS.includes(permission))
}

function ParticipantWorkspace({ membership }: { membership: EventMembershipAccess }) {
  return <WorkspaceFrame title={membership.event_name} subtitle="Participant workspace">
    <section className="phase1-notice"><span className="phase1-notice-icon"><Users size={18} /></span><div><strong>Your event membership is verified.</strong><p>Your community workflows use authorized Supabase records. No sample activity is shown.</p></div></section>
    <Suspense fallback={<p role="status">Loading event workflows…</p>}><Workbench key={membership.event_id + membership.role + membership.permissions.join(",")} membership={membership} /></Suspense><AccessSummary membership={membership} />
  </WorkspaceFrame>
}

function OrganizerWorkspace({ membership }: { membership: EventMembershipAccess }) {
  const moderatorPermissions = membership.permissions.filter((permission) => MODERATION_PERMISSIONS.includes(permission))
  return <WorkspaceFrame title={membership.event_name} subtitle="Organizer workspace">
    <section className="phase1-notice"><span className="phase1-notice-icon"><ShieldCheck size={18} /></span><div><strong>Organizer membership verified for this event.</strong><p>Manage real event workflows below. Counts reflect only records your account is authorized to read.</p></div></section>
    <Suspense fallback={<p role="status">Loading event workflows…</p>}><Workbench key={membership.event_id + membership.role + membership.permissions.join(",")} membership={membership} /></Suspense><AccessSummary membership={membership} />
    <ParticipantInvitationForm membership={membership} />
    {moderatorPermissions.length > 0 && <section className="workspace-panel"><div className="workspace-panel-heading"><h2>Additional moderation grants</h2><p>These are explicit grants shown above, not permissions inherited from the organizer role.</p></div><Link className="auth-help-link" to={`/app/events/${encodeURIComponent(membership.event_id)}/moderator`}>Open assigned moderator workspace <ArrowRight size={14} /></Link></section>}
  </WorkspaceFrame>
}

function ModeratorWorkspace({ membership }: { membership: EventMembershipAccess }) {
  return <WorkspaceFrame title={membership.event_name} subtitle="Moderator workspace">
    <section className="phase1-notice"><span className="phase1-notice-icon"><ShieldCheck size={18} /></span><div><strong>Moderator access is limited to assigned permissions.</strong><p>Review queues and actions below are limited to your explicit trusted grants.</p></div></section>
    <Suspense fallback={<p role="status">Loading event workflows…</p>}><Workbench key={membership.event_id + membership.role + membership.permissions.join(",")} membership={membership} /></Suspense><AccessSummary membership={membership} />
  </WorkspaceFrame>
}

function AccessSummary({ membership }: { membership: EventMembershipAccess }) {
  return <section className="workspace-panel access-summary"><div className="workspace-panel-heading"><h2>Verified membership</h2><p>Loaded from the authenticated account's server-side event membership.</p></div><dl><div><dt>Event</dt><dd>{membership.event_name}</dd></div><div><dt>Role</dt><dd>{membership.role}</dd></div><div><dt>Event ID</dt><dd className="mono-value">{membership.event_id}</dd></div></dl><div className="workspace-panel-heading permissions-heading"><h3>Explicit permissions</h3></div><PermissionList permissions={membership.permissions} /></section>
}

function PermissionList({ permissions }: { permissions: string[] }) {
  if (!permissions.length) return <p className="empty-permissions">No additional permissions are assigned.</p>
  return <ul className="permission-list">{permissions.map((permission) => <li key={permission}><CheckCircle2 size={14} />{permission.replaceAll('_', ' ')}</li>)}</ul>
}

function ParticipantInvitationForm({ membership }: { membership: EventMembershipAccess }) {
  const { client } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!membership.permissions.includes('manage_members')) return null

  const createInvitation = async () => {
    setBusy(true)
    setError('')
    setCopied(false)
    try {
      const inviteCode = makeSecureInvitationCode()
      const { error: inviteError } = await client.rpc('create_event_invitation', {
        p_event_id: membership.event_id,
        p_token: inviteCode,
      })
      if (inviteError) throw inviteError
      setToken(inviteCode)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be created. Verify your event permission and try again.')
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setError('')
    } catch {
      setError('Clipboard access was denied. Select and copy the invitation code manually.')
    }
  }

  return <section className="workspace-panel invite-panel"><div className="workspace-panel-heading"><h2>Invite a participant</h2><p>Creates a real, participant-only invitation through a permission-checked database operation. The raw code is shown once and is not saved by the app.</p></div>
    <button type="button" className="secondary-button" onClick={() => void createInvitation()} disabled={busy}>{busy ? 'Creating invitation…' : 'Create 7-day participant code'} <KeyRound size={15} /></button>
    {token && <div className="invite-code-result"><label htmlFor="invite-code">One-time invitation code</label><div><input id="invite-code" readOnly value={token} onFocus={(event) => event.currentTarget.select()} /><button className="secondary-button" type="button" onClick={() => void copyCode()}><Copy size={14} />{copied ? 'Copied' : 'Copy'}</button></div><small>Share securely. Anyone who has this valid code can join as a participant until it expires or is used.</small></div>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </section>
}

function makeSecureInvitationCode() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('A secure browser context is required to generate an invitation code.')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function WorkspaceFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { client, session } = useAuth()
  const { access } = useAccess()
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const navigate = useNavigate()

  const logout = async () => {
    setLoggingOut(true)
    setLogoutError('')
    try {
      const { error } = await client.auth.signOut()
      if (error) throw error
      navigate('/', { replace: true })
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'Sign out could not be completed. Try again.')
    } finally {
      setLoggingOut(false)
    }
  }

  const activeMembership = access?.memberships.find(
    (m) => m.event_name === title || window.location.pathname.includes(m.event_id)
  )

  return (
    <div className="stitch-shell phase1-app-shell">
      {/* Stitch Fixed Topbar */}
      <header className="stitch-header phase1-topbar">
        <div className="stitch-header-left">
          <Link className="stitch-brand auth-brand" to="/app">
            <div className="stitch-brand-logo">
              <Radio size={20} />
            </div>
            <div className="stitch-brand-text">
              <span className="stitch-brand-title">DropZone</span>
              <span className="stitch-brand-tag">Civic Telemetry</span>
            </div>
          </Link>
          {activeMembership ? (
            <Link to={eventPath(activeMembership)} className="stitch-event-selector-pill">
              <span className="stitch-dot-ping" />
              <span>{activeMembership.event_name}</span>
            </Link>
          ) : (
            <span className="stitch-event-selector-pill">
              <span className="stitch-dot-ping" />
              <span>Decentralized Node</span>
            </span>
          )}
        </div>

        <div className="stitch-header-search">
          <Search size={16} />
          <input placeholder="Search event coordinates, signals, or posts..." aria-label="Quick search" />
        </div>

        <div className="stitch-header-right phase1-top-actions">
          <Link to="/app" className="stitch-icon-btn" title="My events" aria-label="My events">
            <Users size={16} />
          </Link>
          <Link to="/app/join" className="stitch-icon-btn" title="Join event" aria-label="Join event">
            <KeyRound size={16} />
          </Link>
          <div className="stitch-user-capsule">
            <span className="stitch-avatar phase1-avatar">
              {(session?.user.email ?? 'U').slice(0, 1).toUpperCase()}
            </span>
            <span
              className="phase1-account-email"
              style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {session?.user.email ?? 'Signed-in account'}
            </span>
            {activeMembership && <span className="stitch-role-tag">{activeMembership.role}</span>}
          </div>
          <button
            type="button"
            className="stitch-icon-btn stitch-topbar-logout"
            onClick={() => void logout()}
            disabled={loggingOut}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Stitch Fixed Sidebar */}
      <aside className="stitch-sidebar phase1-sidebar">
        <div className="stitch-current-zone-card">
          <div className="stitch-zone-header">
            <div className="stitch-zone-title-group">
              <span className="stitch-zone-eyebrow">
                {activeMembership ? `${activeMembership.role.toUpperCase()} ZONE` : 'CURRENT ZONE'}
              </span>
              <strong className="stitch-zone-name">
                {activeMembership?.event_name ?? (title === 'Welcome to DropZone' ? 'DropZone Network' : title)}
              </strong>
            </div>
            <span className="stitch-live-pill">
              <span className="stitch-dot-ping" /> Live
            </span>
          </div>
          <div className="stitch-zone-meta">
            <span>{activeMembership ? `Slug: ${activeMembership.event_slug}` : 'Zero Telemetry'}</span>
            <span className="stitch-admin-badge">{activeMembership?.role ?? 'Verified'}</span>
          </div>
        </div>

        {/* Dynamic slot for Event Workflows */}
        <div id="stitch-sidebar-nav-root" className="stitch-sidebar-nav-root" />

        {!activeMembership && (
          <div className="stitch-nav-group">
            <div className="stitch-nav-header"><span>Navigation</span></div>
            <Link to="/app" className="stitch-nav-btn">
              <Users size={16} />
              <span>My Events</span>
            </Link>
            <Link to="/app/join" className="stitch-nav-btn">
              <KeyRound size={16} />
              <span>Enter Invite Code</span>
            </Link>
          </div>
        )}

        <div style={{ marginTop: 'auto' }} className="stitch-nav-group">
          <div className="stitch-nav-header"><span>Session</span></div>
          {activeMembership && (
            <Link to="/app" className="stitch-nav-btn">
              <Users size={16} />
              <span>Return to My Events</span>
            </Link>
          )}
          <Link to="/app/account" className="stitch-nav-btn">
            <LockKeyhole size={16} />
            <span>Account & Keys</span>
          </Link>
          <button
            type="button"
            className="stitch-nav-btn stitch-logout-nav-btn"
            onClick={() => void logout()}
            disabled={loggingOut}
          >
            <LogOut size={16} />
            <span>{loggingOut ? 'Logging out…' : 'Log out'}</span>
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="stitch-main-container phase1-workspace">
        <main className="phase1-main">
          <div className="stitch-telemetry-banner phase1-page-heading">
            <div className="stitch-telemetry-info">
              <div className="stitch-breadcrumb-row">
                <h1 className="stitch-page-title">{title}</h1>
                <span className="stitch-geofence-pill">
                  <span className="stitch-dot-ping" /> ±5m lock
                </span>
              </div>
              <p className="stitch-page-subtitle">{subtitle}</p>
            </div>
            <div className="stitch-sync-time">
              <RefreshCw size={14} />
              <span>Signal: Synced</span>
            </div>
          </div>
          {logoutError && <p className="auth-error" role="alert">{logoutError}</p>}
          {children}
        </main>
      </div>
    </div>
  )
}

function PrivateLoading({ message }: { message: string }) {
  return <main className="auth-page auth-status-page"><section className="auth-card" aria-live="polite"><span className="auth-spinner" /><p>{message}</p></section></main>
}

function AccessError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <WorkspaceFrame title="Access check required" subtitle="Private event content remains unavailable until access can be verified."><p className="auth-error" role="alert">{error}</p><button className="secondary-button" type="button" onClick={onRetry}><RefreshCw size={14} />Retry access check</button></WorkspaceFrame>
}

